import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fail, object, send, text } from './security.js';
import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { createMailer, mailConfiguration } from './mail.js';

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const VERIFY_SECONDS = 24 * 60 * 60;
const RESET_SECONDS = 15 * 60;
const GENERIC_MINIMUM_MS = 1000;
const AUTH_PATHS = new Set([
  '/api/auth/signup', '/api/auth/login', '/api/auth/logout',
  '/api/auth/forgot-password', '/api/auth/resend-verification',
  '/api/auth/verify-email', '/api/auth/reset-password',
]);
const GENERIC_MESSAGE = 'If the account is eligible, an email with the next steps will be sent.';
const RATE_LIMITS = Object.freeze({
  signup: { seconds: 3600, ip: 30, account: 5 },
  login: { seconds: 900, ip: 100, account: 10 },
  'forgot-password': { seconds: 900, ip: 30, account: 3 },
  'resend-verification': { seconds: 900, ip: 30, account: 3 },
  'verify-email': { seconds: 900, ip: 60, account: 10 },
  'reset-password': { seconds: 900, ip: 60, account: 10 },
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueToken() {
  return randomBytes(32).toString('base64url');
}

function validToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, 'base64url').toString('base64url') === value;
}

function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) {
    fail('invalid_email', 'Use a valid email address.');
  }
  const email = value.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ||
      email.split('@')[0].length > 64 || email.includes('..')) {
    fail('invalid_email', 'Use a valid email address.');
  }
  return email;
}

function userView(row) {
  return { id: row.id, email: row.email, name: row.name };
}

export function createAuth({ pool, env = {}, mailer } = {}) {
  const configuration = mailConfiguration(env);
  const emailService = mailer ?? createMailer({ env });
  const configured = Boolean(configuration.configured &&
    typeof emailService.sendVerification === 'function' &&
    typeof emailService.sendPasswordReset === 'function' &&
    typeof emailService.sendPasswordChanged === 'function');
  const cookieName = configuration.origin?.secure ? '__Host-mulch_session' : 'mulch_session';

  function requireConfigured() {
    if (!configured) fail('auth_not_configured', 'Email authentication is not configured.', 503);
  }

  function exactOrigin(req) {
    return Boolean(configuration.origin && req.headers.origin === configuration.origin.origin);
  }

  function requestToken(req) {
    const header = req.headers.cookie;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const matches = header.split(';').map(value => value.trim())
      .filter(value => value.startsWith(`${cookieName}=`));
    // Reject ambiguous duplicates and noncanonical encoded bearer values.
    if (matches.length !== 1) return null;
    const token = matches[0].slice(cookieName.length + 1);
    return validToken(token) ? token : null;
  }

  function setCookie(res, token, clear = false) {
    const attributes = [
      `${cookieName}=${clear ? '' : token}`,
      'Path=/', 'HttpOnly', 'SameSite=Lax',
      `Max-Age=${clear ? 0 : SESSION_SECONDS}`,
    ];
    if (configuration.origin?.secure) attributes.push('Secure');
    if (clear) attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    // A __Host- cookie has Path=/ and no Domain, including on Render's HTTP hop.
    res.setHeader('Set-Cookie', attributes.join('; '));
  }

  async function transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original sanitized error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async function bucket(action, scope, value) {
    const limits = RATE_LIMITS[action];
    const key = digest(`${action}\0${scope}\0${value}`);
    const { rows } = await pool.query(`
      INSERT INTO mulch_auth_rate_buckets (bucket_key, window_start, attempts)
      VALUES ($1, now(), 1)
      ON CONFLICT (bucket_key) DO UPDATE SET
        attempts = CASE
          WHEN mulch_auth_rate_buckets.window_start <= now() - $2 * interval '1 second' THEN 1
          ELSE LEAST(mulch_auth_rate_buckets.attempts + 1, 1000000)
        END,
        window_start = CASE
          WHEN mulch_auth_rate_buckets.window_start <= now() - $2 * interval '1 second' THEN now()
          ELSE mulch_auth_rate_buckets.window_start
        END
      RETURNING attempts`, [key, limits.seconds]);
    if (rows[0].attempts > limits[scope]) {
      fail('rate_limited', 'Too many authentication attempts. Please try again later.', 429);
    }
  }

  async function rateLimit(action, req, email) {
    // Deliberately ignore Forwarded/X-Forwarded-For. Render can share a transport
    // proxy IP: this safe default can group clients and needs capacity monitoring.
    // Do not enable forwarded-IP trust without a separately reviewed strict proxy boundary.
    const ip = typeof req.socket?.remoteAddress === 'string'
      ? req.socket.remoteAddress.slice(0, 128) : 'unknown-transport';
    await bucket(action, 'ip', ip);
    if (email !== undefined) await bucket(action, 'account', email);
  }

  async function genericResponse(res, operation, verificationRequired = false) {
    const started = performance.now();
    const minimum = GENERIC_MINIMUM_MS + randomInt(201);
    try {
      await operation();
    } finally {
      await sleep(Math.max(0, minimum - (performance.now() - started)));
    }
    send(res, 202, { message: GENERIC_MESSAGE, ...(verificationRequired ? { verificationRequired: true } : {}) });
  }

  async function deliver(method, payload) {
    try {
      await emailService[method](payload);
    } catch {
      // Keep known/unknown account responses identical even on delivery failure.
      // No raw token/provider response is logged or persisted. Request a new link
      // if delivery fails. Inline provider latency above the minimum can still
      // vary: this is mitigation, not a claim of perfect timing indistinguishability.
    }
  }

  async function issueEmailToken(userId, purpose) {
    return transaction(async client => {
      // All token issuance/consumption and session issuance lock the user first.
      const { rows } = await client.query(`
        SELECT id, email, email_verified_at FROM mulch_users
        WHERE id = $1 AND auth_provider = 'email' FOR UPDATE`, [userId]);
      const user = rows[0];
      if (!user || (purpose === 'verify_email' && user.email_verified_at) ||
          (purpose === 'reset_password' && !user.email_verified_at)) return null;
      const token = opaqueToken();
      await client.query(`
        UPDATE mulch_auth_tokens SET used_at = now()
        WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
      await client.query(`
        INSERT INTO mulch_auth_tokens (id, user_id, token_hash, purpose, expires_at)
        VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
      [randomUUID(), userId, digest(token), purpose, purpose === 'verify_email' ? VERIFY_SECONDS : RESET_SECONDS]);
      return { email: user.email, token };
    });
  }

  async function session(req) {
    if (!configured) return null;
    const token = requestToken(req);
    if (!token) return null;
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, s.csrf_token
      FROM mulch_auth_sessions s JOIN mulch_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        AND u.auth_provider = 'email' AND u.email_verified_at IS NOT NULL`, [digest(token)]);
    return rows[0] ? { user: userView(rows[0]), csrfToken: rows[0].csrf_token } : null;
  }

  function verifyCsrf(req, currentSession) {
    if (!exactOrigin(req) || !currentSession?.user || !validToken(currentSession.csrfToken)) return false;
    const supplied = req.headers['x-csrf-token'];
    if (!validToken(supplied)) return false;
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(currentSession.csrfToken));
  }

  async function signup(req, res, body) {
    object(body, ['name', 'email', 'password'], ['name', 'email', 'password']);
    const name = text(body.name, 'Name', 80);
    const email = emailAddress(body.email);
    validatePassword(body.password);
    await rateLimit('signup', req, email);
    await genericResponse(res, async () => {
      // Perform the fixed-cost hash even for duplicates. Never overwrite a
      // verified OR unverified account's password/name, or send duplicate-signup mail.
      const passwordHash = await hashPassword(body.password);
      const { rows } = await pool.query(`
        INSERT INTO mulch_users (id, email, name, auth_provider, password_hash)
        VALUES ($1, $2, $3, 'email', $4)
        ON CONFLICT (LOWER(email)) DO NOTHING RETURNING id`,
      [randomUUID(), email, name, passwordHash]);
      if (rows[0]) {
        const payload = await issueEmailToken(rows[0].id, 'verify_email');
        if (payload) await deliver('sendVerification', payload);
      }
    }, true);
  }

  async function login(req, res, body) {
    object(body, ['email', 'password'], ['email', 'password']);
    const email = emailAddress(body.email);
    validatePassword(body.password);
    await rateLimit('login', req, email);
    const { rows } = await pool.query(`
      SELECT id, email, name, password_hash, email_verified_at FROM mulch_users
      WHERE LOWER(email) = $1 AND auth_provider = 'email'`, [email]);
    const snapshot = rows[0];
    const matches = await verifyPassword(body.password, snapshot?.password_hash);
    if (!matches || !snapshot?.email_verified_at) {
      fail('invalid_credentials', 'Email or password is incorrect, or email verification is incomplete.', 401);
    }
    const token = opaqueToken();
    const csrfToken = opaqueToken();
    const user = await transaction(async client => {
      const locked = await client.query(`
        SELECT id, email, name, password_hash, email_verified_at FROM mulch_users
        WHERE id = $1 AND auth_provider = 'email' FOR UPDATE`, [snapshot.id]);
      const current = locked.rows[0];
      // A concurrent reset cannot leave a newly issued old-password session.
      if (!current?.email_verified_at || current.password_hash !== snapshot.password_hash) {
        fail('invalid_credentials', 'Email or password is incorrect, or email verification is incomplete.', 401);
      }
      const previous = requestToken(req);
      if (previous) await client.query(`
        UPDATE mulch_auth_sessions SET revoked_at = now()
        WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`, [digest(previous), current.id]);
      await client.query(`
        INSERT INTO mulch_auth_sessions (id, user_id, token_hash, csrf_token, expires_at)
        VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
      [randomUUID(), current.id, digest(token), csrfToken, SESSION_SECONDS]);
      return userView(current);
    });
    setCookie(res, token);
    send(res, 200, { authenticated: true, user, csrfToken });
  }

  async function requestRecovery(req, res, body, action, purpose, method) {
    object(body, ['email'], ['email']);
    const email = emailAddress(body.email);
    await rateLimit(action, req, email);
    await genericResponse(res, async () => {
      const { rows } = await pool.query(`
        SELECT id FROM mulch_users WHERE LOWER(email) = $1 AND auth_provider = 'email'`, [email]);
      if (rows[0]) {
        const payload = await issueEmailToken(rows[0].id, purpose);
        if (payload) await deliver(method, payload);
      }
    });
  }

  async function consumeToken(req, res, body, reset) {
    object(body, reset ? ['token', 'password'] : ['token'], reset ? ['token', 'password'] : ['token']);
    if (reset) validatePassword(body.password);
    const action = reset ? 'reset-password' : 'verify-email';
    const purpose = reset ? 'reset_password' : 'verify_email';
    await rateLimit(action, req);
    if (!validToken(body.token)) fail('invalid_token', 'This link is invalid or has expired.', 400);
    const tokenHash = digest(body.token);
    const lookup = await pool.query(`
      SELECT t.user_id, u.email FROM mulch_auth_tokens t JOIN mulch_users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = $2 AND u.auth_provider = 'email'`, [tokenHash, purpose]);
    const candidate = lookup.rows[0];
    if (!candidate) fail('invalid_token', 'This link is invalid or has expired.', 400);
    await bucket(action, 'account', candidate.email);
    // Hash outside the lock, with globally bounded concurrency.
    const newHash = reset ? await hashPassword(body.password) : null;
    const email = await transaction(async client => {
      const users = await client.query(`
        SELECT id, email, email_verified_at FROM mulch_users
        WHERE id = $1 AND auth_provider = 'email' FOR UPDATE`, [candidate.user_id]);
      const user = users.rows[0];
      const tokens = await client.query(`
        SELECT id FROM mulch_auth_tokens
        WHERE token_hash = $1 AND user_id = $2 AND purpose = $3
          AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [tokenHash, candidate.user_id, purpose]);
      if (!user || !tokens.rows[0] || (reset && !user.email_verified_at)) {
        fail('invalid_token', 'This link is invalid or has expired.', 400);
      }
      if (reset) {
        await client.query(`UPDATE mulch_users SET password_hash = $2, updated_at = now() WHERE id = $1`,
          [user.id, newHash]);
        await client.query(`UPDATE mulch_auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
          [user.id]);
        // Includes every outstanding verification/reset token, not only this one.
        await client.query(`UPDATE mulch_auth_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
          [user.id]);
      } else {
        await client.query(`
          UPDATE mulch_users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
          WHERE id = $1`, [user.id]);
        await client.query(`
          UPDATE mulch_auth_tokens SET used_at = now()
          WHERE user_id = $1 AND purpose = 'verify_email' AND used_at IS NULL`, [user.id]);
      }
      return user.email;
    });
    if (reset) await deliver('sendPasswordChanged', { email });
    // Neither verification nor reset creates a session or grants dashboard access.
    send(res, 200, { message: reset ? 'Password changed. Sign in with your new password.' : 'Email verified. You can now sign in.' });
  }

  async function logout(req, res, body) {
    object(body, []);
    const current = await session(req);
    if (!current) fail('unauthenticated', 'Sign in to continue.', 401);
    if (!verifyCsrf(req, current)) fail('csrf_invalid', 'A valid origin and CSRF token are required.', 403);
    const token = requestToken(req);
    await pool.query(`
      UPDATE mulch_auth_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`, [digest(token), current.user.id]);
    setCookie(res, '', true);
    send(res, 200, { authenticated: false });
  }

  async function handle(req, res, url, body) {
    const path = url.pathname;
    if (path === '/api/session') {
      if (req.method !== 'GET') fail('method_not_allowed', 'Use GET for session status.', 405);
      const current = await session(req);
      send(res, 200, { authenticated: Boolean(current), ...(current ?? {}), authMode: 'email' });
      return true;
    }
    if (!AUTH_PATHS.has(path)) return false;
    if (req.method !== 'POST') fail('method_not_allowed', 'Use POST for authentication actions.', 405);
    // Protect login/signup/reset against cross-site requests, including login CSRF.
    // Origin is never derived from Host, forwarded headers or NODE_ENV.
    if (!exactOrigin(req)) fail('csrf_invalid', 'A request from the configured application origin is required.', 403);
    requireConfigured();
    switch (path) {
      case '/api/auth/signup': await signup(req, res, body); break;
      case '/api/auth/login': await login(req, res, body); break;
      case '/api/auth/logout': await logout(req, res, body); break;
      case '/api/auth/forgot-password':
        await requestRecovery(req, res, body, 'forgot-password', 'reset_password', 'sendPasswordReset');
        break;
      case '/api/auth/resend-verification':
        await requestRecovery(req, res, body, 'resend-verification', 'verify_email', 'sendVerification');
        break;
      case '/api/auth/verify-email': await consumeToken(req, res, body, false); break;
      case '/api/auth/reset-password': await consumeToken(req, res, body, true); break;
    }
    return true;
  }

  return Object.freeze({ mode: 'email', configured, session, handle, verifyCsrf });
}
