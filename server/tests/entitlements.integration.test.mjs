import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createEntitlements, SELLER_PLANS } from '../src/entitlements.js';

const connection = process.env.TEST_DATABASE_URL;
const safe = connection && /^mulch_.*_test$/.test(new URL(connection).pathname.slice(1)) && ['127.0.0.1', 'localhost'].includes(new URL(connection).hostname);
const money = amount => ({ amount, currency: 'usd', decimals: 2, display_decimals: 2 });

test('PostgreSQL paid proof: real durable lease, one-store binding, revocation, pagination and no client grant', { skip: !safe }, async () => {
  const pool = new Pool({ connectionString: connection });
  const id = randomUUID();
  const user = { id, name: 'Entitlement test', email: `paid-${id}@example.test` };
  const storeId = randomUUID();
  const now = Date.now();
  const start = new Date(now - 60_000).toISOString();
  const end = new Date(now + 86_400_000).toISOString();
  const membershipId = 'mem_' + id.replaceAll('-', '');
  const memberId = 'mber_' + id.replaceAll('-', '');
  const providerUser = 'user_' + id.replaceAll('-', '');
  let failed = false;
  let state = 'active';
  const requests = [];
  const transport = async (raw, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer mocked-provider-token-only');
    const url = new URL(raw);
    assert.equal(url.origin, 'https://api.whop.com');
    assert.equal(url.searchParams.get('account_id'), 'biz_Mulch');
    requests.push(url);
    if (failed) return new Response('{}', { status: 503 });
    let data;
    if (url.pathname === '/api/v1/members') {
      assert.equal(options.headers['Api-Version-Date'], '2026-11-19-2');
      assert.equal(url.searchParams.get('query'), user.email);
      data = [{ id: memberId, account_id: 'biz_Mulch', email: user.email, user: { id: providerUser } }];
    } else if (url.pathname === '/api/v1/memberships') {
      assert.equal(options.headers['Api-Version-Date'], '2026-11-23-3');
      assert.equal(url.searchParams.get('member_id'), memberId);
      assert.deepEqual(url.searchParams.getAll('variant_ids'), SELLER_PLANS.map(plan => plan.variantId));
      if (!url.searchParams.has('after')) return new Response(JSON.stringify({ data: [], page_info: { has_next_page: true, end_cursor: 'page-two' } }));
      assert.equal(url.searchParams.get('after'), 'page-two');
      data = [{ id: membershipId, member_id: memberId, user_id: providerUser, account: { id: 'biz_Mulch' },
        variant_id: SELLER_PLANS[0].variantId, status: state, current_period_start: start, current_period_end: end, expires_at: null }];
    } else if (url.pathname === '/api/v1/payments') {
      assert.equal(url.searchParams.get('membership_id'), membershipId);
      data = [{ id: 'pay_Test', account_id: 'biz_Mulch', member_id: memberId, membership_id: membershipId, variant_id: SELLER_PLANS[0].variantId,
        customer_email: user.email, status: 'paid', substatus: 'succeeded', auto_refunded: false,
        paid_at: new Date(now - 30_000).toISOString(), total: money('150.00'), refunded_amount: money('0.00'),
        presentment_refunded_amount: money('0.00'), billing_reason: 'subscription_create' }];
    } else throw new Error('Unexpected provider path');
    return new Response(JSON.stringify({ data, page_info: { has_next_page: false, end_cursor: null } }));
  };
  const billing = createEntitlements({ pool, env: { BILLING_VERIFICATION_ENABLED: 'yes', MULCH_BILLING_ENVIRONMENT: 'production',
    MULCH_BILLING_ACCOUNT_ID: 'biz_Mulch', MULCH_BILLING_API_KEY: 'mocked-provider-token-only' }, transport });
  try {
    await pool.query(`INSERT INTO mulch_users(id,email,name,auth_provider,email_verified_at) VALUES($1,$2,$3,'email',now())`, [id, user.email, user.name]);
    const first = await billing.refresh(user);
    assert.equal(first.hasAccess, true);
    assert.equal(first.entitlements.length, 1);
    assert.equal(first.entitlements[0].plan, 'standard');
    const entitlement = first.entitlements[0].id;
    await pool.query('INSERT INTO mulch_app_stores(id,owner_id,name,shop_domain,country) VALUES($1,$2,$3,$4,$5)', [storeId, id, 'Test store', `paid-${id}.myshopify.com`, 'US']);
    await pool.query('UPDATE mulch_entitlements SET store_id=$2 WHERE id=$1', [entitlement, storeId]);
    const cached = await billing.access(user);
    assert.equal(cached.entitlements[0].storeId, storeId);
    const count = requests.length;
    await billing.access(user);
    assert.equal(requests.length, count, 'fresh access uses the short durable lease');
    await pool.query("UPDATE mulch_billing_checks SET checked_at=now()-interval '20 seconds',expires_at=now()-interval '1 second' WHERE user_id=$1", [id]);
    const refreshed = await billing.refresh(user);
    assert.equal(refreshed.entitlements[0].id, entitlement);
    assert.equal(refreshed.entitlements[0].storeId, storeId, 'refresh never frees or changes the store binding');
    failed = true;
    await pool.query("UPDATE mulch_billing_checks SET checked_at=now()-interval '20 seconds',expires_at=now()-interval '1 second' WHERE user_id=$1", [id]);
    const denied = await billing.refresh(user);
    assert.equal(denied.hasAccess, false);
    assert.deepEqual(denied.entitlements, []);
    const retained = await pool.query('SELECT active,store_id FROM mulch_entitlements WHERE id=$1', [entitlement]);
    assert.equal(retained.rows[0].active, false);
    assert.equal(retained.rows[0].store_id, storeId, 'denial retains store data and binding');
    failed = false; state = 'trialing';
    await pool.query("UPDATE mulch_billing_checks SET checked_at=now()-interval '20 seconds',expires_at=now()-interval '1 second' WHERE user_id=$1", [id]);
    assert.equal((await billing.refresh(user)).hasAccess, false);
  } finally {
    await pool.query('DELETE FROM mulch_billing_checks WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM mulch_entitlements WHERE user_id=$1', [id]);
    await pool.query('DELETE FROM mulch_app_stores WHERE id=$1', [storeId]);
    await pool.query('DELETE FROM mulch_users WHERE id=$1', [id]);
    await pool.end();
  }
});
