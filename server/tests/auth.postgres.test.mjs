import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createAuth } from '../src/auth.js';
import { errorResponse } from '../src/security.js';

// Never fall back to DATABASE_URL. This suite writes only to its own random
// schema in an explicitly supplied, loopback, test-named PostgreSQL database.
const DATABASE = process.env.TEST_DATABASE_URL;
const ORIGIN = 'https://merchant.mulchcheckout.com';
const PASSWORD = 'An isolated merchant password 🔐';
const NEW_PASSWORD = 'A different isolated password 🪴';
const EMAIL = 'auth-isolated@example.test';
const ENV = {
  APP_ORIGIN: ORIGIN,
  RESEND_API_KEY: 'isolated-test-key-not-a-provider-key',
  AUTH_EMAIL_FROM: 'Mulch <auth@example.test>',
};
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomBytes(32).toString('base64url'); }
function guardDatabase(value) {
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !/(test|temp|isolated)/i.test(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error('TEST_DATABASE_URL must be an explicit loopback, test/temp/isolated-named PostgreSQL database, without URL options. Production and managed databases are prohibited.');
  }
}
function response() {
  return {
    headers: {}, status: null, body: null, headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; this.headersSent = true; Object.assign(this.headers, headers); },
    end(value) { this.body = JSON.parse(value); },
  };
}
async function call(auth, path, body = {}, options = {}) {
  const req = {
    method: options.method ?? 'POST',
    headers: {
      origin: options.origin ?? ORIGIN,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}),
      ...(options.headers ?? {}),
    },
    socket: { remoteAddress: options.ip ?? '127.0.0.1' },
  };
  const res = response();
  try {
    res.handled = await auth.handle(req, res, new URL(path, ORIGIN), body);
  } catch (error) {
    errorResponse(res, error);
  }
  return res;
}
function cookieOf(res) { return res.headers['set-cookie']?.split(';')[0]; }
function reqWithCookie(cookie) { return { headers: { cookie }, socket: { remoteAddress: '127.0.0.1' } }; }

// All email operations below use injected in-memory recording functions. No
// default adapter, provider request, real inbox or production fixture is used.
test('PostgreSQL auth lifecycle, concurrency, expiry, session revocation and durable rate limits',
  { skip: !DATABASE ? 'Set TEST_DATABASE_URL to an isolated loopback test database to run PostgreSQL auth tests.' : false },
  async t => {
    guardDatabase(DATABASE);
    const schema = `mulch_auth_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: DATABASE, max: 1 });
    let pool;
    let schemaCreated = false;
    t.after(async () => {
      try {
        if (pool) await pool.end();
        if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally { await admin.end(); }
    });
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    pool = new Pool({ connectionString: DATABASE, max: 6, options: `-c search_path=${schema}` });
    await pool.query(await readFile(new URL('../migrations/000_auth.sql', import.meta.url), 'utf8'));
    const delivered = [];
    const mailer = {
      async sendVerification(payload) { delivered.push({ kind: 'verify', ...payload }); },
      async sendPasswordReset(payload) { delivered.push({ kind: 'reset', ...payload }); },
      async sendPasswordChanged(payload) { delivered.push({ kind: 'changed', ...payload }); },
    };
    const auth = createAuth({ pool, env: ENV, mailer });
    let userId;
    let signupHash;
    let verifyToken;
    let firstSession;
    let secondSession;
    let resetToken;

    await t.test('signup requires verification and stores only hashes; duplicate cannot replace an unverified password', async () => {
      const signup = await call(auth, '/api/auth/signup', { name: 'Isolated Merchant', email: EMAIL.toUpperCase(), password: PASSWORD });
      assert.equal(signup.status, 202);
      assert.equal(signup.body.verificationRequired, true);
      assert.equal(cookieOf(signup), undefined);
      assert.ok(!JSON.stringify(signup.body).includes('token'));
      assert.equal(delivered.length, 1);
      verifyToken = delivered[0].token;
      const users = await pool.query('SELECT * FROM mulch_users');
      assert.equal(users.rows.length, 1);
      userId = users.rows[0].id;
      signupHash = users.rows[0].password_hash;
      assert.equal(users.rows[0].email, EMAIL);
      assert.equal(users.rows[0].email_verified_at, null);
      assert.equal(users.rows[0].auth_provider, 'email');
      const tokens = await pool.query('SELECT token_hash, purpose, expires_at, created_at FROM mulch_auth_tokens');
      assert.equal(tokens.rows[0].token_hash, digest(verifyToken));
      assert.notEqual(tokens.rows[0].token_hash, verifyToken);
      assert.equal(tokens.rows[0].purpose, 'verify_email');
      assert.equal(tokens.rows[0].expires_at - tokens.rows[0].created_at, 24 * 60 * 60 * 1000);
      const duplicate = await call(auth, '/api/auth/signup', { name: 'Do Not Replace', email: EMAIL, password: NEW_PASSWORD });
      assert.equal(duplicate.status, 202);
      assert.deepEqual(duplicate.body, signup.body);
      assert.equal(delivered.length, 1);
      const preserved = await pool.query('SELECT password_hash, name FROM mulch_users WHERE id = $1', [userId]);
      assert.equal(preserved.rows[0].password_hash, signupHash);
      assert.equal(preserved.rows[0].name, 'Isolated Merchant');
      const login = await call(auth, '/api/auth/login', { email: EMAIL, password: PASSWORD });
      assert.equal(login.status, 401);
      assert.equal(cookieOf(login), undefined);
      assert.equal(Number((await pool.query('SELECT count(*) FROM mulch_auth_sessions')).rows[0].count), 0);
    });

    await t.test('verification is atomic single-use, POST-only, and never signs in or creates paid grants', async () => {
      const before = await call(auth, '/api/auth/verify-email', { token: verifyToken }, { method: 'GET' });
      assert.equal(before.status, 405);
      const outcomes = await Promise.all([
        call(auth, '/api/auth/verify-email', { token: verifyToken }),
        call(auth, '/api/auth/verify-email', { token: verifyToken }),
      ]);
      assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 400]);
      for (const result of outcomes) assert.equal(cookieOf(result), undefined);
      const replay = await call(auth, '/api/auth/verify-email', { token: verifyToken });
      assert.equal(replay.status, 400);
      assert.ok((await pool.query('SELECT email_verified_at FROM mulch_users WHERE id=$1', [userId])).rows[0].email_verified_at);
      assert.equal(Number((await pool.query('SELECT count(*) FROM mulch_auth_sessions')).rows[0].count), 0);
      const grants = await pool.query(`SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1 AND table_name IN ('mulch_entitlements', 'mulch_app_stores')`, [schema]);
      assert.deepEqual(grants.rows, []);
      assert.equal(await auth.session({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), null);
    });

    await t.test('verified login issues durable opaque secure host cookie and identity-only session; logout needs CSRF', async () => {
      const login = await call(auth, '/api/auth/login', { email: EMAIL, password: PASSWORD },
        { headers: { host: 'evil.example.com', 'x-forwarded-proto': 'http' } });
      assert.equal(login.status, 200);
      assert.deepEqual(Object.keys(login.body).sort(), ['authenticated', 'csrfToken', 'user']);
      assert.deepEqual(Object.keys(login.body.user).sort(), ['email', 'id', 'name']);
      assert.match(login.headers['set-cookie'], /^__Host-mulch_session=[A-Za-z0-9_-]{43};/);
      assert.match(login.headers['set-cookie'], /; Secure(?:;|$)/);
      assert.match(login.headers['set-cookie'], /; HttpOnly(?:;|$)/);
      assert.match(login.headers['set-cookie'], /; SameSite=Lax(?:;|$)/);
      assert.match(login.headers['set-cookie'], /; Path=\/(?:;|$)/);
      assert.ok(!/Domain=/i.test(login.headers['set-cookie']));
      firstSession = { cookie: cookieOf(login), csrf: login.body.csrfToken };
      const raw = firstSession.cookie.split('=')[1];
      const sessions = await pool.query('SELECT token_hash FROM mulch_auth_sessions');
      assert.equal(sessions.rows[0].token_hash, digest(raw));
      assert.notEqual(sessions.rows[0].token_hash, raw);
      const anotherInstance = createAuth({ pool, env: ENV, mailer });
      assert.deepEqual(await anotherInstance.session(reqWithCookie(firstSession.cookie)),
        { user: login.body.user, csrfToken: firstSession.csrf });
      assert.equal(await auth.session(reqWithCookie(`${firstSession.cookie}; ${firstSession.cookie}`)), null);
      const noCsrf = await call(auth, '/api/auth/logout', {}, { cookie: firstSession.cookie });
      assert.equal(noCsrf.status, 403);
      const badOrigin = await call(auth, '/api/auth/logout', {},
        { cookie: firstSession.cookie, csrf: firstSession.csrf, origin: 'https://evil.example.com' });
      assert.equal(badOrigin.status, 403);
      const valid = await call(auth, '/api/auth/logout', {}, firstSession);
      assert.equal(valid.status, 200);
      assert.match(valid.headers['set-cookie'], /Max-Age=0/);
      assert.equal(await auth.session(reqWithCookie(firstSession.cookie)), null);
      const a = await call(auth, '/api/auth/login', { email: EMAIL, password: PASSWORD });
      const b = await call(auth, '/api/auth/login', { email: EMAIL, password: PASSWORD });
      firstSession = { cookie: cookieOf(a), csrf: a.body.csrfToken };
      secondSession = { cookie: cookieOf(b), csrf: b.body.csrfToken };
      assert.notEqual(firstSession.cookie, secondSession.cookie);
      assert.notEqual(firstSession.csrf, secondSession.csrf);
      const duplicate = await call(auth, '/api/auth/signup', { name: 'Do Not Replace Verified', email: EMAIL, password: NEW_PASSWORD });
      assert.equal(duplicate.status, 202);
      assert.equal((await pool.query('SELECT password_hash FROM mulch_users WHERE id=$1', [userId])).rows[0].password_hash, signupHash);
    });

    await t.test('forgot-password is generic; reset expires in 15 minutes, revokes all tokens/sessions and never auto-logins', async () => {
      const missing = await call(auth, '/api/auth/forgot-password', { email: 'unknown-isolated@example.test' });
      const recovery = await call(auth, '/api/auth/forgot-password', { email: EMAIL });
      assert.equal(missing.status, 202);
      assert.deepEqual(missing.body, recovery.body);
      resetToken = delivered.findLast(item => item.kind === 'reset').token;
      assert.ok(!JSON.stringify(recovery.body).includes(resetToken));
      const issued = await pool.query('SELECT expires_at, created_at FROM mulch_auth_tokens WHERE token_hash = $1', [digest(resetToken)]);
      assert.equal(issued.rows[0].expires_at - issued.rows[0].created_at, 15 * 60 * 1000);
      // Outstanding synthetic verification token proves reset revokes ALL token purposes.
      await pool.query(`INSERT INTO mulch_auth_tokens (id,user_id,token_hash,purpose,expires_at)
        VALUES ($1,$2,$3,'verify_email',now()+interval '1 hour')`, [randomUUID(), userId, digest(token())]);
      const attempts = await Promise.all([
        call(auth, '/api/auth/reset-password', { token: resetToken, password: NEW_PASSWORD }),
        call(auth, '/api/auth/reset-password', { token: resetToken, password: NEW_PASSWORD }),
      ]);
      assert.deepEqual(attempts.map(item => item.status).sort(), [200, 400]);
      for (const result of attempts) assert.equal(cookieOf(result), undefined);
      assert.equal(await auth.session(reqWithCookie(firstSession.cookie)), null);
      assert.equal(await auth.session(reqWithCookie(secondSession.cookie)), null);
      assert.equal(Number((await pool.query('SELECT count(*) FROM mulch_auth_tokens WHERE user_id=$1 AND used_at IS NULL', [userId])).rows[0].count), 0);
      assert.equal(Number((await pool.query('SELECT count(*) FROM mulch_auth_sessions WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows[0].count), 0);
      const changed = delivered.filter(item => item.kind === 'changed');
      assert.equal(changed.length, 1);
      assert.deepEqual(changed[0], { kind: 'changed', email: EMAIL });
      const oldLogin = await call(auth, '/api/auth/login', { email: EMAIL, password: PASSWORD });
      assert.equal(oldLogin.status, 401);
      const newLogin = await call(auth, '/api/auth/login', { email: EMAIL, password: NEW_PASSWORD });
      assert.equal(newLogin.status, 200);
      const replay = await call(auth, '/api/auth/reset-password', { token: resetToken, password: NEW_PASSWORD });
      assert.equal(replay.status, 400);
    });

    await t.test('expired verification and reset tokens cannot be consumed; expired sessions deny access', async () => {
      const expiredReset = token();
      const expiredVerify = token();
      for (const [raw, purpose] of [[expiredReset, 'reset_password'], [expiredVerify, 'verify_email']]) {
        await pool.query(`INSERT INTO mulch_auth_tokens (id,user_id,token_hash,purpose,expires_at)
          VALUES ($1,$2,$3,$4,now()-interval '1 second')`, [randomUUID(), userId, digest(raw), purpose]);
      }
      assert.equal((await call(auth, '/api/auth/reset-password', { token: expiredReset, password: PASSWORD })).status, 400);
      assert.equal((await call(auth, '/api/auth/verify-email', { token: expiredVerify })).status, 400);
      const raw = token();
      await pool.query(`INSERT INTO mulch_auth_sessions (id,user_id,token_hash,csrf_token,expires_at)
        VALUES ($1,$2,$3,$4,now()-interval '1 second')`, [randomUUID(), userId, digest(raw), token()]);
      assert.equal(await auth.session(reqWithCookie(`__Host-mulch_session=${raw}`)), null);
      assert.equal((await call(auth, '/api/auth/reset-password', { token: token(), password: PASSWORD })).status, 400);
    });

    await t.test('resend invalidates the previous link and unverified users cannot reset into a session', async () => {
      const email = 'unverified-isolated@example.test';
      await call(auth, '/api/auth/signup', { name: 'Still Unverified', email, password: PASSWORD });
      const previous = delivered.findLast(item => item.kind === 'verify').token;
      const before = delivered.length;
      const unknown = await call(auth, '/api/auth/resend-verification', { email: 'missing-resend@example.test' });
      const resend = await call(auth, '/api/auth/resend-verification', { email });
      assert.deepEqual(unknown.body, resend.body);
      assert.equal(delivered.length, before + 1);
      const latest = delivered.findLast(item => item.kind === 'verify').token;
      assert.notEqual(previous, latest);
      assert.equal((await call(auth, '/api/auth/verify-email', { token: previous })).status, 400);
      const mailCount = delivered.length;
      assert.equal((await call(auth, '/api/auth/forgot-password', { email })).status, 202);
      assert.equal(delivered.length, mailCount);
      assert.equal((await call(auth, '/api/auth/login', { email, password: PASSWORD })).status, 401);
      assert.equal((await call(auth, '/api/auth/verify-email', { token: latest })).status, 200);
    });

    await t.test('durable per-account buckets span instances; spoofed forwarding cannot evade per-transport-IP limits', async () => {
      const email = 'durable-rate-isolated@example.test';
      const key = digest(`login\0account\0${email}`);
      await pool.query(`INSERT INTO mulch_auth_rate_buckets (bucket_key, attempts) VALUES ($1,9)`, [key]);
      const one = await call(auth, '/api/auth/login', { email, password: PASSWORD }, { ip: '127.0.0.2' });
      assert.equal(one.status, 401);
      const another = createAuth({ pool, env: ENV, mailer });
      const two = await call(another, '/api/auth/login', { email, password: PASSWORD }, { ip: '127.0.0.3' });
      assert.equal(two.status, 429);
      assert.equal(two.body.error, 'rate_limited');
      const ipKey = digest('forgot-password\0ip\0' + '127.0.0.4');
      await pool.query(`INSERT INTO mulch_auth_rate_buckets (bucket_key, attempts) VALUES ($1,30)`, [ipKey]);
      const spoof = await call(auth, '/api/auth/forgot-password', { email: 'not-known@example.test' },
        { ip: '127.0.0.4', headers: { 'x-forwarded-for': '203.0.113.25', forwarded: 'for=203.0.113.26' } });
      assert.equal(spoof.status, 429);
      await pool.query(`UPDATE mulch_auth_rate_buckets SET window_start = now()-interval '16 minutes' WHERE bucket_key=$1`, [key]);
      const fresh = await call(auth, '/api/auth/login', { email, password: PASSWORD }, { ip: '127.0.0.5' });
      assert.equal(fresh.status, 401);
      assert.equal((await pool.query('SELECT attempts FROM mulch_auth_rate_buckets WHERE bucket_key=$1', [key])).rows[0].attempts, 1);
    });

    await t.test('explicit loopback HTTP changes cookie transport only, never verification or authorization', async () => {
      const loopOrigin = 'http://127.0.0.1:43219';
      const local = createAuth({ pool, env: { ...ENV, APP_ORIGIN: loopOrigin, NODE_ENV: 'production' }, mailer });
      assert.equal(local.configured, true);
      const signIn = await call(local, '/api/auth/login', { email: EMAIL, password: NEW_PASSWORD }, { origin: loopOrigin, ip: '127.0.0.6' });
      assert.equal(signIn.status, 200);
      assert.match(signIn.headers['set-cookie'], /^mulch_session=/);
      assert.ok(!/; Secure(?:;|$)/.test(signIn.headers['set-cookie']));
      assert.ok(await local.session(reqWithCookie(cookieOf(signIn))));
      assert.equal(await auth.session(reqWithCookie(cookieOf(signIn))), null);
      assert.equal(await local.handle({ method: 'GET', headers: {} }, response(), new URL('/api/stores', loopOrigin)), false);
    });
  });
