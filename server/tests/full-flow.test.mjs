import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { createEntitlements, SELLER_PLANS } from '../src/entitlements.js';

const database = process.env.TEST_DATABASE_URL;
const safe = database && /^mulch_.*_test$/.test(new URL(database).pathname.slice(1)) && ['127.0.0.1', 'localhost'].includes(new URL(database).hostname);
const money = amount => ({ amount, currency: 'usd', decimals: 2, display_decimals: 2 });

test('assembled HTTP: email proof alone is unpaid; captured Whop plan unlocks one store, not Premium or live operations', { skip: !safe }, async () => {
  const schema = 'mulch_flow_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: database, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString: database, options: `-c search_path=${schema}`, max: 4 });
  const email = `flow-${randomUUID()}@example.test`;
  const password = 'An original long passphrase 2026';
  const env = { APP_ORIGIN: 'https://app.mulchcheckout.com', RESEND_API_KEY: 'test-mail-only', AUTH_EMAIL_FROM: 'accounts@mulchcheckout.com',
    BILLING_VERIFICATION_ENABLED: 'yes', MULCH_BILLING_ENVIRONMENT: 'production', MULCH_BILLING_ACCOUNT_ID: 'biz_Mulch',
    MULCH_BILLING_API_KEY: 'mocked-provider-token-only', WHOP_ENVIRONMENT: 'disabled' };
  let verificationToken;
  let paid = false;
  let user;
  const memberId = 'mber_Flow';
  const membershipId = 'mem_Flow';
  const now = Date.now();
  const start = new Date(now - 60_000).toISOString();
  const end = new Date(now + 86_400_000).toISOString();
  const mailer = {
    async sendVerification(message) { assert.equal(message.email, email); verificationToken = message.token; },
    async sendPasswordReset() {}, async sendPasswordChanged() {}
  };
  const transport = async (raw, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer mocked-provider-token-only');
    const path = new URL(raw).pathname;
    let data = [];
    if (paid && path === '/api/v1/members') data = [{ id: memberId, account_id: 'biz_Mulch', email, user: { id: 'user_Flow' } }];
    else if (paid && path === '/api/v1/memberships') data = [{ id: membershipId, member_id: memberId, user_id: 'user_Flow', account: { id: 'biz_Mulch' },
      variant_id: SELLER_PLANS[0].variantId, status: 'active', current_period_start: start, current_period_end: end, expires_at: null }];
    else if (paid && path === '/api/v1/payments') data = [{ id: 'pay_Flow', account_id: 'biz_Mulch', member_id: memberId, membership_id: membershipId,
      variant_id: SELLER_PLANS[0].variantId, customer_email: email, status: 'paid', substatus: 'succeeded', auto_refunded: false,
      paid_at: new Date(now - 30_000).toISOString(), total: money('150.00'), refunded_amount: money('0.00'),
      presentment_refunded_amount: money('0.00'), billing_reason: 'subscription_create' }];
    return new Response(JSON.stringify({ data, page_info: { has_next_page: false, end_cursor: null } }));
  };
  let server;
  let cookie = '';
  let csrf = '';
  try {
    for (const file of ['../migrations/000_auth.sql', '../migrations/001_entitlements.sql', '../../fee-service/migrations/001_fee_ledger.sql', '../migrations/002_app.sql']) {
      await pool.query(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    const auth = createAuth({ pool, env, mailer });
    const entitlements = createEntitlements({ pool, env, transport });
    server = createApp({ pool, env, auth, entitlements });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = 'GET', body, withCsrf = true } = {}) {
      const response = await fetch(origin + path, { method, headers: {
        ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' } : {}),
        ...(csrf && withCsrf ? { 'X-CSRF-Token': csrf } : {})
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
    }
    assert.equal((await request('/api/stores')).status, 401);
    const signup = await request('/api/auth/signup', { method: 'POST', body: { name: 'Flow merchant', email, password } });
    assert.equal(signup.status, 202);
    assert.equal(JSON.stringify(signup.data).includes(verificationToken), false, 'token is never an API result');
    assert.ok(verificationToken);
    assert.notEqual((await request('/api/auth/login', { method: 'POST', body: { email, password } })).status, 200);
    assert.equal((await request('/api/auth/verify-email', { method: 'POST', body: { token: verificationToken } })).status, 200);
    const login = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200);
    assert.match(login.cookie, /^__Host-mulch_session=/);
    assert.match(login.cookie, /HttpOnly/); assert.match(login.cookie, /Secure/);
    cookie = login.cookie.split(';')[0]; csrf = login.data.csrfToken; user = login.data.user;
    assert.ok(user.id); assert.ok(csrf);
    assert.equal((await request('/api/access')).data.hasAccess, false);
    assert.equal((await request('/api/stores?status=succeeded&plan=premium')).status, 402, 'browser success cannot unlock dashboard');
    assert.equal((await request('/api/access/refresh', { method: 'POST', body: {}, withCsrf: false })).status, 403);
    paid = true;
    await pool.query("UPDATE mulch_billing_checks SET checked_at=now()-interval '20 seconds',expires_at=now()-interval '1 second' WHERE user_id=$1", [user.id]);
    const access = await request('/api/access/refresh', { method: 'POST', body: {} });
    assert.equal(access.status, 200); assert.equal(access.data.hasAccess, true);
    const store = await request('/api/stores', { method: 'POST', body: { name: 'Flow store', shopDomain: `flow-${schema.slice(-16)}.myshopify.com`,
      country: 'US', entitlementId: access.data.entitlements[0].id } });
    assert.equal(store.status, 201); assert.equal(store.data.store.plan, 'standard');
    const id = store.data.store.id;
    assert.equal((await request('/api/stores', { method: 'POST', body: { name: 'Extra free store', shopDomain: 'extra-flow.myshopify.com', country: 'US', entitlementId: access.data.entitlements[0].id } })).status, 409);
    const bootstrap = await request(`/api/stores/${id}/bootstrap`);
    assert.equal(bootstrap.status, 200); assert.equal(bootstrap.data.analytics.revenueMinor, '0');
    assert.equal((await request(`/api/stores/${id}/subscribers`)).status, 403);
    const resource = await request(`/api/stores/${id}/resources/thank-you`, { method: 'POST', body: { title: 'Thanks', config: { heading: 'Thank you', message: 'Order received', showOrderSummary: true } } });
    assert.equal(resource.status, 201);
    assert.equal((await request(`/api/stores/${id}/resources/thank-you/${resource.data.item.id}/activate`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await request(`/api/stores/${id}/connections/payments`, { method: 'POST', body: { action: 'connect' } })).status, 503);
    const logout = await request('/api/auth/logout', { method: 'POST', body: {} });
    assert.equal(logout.status, 200);
    assert.equal((await request('/api/session')).data.authenticated, false);
    assert.equal((await request(`/api/stores/${id}/bootstrap`)).status, 401);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
