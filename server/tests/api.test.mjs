import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { AppError } from '../src/security.js';
import { withServer, fakeEntitlements, fakeAuth, USER, ENV, CSRF } from './api-fixtures.mjs';

const forbiddenPool = { query: async () => { throw new Error('No database lookup permitted'); }, connect: async () => { throw new Error('No database connection permitted'); } };

test('application requires explicit auth and entitlement dependencies; no bypass defaults', () => {
  assert.throws(() => createApp({ pool: forbiddenPool }), /authentication interface/);
});
test('public configuration preserves fees and paid monthly plan amounts without secrets', async () => withServer(async request => {
  const result = await request('/api/public-config', { authenticated: false });
  assert.equal(result.status, 200); assert.equal(result.data.authMode, 'email');
  assert.deepEqual(result.data.policy.tiers.map(item => item.basisPoints), [280, 150, 50]);
  assert.deepEqual(result.data.policy.monthlyPlans, { standard: 150, premium: 250 });
  assert.equal(result.data.sourceOnly, true); assert.equal(result.headers.get('access-control-allow-origin'), null);
  assert.equal(JSON.stringify(result.data).includes('SECRET'), false);
}, { pool: forbiddenPool, env: { BACKEND_SERVICE_TOKEN: 'SECRET-do-not-serialize' } }));
test('session remains reachable logged out and authenticated before purchase', async () => withServer(async request => {
  assert.deepEqual((await request('/api/session', { authenticated: false })).data, { authenticated: false, authMode: 'email' });
  assert.equal((await request('/api/session')).data.user.id, USER.id);
}, { pool: forbiddenPool, entitlements: fakeEntitlements(false) }));
test('known public auth endpoints delegate before purchase, unknown demo endpoint does not', async () => withServer(async request => {
  for (const endpoint of ['signup', 'login', 'forgot-password', 'resend-verification', 'verify-email', 'reset-password', 'logout']) {
    assert.equal((await request(`/api/auth/${endpoint}`, { method: 'POST', body: {}, authenticated: false })).status, 202);
  }
  assert.equal((await request('/api/demo', { authenticated: false })).status, 401);
  assert.equal((await request('/api/auth/login')).status, 404);
}, { pool: forbiddenPool, entitlements: fakeEntitlements(false) }));
test('all dashboard routes deny unauthenticated callers', async () => withServer(async request => {
  for (const path of ['/api/stores', `/api/stores/${USER.id}/bootstrap`, `/api/stores/${USER.id}/resources/general`, `/api/stores/${USER.id}/billing`, '/api/access']) {
    assert.equal((await request(path, { authenticated: false })).status, 401);
  }
}, { pool: forbiddenPool }));
test('unpaid users cannot read or create stores, configuration, analytics or billing', async () => withServer(async request => {
  for (const suffix of ['bootstrap', 'analytics', 'orders', 'fees', 'setup-check', 'billing', 'resources/general', 'ai-mcp']) {
    const result = await request(`/api/stores/${USER.id}/${suffix}`);
    assert.equal(result.status, 402); assert.equal(result.data.error, 'subscription_required');
  }
  assert.equal((await request('/api/stores')).status, 402);
  assert.equal((await request('/api/stores', { method: 'POST', body: {} })).status, 402);
}, { pool: forbiddenPool, entitlements: fakeEntitlements(false) }));
test('access and refresh are auth-only, refresh requires exact origin and session CSRF', async () => withServer(async request => {
  assert.equal((await request('/api/access')).data.hasAccess, false);
  assert.equal((await request('/api/access/refresh', { method: 'POST', body: {} })).status, 200);
  for (const options of [{ csrf: null }, { csrf: 'wrong' }, { origin: null }, { origin: 'https://foreign.example.test' }]) {
    const result = await request('/api/access/refresh', { method: 'POST', body: {}, ...options });
    assert.equal(result.status, 403); assert.equal(result.data.error, 'csrf_invalid');
  }
  assert.equal((await request('/api/access/refresh', { method: 'POST', body: { plan: 'premium' } })).status, 400);
}, { pool: forbiddenPool, entitlements: fakeEntitlements(false) }));
test('private mutations enforce CSRF even when account is paid', async () => withServer(async request => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) assert.equal((await request('/api/stores', { method, body: {}, csrf: null })).status, 403);
}, { pool: forbiddenPool }));
test('paid store list is empty without store facts, not seeded or synthetic', async () => withServer(async request => {
  const result = await request('/api/stores'); assert.equal(result.status, 200); assert.deepEqual(result.data, { stores: [] });
}));
test('foreign or nonexistent store is 404 even if global access exists', async () => withServer(async request => {
  assert.equal((await request(`/api/stores/${USER.id}/bootstrap`)).status, 404);
  assert.equal((await request('/api/stores/not-a-uuid/fees')).status, 404);
}));
test('database secrets and SQL errors never reach response bodies', async () => withServer(async request => {
  const result = await request('/api/stores'); assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.data).includes('postgres://'), false);
  assert.equal(JSON.stringify(result.data).includes('SELECT'), false);
}, { pool: { ...forbiddenPool, query: async () => { throw new Error('SELECT password postgres://secret'); } } }));
test('AppError is preserved and duplicate-store SQL error is sanitized conflict', async () => {
  for (const [error, code, status] of [[new AppError('premium_required', 'Premium required', 403), 'premium_required', 403], [Object.assign(new Error('private SQL'), { code: '23505' }), 'conflict', 409]]) {
    await withServer(async request => { const result = await request('/api/stores'); assert.equal(result.status, status); assert.equal(result.data.error, code); }, { pool: { ...forbiddenPool, query: async () => { throw error; } } });
  }
});
test('standalone static files and SPA routes have CSP and frame denial; missing API/assets do not become HTML', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mulch-static-test-'));
  try {
    await mkdir(path.join(root, 'assets')); await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Mulch test shell</title>'); await writeFile(path.join(root, 'assets', 'test.js'), 'export const test = true;');
    await withServer(async request => {
      for (const route of ['/', '/settings/general', '/verify-email?token=not-consumed']) {
        const result = await request(route, { authenticated: false }); assert.equal(result.status, 200);
        assert.equal(result.headers.get('x-frame-options'), 'DENY'); assert.match(result.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        assert.match(result.headers.get('content-security-policy'), /script-src 'self'/);
      }
      assert.equal((await request('/assets/test.js')).status, 200);
      assert.equal((await request('/assets/missing.js')).status, 404);
      assert.equal((await request('/.env')).status, 404);
      assert.equal((await request('/api/not-a-route')).status, 404);
    }, { env: { CLIENT_DIST: root } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing client build fails honestly without starting a service or returning example dashboard', async () => withServer(async request => {
  const result = await request('/', { authenticated: false }); assert.equal(result.status, 503); assert.equal(result.data.error, 'client_not_built');
}, { env: { CLIENT_DIST: '/tmp/mulch-nonexistent-test-build' } }));
