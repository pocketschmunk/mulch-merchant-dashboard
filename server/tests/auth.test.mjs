import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../src/auth.js';
import { authOrigin, createMailer, mailConfiguration } from '../src/mail.js';
import { hashPassword, verifyPassword, validatePassword, SCRYPT_PARAMETERS, MAX_CONCURRENT_HASHES } from '../src/passwords.js';

const PASSWORD = 'A long Unicode password 🔐 2026';
const env = {
  APP_ORIGIN: 'https://merchant.mulchcheckout.com',
  RESEND_API_KEY: 'isolated-unit-test-key-not-a-provider-key',
  AUTH_EMAIL_FROM: 'Mulch <auth@example.test>',
};
const inertMailer = {
  async sendVerification() {},
  async sendPasswordReset() {},
  async sendPasswordChanged() {},
};

function request(method = 'POST', origin = env.APP_ORIGIN, headers = {}) {
  if (arguments.length >= 2 && arguments[1] === undefined) origin = undefined;
  return { method, headers: { origin, ...headers }, socket: { remoteAddress: '127.0.0.1' } };
}
function response() {
  return {
    headers: {}, status: null, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(value) { this.body = JSON.parse(value); },
  };
}
function neverPool() {
  return { async query() { throw new Error('A guarded request must not reach the database'); } };
}

// Provider-like credentials and a synthetic session here are isolated unit inputs,
// not users, authentication bypasses or fixtures exposed by the application.
test('password policy counts Unicode code points and preserves input exactly', () => {
  assert.equal(validatePassword('🔐'.repeat(15)), '🔐'.repeat(15));
  assert.equal(validatePassword(' '.repeat(15)), ' '.repeat(15));
  assert.equal(validatePassword('🪴'.repeat(128)), '🪴'.repeat(128));
  for (const value of ['x'.repeat(14), 'x'.repeat(129), '🪴'.repeat(129), '\ud800'.repeat(15), null, 123]) {
    assert.throws(() => validatePassword(value), error => error.code === 'invalid_password');
  }
  assert.deepEqual(SCRYPT_PARAMETERS, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
  assert.equal(MAX_CONCURRENT_HASHES, 2);
});

test('salted scrypt hashes use immutable costs, verify correctly and reject corrupt/lowered costs', async () => {
  const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.ok(!first.includes(PASSWORD));
  assert.equal(await verifyPassword(PASSWORD, first), true);
  assert.equal(await verifyPassword(`${PASSWORD}!`, first), false);
  assert.equal(await verifyPassword(PASSWORD, first.replace('$131072$', '$16384$')), false);
  assert.equal(await verifyPassword(PASSWORD, undefined), false);
});

test('origin configuration rejects public HTTP, userinfo, local HTTPS and arbitrary paths', () => {
  assert.deepEqual(authOrigin(env.APP_ORIGIN), { origin: env.APP_ORIGIN, secure: true });
  assert.deepEqual(authOrigin('http://127.0.0.1:43123'), { origin: 'http://127.0.0.1:43123', secure: false });
  for (const value of [undefined, 'http://merchant.mulchcheckout.com', 'http://localhost:3000',
    'https://127.0.0.1', 'https://localhost', 'https://merchant.mulchcheckout.com/path',
    'https://merchant.mulchcheckout.com?redirect=evil', 'https://user:secret@merchant.mulchcheckout.com',
    'https://merchant.mulchcheckout.com#token', ' https://merchant.mulchcheckout.com',
    'https://merchant.mulchcheckout.com/']) {
    assert.equal(authOrigin(value), null, String(value));
  }
  assert.equal(mailConfiguration(env).configured, true);
  for (const key of ['APP_ORIGIN', 'RESEND_API_KEY', 'AUTH_EMAIL_FROM']) {
    assert.equal(mailConfiguration({ ...env, [key]: '' }).configured, false);
    assert.equal(createAuth({ pool: neverPool(), env: { ...env, [key]: '' }, mailer: inertMailer }).configured, false);
  }
});

test('authentication fails closed when email service is missing, with no database lookup', async () => {
  const auth = createAuth({ pool: neverPool(), env: { APP_ORIGIN: env.APP_ORIGIN }, mailer: inertMailer });
  assert.equal(auth.mode, 'email');
  assert.equal(auth.configured, false);
  assert.equal(await auth.session(request()), null);
  await assert.rejects(auth.handle(request(), response(), new URL('/api/auth/signup', env.APP_ORIGIN), {}),
    error => error.code === 'auth_not_configured' && error.status === 503);
  const res = response();
  assert.equal(await auth.handle(request('GET'), res, new URL('/api/session', env.APP_ORIGIN)), true);
  assert.deepEqual(res.body, { authenticated: false, authMode: 'email' });
});

test('all auth POSTs enforce exact origin; GET cannot consume tokens or mutate accounts', async () => {
  const auth = createAuth({ pool: neverPool(), env, mailer: inertMailer });
  for (const path of ['signup', 'login', 'logout', 'forgot-password', 'resend-verification', 'verify-email', 'reset-password']) {
    const url = new URL(`/api/auth/${path}`, env.APP_ORIGIN);
    for (const origin of [undefined, 'null', 'https://evil.example.com', `${env.APP_ORIGIN}/`, 'http://merchant.mulchcheckout.com']) {
      await assert.rejects(auth.handle(request('POST', origin, { host: 'merchant.mulchcheckout.com',
        'x-forwarded-host': 'merchant.mulchcheckout.com' }), response(), url, {}),
      error => error.code === 'csrf_invalid' && error.status === 403);
    }
    await assert.rejects(auth.handle(request('GET'), response(), url),
      error => error.code === 'method_not_allowed' && error.status === 405);
  }
  assert.equal(await auth.handle(request('GET'), response(), new URL('/api/stores', env.APP_ORIGIN)), false);
});

test('CSRF requires the exact configured origin and a timing-safe matching token', () => {
  const auth = createAuth({ pool: neverPool(), env, mailer: inertMailer });
  const csrfToken = randomBytes(32).toString('base64url');
  const current = { user: { id: 'isolated-unit-input' }, csrfToken };
  assert.equal(auth.verifyCsrf(request('POST', env.APP_ORIGIN, { 'x-csrf-token': csrfToken }), current), true);
  assert.equal(auth.verifyCsrf(request('POST', 'https://evil.example.com', { 'x-csrf-token': csrfToken }), current), false);
  assert.equal(auth.verifyCsrf(request('POST', env.APP_ORIGIN, { 'x-csrf-token': randomBytes(32).toString('base64url') }), current), false);
  assert.equal(auth.verifyCsrf(request(), current), false);
  assert.equal(auth.verifyCsrf(request('POST', env.APP_ORIGIN, { 'x-csrf-token': csrfToken }), null), false);
  assert.equal(auth.verifyCsrf(request('POST', env.APP_ORIGIN, { 'x-csrf-token': 'x'.repeat(100000) }), current), false);
});

test('auth body rejects unknown plan, redirect, verification and provider fields before SQL', async () => {
  const auth = createAuth({ pool: neverPool(), env, mailer: inertMailer });
  const inputs = {
    signup: { name: 'Unit Test', email: 'unit@example.test', password: PASSWORD, plan: 'premium' },
    login: { email: 'unit@example.test', password: PASSWORD, verified: true },
    logout: { redirect: 'https://evil.example.com' },
    'forgot-password': { email: 'unit@example.test', redirect: 'https://evil.example.com' },
    'resend-verification': { email: 'unit@example.test', auth_provider: 'whop' },
    'verify-email': { token: randomBytes(32).toString('base64url'), plan: 'premium' },
    'reset-password': { token: randomBytes(32).toString('base64url'), password: PASSWORD, autoLogin: true },
  };
  for (const [path, body] of Object.entries(inputs)) {
    await assert.rejects(auth.handle(request(), response(), new URL(`/api/auth/${path}`, env.APP_ORIGIN), body),
      error => error.code === 'unknown_field');
  }
});

test('Resend adapter uses the documented endpoint and server fields only, with mocked transport', async () => {
  const calls = [];
  const mailer = createMailer({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    return { ok: true, body: { async cancel() {} } };
  } });
  const token = randomBytes(32).toString('base64url');
  await mailer.sendVerification({ email: 'unit@example.test', token });
  await mailer.sendPasswordReset({ email: 'unit@example.test', token });
  await mailer.sendPasswordChanged({ email: 'unit@example.test' });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
    assert.equal(call.payload.from, env.AUTH_EMAIL_FROM);
    assert.deepEqual(call.payload.to, ['unit@example.test']);
    assert.deepEqual(Object.keys(call.payload).sort(), ['from', 'html', 'subject', 'text', 'to']);
    assert.ok(call.options.signal);
    assert.ok(call.options.headers['Idempotency-Key']);
  }
  assert.match(calls[0].payload.text, new RegExp(`${env.APP_ORIGIN}/verify-email\\?token=`));
  assert.match(calls[1].payload.text, /reset-password\?token=/);
  assert.ok(!calls[2].payload.text.includes(token));
  assert.ok(!calls[2].payload.text.includes(PASSWORD));
  assert.notEqual(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
});

test('Resend errors never expose provider bodies, request secrets or email tokens', async () => {
  const secret = 'provider-sensitive-response';
  const token = randomBytes(32).toString('base64url');
  const mailer = createMailer({ env, fetchImpl: async () => { throw new Error(secret); } });
  await assert.rejects(mailer.sendPasswordReset({ email: 'unit@example.test', token }), error =>
    error.code === 'mail_delivery_failed' && !error.message.includes(secret) && !error.message.includes(token));
});
