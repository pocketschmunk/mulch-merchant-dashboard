import test from 'node:test';
import assert from 'node:assert/strict';
import { paidGate, resolveRoute, routes, unassignedEntitlements } from '../src/lib/routes';
import { loadAccess, validStoreAccess } from '../src/lib/access';
import { ApiError, request, safeExternalUrl, storePath } from '../src/lib/api';
import type { Access, Session, Store } from '../src/types';
import type { Requester } from '../src/lib/api';
const session: Session = { authenticated: true, user: { id: 'owner', email: 'owner@example.test', name: 'Owner' }, csrfToken: 'test-csrf', authMode: 'email' };
const access: Access = { hasAccess: true, entitlements: [{ id: 'paid', status: 'active', plan: 'standard', storeId: null }], plans: [], verification: { configured: true, message: 'Internal test proof' } };
const store: Store = { id: 'store', name: 'Internal test store', shopDomain: 'test.myshopify.com', country: 'US', plan: 'standard', planStatus: 'active', readiness: { shopify: 'unconnected', payments: 'unconnected', storeReview: 'pending', consent: false }, lifetimeGrossMinor: '0', earnedBasisPoints: 280 };
test('login and purchase are distinct from dashboard access', () => {
  assert.equal(paidGate(null, access), 'login'); assert.equal(paidGate({ authenticated: false }, access), 'login');
  assert.equal(paidGate({ ...session, csrfToken: undefined }, access), 'login');
  assert.equal(paidGate(session, null), 'purchase'); assert.equal(paidGate(session, { ...access, hasAccess: false }), 'purchase');
  assert.equal(paidGate(session, { ...access, verification: { configured: false, message: '' } }), 'purchase');
  assert.equal(paidGate(session, { ...access, entitlements: [] }), 'purchase');
  assert.equal(paidGate(session, access), 'dashboard');
});
for (const status of ['past_due', 'trialing', 'expired', 'completed', 'unverified', 'canceled']) test(`${status} membership cannot grant client dashboard access`, () => {
  assert.equal(paidGate(session, { ...access, entitlements: [{ ...access.entitlements[0], status }] }), 'purchase');
});
test('creator uses only active unassigned server entitlements', () => {
  const result = unassignedEntitlements({ ...access, entitlements: [...access.entitlements, { id: 'bound', status: 'active', plan: 'premium', storeId: 'store' }, { id: 'expired', status: 'expired', plan: 'standard', storeId: null }] });
  assert.deepEqual(result.map(item => item.id), ['paid']); assert.deepEqual(unassignedEntitlements({ ...access, hasAccess: false }), []);
});
test('only active stores with exact current membership binding and plan are accepted', () => {
  assert.equal(validStoreAccess(store, access), false);
  const bound = { ...access, entitlements: [{ ...access.entitlements[0], storeId: store.id }] };
  assert.equal(validStoreAccess(store, bound), true); assert.equal(validStoreAccess({ ...store, plan: 'premium' }, bound), false);
  assert.equal(validStoreAccess(store, { ...bound, hasAccess: false }), false);
});
test('unpaid access load never requests stores, dashboard, bootstrap or resource APIs', async () => {
  const calls: string[] = []; const api: Requester = async <T>(path: string) => { calls.push(path); return { ...access, hasAccess: false } as T; };
  const result = await loadAccess(api, session); assert.deepEqual(calls, ['/api/access']); assert.deepEqual(result.stores, []);
});
test('no session means no API request', async () => {
  const api: Requester = async () => { throw new Error('Must not request'); };
  assert.deepEqual(await loadAccess(api, { authenticated: false }), { access: null, stores: [] });
});
test('payment refresh POST uses CSRF and only then loads active bound stores', async () => {
  const calls: { path: string; options: unknown }[] = []; const bound = { ...access, entitlements: [{ ...access.entitlements[0], storeId: store.id }] };
  const api: Requester = async <T>(path: string, options?: unknown) => { calls.push({ path, options }); return (path === '/api/stores' ? { stores: [store, { ...store, id: 'foreign' }] } : bound) as T; };
  assert.deepEqual((await loadAccess(api, session, true)).stores, [store]);
  assert.deepEqual(calls, [{ path: '/api/access/refresh', options: { method: 'POST', csrf: 'test-csrf', body: {} } }, { path: '/api/stores', options: undefined }]);
});
test('missing provider proof and provider failure cannot load stores', async () => {
  const calls: string[] = []; const api: Requester = async <T>(path: string) => { calls.push(path); throw new ApiError(503, 'not_configured', 'No proof'); };
  await assert.rejects(loadAccess(api, session), /No proof/); assert.deepEqual(calls, ['/api/access']);
});
test('route set excludes public demos, arbitrary bypasses and URL success grants', () => {
  for (const path of ['/demo', '/demo/checkout/design', '/dashboard?success=true', '/purchase?plan=premium&success=true', '/free', '/dashboard/unknown']) assert.equal(resolveRoute(path), null);
  assert.equal(new Set(routes.map(route => route.path)).size, routes.length);
  for (const route of routes) assert.equal(resolveRoute(`/dashboard${route.path ? '/' + route.path : ''}`)?.path, route.path);
});
test('safe provider URLs refuse credentials and executable schemes', () => {
  for (const value of ['javascript:alert(1)', 'http://provider.test', '//provider.test', 'https://user:pass@provider.test']) assert.equal(safeExternalUrl(value), null);
  assert.equal(safeExternalUrl('https://provider.test/connect'), 'https://provider.test/connect');
  assert.equal(storePath('id/foreign', 'bootstrap'), '/api/stores/id%2Fforeign/bootstrap');
});
test('request refuses non-API paths and missing mutation CSRF, including logout', async () => {
  await assert.rejects(request('https://provider.test'), /Only same-origin/);
  await assert.rejects(request('/api/stores', { method: 'POST', body: {} }), /CSRF/);
  await assert.rejects(request('/api/auth/logout', { method: 'POST', body: {} }), /CSRF/);
});
test('API private mutations use same-origin cookies, no-store and exact CSRF header', async () => {
  const original = globalThis.fetch; let observed: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => { observed = init; return new Response(JSON.stringify({ item: { id: 'saved' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try { await request('/api/stores/store/resources/offer', { method: 'POST', csrf: 'csrf', body: { title: 'Draft', config: {} } }); assert.equal(observed?.credentials, 'same-origin'); assert.equal(observed?.cache, 'no-store'); assert.equal((observed?.headers as Record<string, string>)['X-CSRF-Token'], 'csrf'); assert.deepEqual(JSON.parse(String(observed?.body)), { title: 'Draft', config: {} }); } finally { globalThis.fetch = original; }
});
test('API errors and non-JSON failures preserve fail-closed error states', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'subscription_required', message: 'Paid proof required' }), { status: 402 });
    await assert.rejects(request('/api/stores'), error => error instanceof ApiError && error.status === 402 && error.code === 'subscription_required');
    globalThis.fetch = async () => new Response('<html>login</html>', { status: 200 }); await assert.rejects(request('/api/access'), /expected JSON/);
    globalThis.fetch = async () => { throw new Error('Network unavailable'); }; await assert.rejects(request('/api/access'), /No account data or changes have been confirmed/);
  } finally { globalThis.fetch = original; }
});

test('plan changes reload current authorized store metadata and preserve a paid binding', async () => {
  const { reconcilePaidStores, paidBindingKey } = await import('../src/lib/access');
  for (const plan of ['standard', 'premium'] as const) {
    const current = { ...store, plan };
    const changed = { ...access, entitlements: [{ ...access.entitlements[0], plan, storeId: store.id }] };
    const previous = { ...access, entitlements: [{ ...access.entitlements[0], plan: plan === 'standard' ? 'premium' as const : 'standard' as const, storeId: store.id }] };
    assert.notEqual(paidBindingKey(previous), paidBindingKey(changed));
    const calls: string[] = [];
    const api: Requester = async <T>(path: string) => { calls.push(path); return { stores: [current] } as T; };
    const result = await reconcilePaidStores(api, changed, store.id);
    assert.deepEqual(calls, ['/api/stores']);
    assert.equal(result.storeId, store.id);
    assert.deepEqual(result.stores, [current]);
    assert.equal(paidGate(session, changed), 'dashboard');
  }
});
test('reconciliation never reloads private stores on lost paid evidence', async () => {
  const { reconcilePaidStores } = await import('../src/lib/access');
  const api: Requester = async () => { throw new Error('must not call private API'); };
  assert.deepEqual(await reconcilePaidStores(api, { ...access, hasAccess: false }, store.id), { stores: [], storeId: '' });
});
