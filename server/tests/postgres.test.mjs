import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { withServer, fakeAuth, fakeEntitlements, design } from './api-fixtures.mjs';

const connectionString = process.env.TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  const database = decodeURIComponent(target.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || (!/^mulch_[a-z0-9_]+_test$/.test(database) && process.env.TEST_ALLOW_ISOLATED_DATABASE !== 'yes')) {
    throw new Error('Refusing integration tests: TEST_DATABASE_URL must name mulch_*_test or the parent must explicitly confirm TEST_ALLOW_ISOLATED_DATABASE=yes. No connection was opened.');
  }
}
const general = { currency: 'usd', timezone: 'UTC', supportEmail: 'support@example.test', customDomain: '' };
const portal = { allowPause: true, allowDeliveryChange: true, allowPaymentUpdate: true, allowCancel: true };

test('PostgreSQL merchant API: isolated database only', { skip: !connectionString }, async t => {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const owner = { id: randomUUID(), email: `api-owner-${randomUUID()}@example.test`, name: 'API fixture owner' };
  const other = { id: randomUUID(), email: `api-other-${randomUUID()}@example.test`, name: 'API fixture other' };
  const users = [owner.id, other.id];
  const entitlements = [];
  let standardStore; let premiumStore; let standardEntitlement; let premiumEntitlement; let durableResource;
  const options = user => ({ pool, auth: fakeAuth(user), entitlements: fakeEntitlements(true) });
  const addEntitlement = async (user, plan, overrides = {}) => {
    const id = randomUUID(); entitlements.push(id);
    await pool.query(`INSERT INTO mulch_entitlements(id,user_id,provider_membership_id,provider_member_id,provider_user_id,provider_account_id,provider_variant_id,payment_id,plan,status,active,paid_until,verified_at,verification_expires_at)
      VALUES($1,$2,$3,'mbr_Test','usr_Test','biz_Test',$4,'pay_Test',$5,$6,$7,now()+interval '30 days',now(),now()+interval '1 hour')`,
    [id, user.id, `mem_Test${id.replaceAll('-', '')}`, plan === 'premium' ? 'var_TestPremium' : 'var_TestStandard', plan, overrides.status || 'active', overrides.active ?? true]);
    if (overrides.expired) await pool.query("UPDATE mulch_entitlements SET verification_expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    if (overrides.unpaid) await pool.query("UPDATE mulch_entitlements SET paid_until=now()-interval '1 second' WHERE id=$1", [id]);
    return id;
  };
  const create = (request, id, domainSuffix, extras = {}) => request('/api/stores', { method: 'POST', body: { name: 'Durable fixture store', shopDomain: `test-${domainSuffix}.myshopify.com`, country: 'US', entitlementId: id, ...extras } });
  try {
    for (const relative of ['../migrations/000_auth.sql', '../migrations/001_entitlements.sql', '../../fee-service/migrations/001_fee_ledger.sql', '../migrations/002_app.sql']) await pool.query(await readFile(new URL(relative, import.meta.url), 'utf8'));
    for (const user of [owner, other]) await pool.query("INSERT INTO mulch_users(id,email,name,auth_provider,email_verified_at) VALUES($1,$2,$3,'email',now())", [user.id, user.email, user.name]);
    standardEntitlement = await addEntitlement(owner, 'standard'); premiumEntitlement = await addEntitlement(other, 'premium');
    await withServer(async request => {
      const created = await create(request, standardEntitlement, randomUUID());
      assert.equal(created.status, 201); standardStore = created.data.store;
      assert.equal(standardStore.plan, 'standard'); assert.equal(standardStore.planStatus, 'active');
      assert.deepEqual(standardStore.readiness, { shopify: 'unconnected', payments: 'unconnected', storeReview: 'pending', consent: false });
    }, options(owner));
    await withServer(async request => { const created = await create(request, premiumEntitlement, randomUUID()); assert.equal(created.status, 201); premiumStore = created.data.store; }, options(other));

    await t.test('plan/status/client verified fields rejected and an owned purchased membership binds once', async () => withServer(async request => {
      for (const extras of [{ plan: 'premium' }, { planStatus: 'active' }, { merchantVerified: true }]) assert.equal((await create(request, standardEntitlement, randomUUID(), extras)).status, 400);
      assert.equal((await create(request, standardEntitlement, randomUUID())).status, 409);
      assert.equal((await create(request, premiumEntitlement, randomUUID())).status, 404);
      const binding = (await pool.query('SELECT store_id,plan FROM mulch_entitlements WHERE id=$1', [standardEntitlement])).rows[0];
      assert.equal(binding.store_id, standardStore.id); assert.equal(binding.plan, 'standard');
    }, options(owner)));

    await t.test('concurrent creates row-lock one active unassigned entitlement and create exactly one store', async () => {
      const entitlement = await addEntitlement(owner, 'standard');
      await withServer(async request => {
        const results = await Promise.all([create(request, entitlement, randomUUID()), create(request, entitlement, randomUUID())]);
        assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
        const binding = (await pool.query('SELECT store_id FROM mulch_entitlements WHERE id=$1', [entitlement])).rows[0];
        assert.ok(binding.store_id);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM mulch_app_stores WHERE id=$1', [binding.store_id])).rows[0].count, 1);
      }, options(owner));
    });
    await t.test('expired, inactive, past-due and unpaid entitlements cannot create a store', async () => {
      for (const overrides of [{ expired: true }, { active: false }, { status: 'past_due' }, { unpaid: true }]) {
        const entitlement = await addEntitlement(owner, 'standard', overrides);
        await withServer(async request => assert.equal((await create(request, entitlement, randomUUID())).status, 402), options(owner));
        assert.equal((await pool.query('SELECT store_id FROM mulch_entitlements WHERE id=$1', [entitlement])).rows[0].store_id, null);
      }
    });
    await t.test('tenant store and resource endpoints remain 404 for another paid user', async () => withServer(async request => {
      for (const suffix of ['bootstrap', 'fees', 'analytics', 'orders', 'resources/general', 'billing', 'setup-check']) assert.equal((await request(`/api/stores/${premiumStore.id}/${suffix}`)).status, 404);
      assert.ok((await request('/api/stores')).data.stores.every(store => store.id !== premiumStore.id));
    }, options(owner)));
    await t.test('durable resource create/read/update, exact field validation and optimistic concurrent conflict', async () => withServer(async request => {
      const base = `/api/stores/${standardStore.id}/resources/general`;
      const created = await request(base, { method: 'POST', body: { title: 'Store settings', config: general } });
      assert.equal(created.status, 201); durableResource = created.data.item;
      assert.equal(durableResource.status, 'draft'); assert.equal(durableResource.version, 1);
      assert.equal((await request(base)).data.items.find(item => item.id === durableResource.id).config.timezone, 'UTC');
      const updates = await Promise.all(['First', 'Second'].map(title => request(`${base}/${durableResource.id}`, { method: 'PUT', body: { title, config: general, version: 1 } })));
      assert.deepEqual(updates.map(result => result.status).sort(), [200, 409]);
      assert.equal((await pool.query('SELECT version,status FROM mulch_app_resources WHERE id=$1', [durableResource.id])).rows[0].version, 2);
      assert.equal((await request(`${base}/${durableResource.id}`, { method: 'PUT', body: { title: 'Bad', config: { ...general, apiKey: 'secret' }, version: 2 } })).status, 400);
      assert.equal((await request(base, { method: 'POST', csrf: null, body: { title: 'No CSRF', config: general } })).status, 403);
    }, options(owner)));
    await t.test('resource data survives a fresh app instance; foreign resource IDs cannot overwrite/delete', async () => withServer(async request => {
      const base = `/api/stores/${standardStore.id}/resources/general`;
      assert.equal((await request(base)).data.items.some(item => item.id === durableResource.id && item.version === 2), true);
      assert.equal((await request(`${base}/${randomUUID()}`, { method: 'PUT', body: { title: 'Missing', config: general, version: 1 } })).status, 404);
      assert.equal((await request(`${base}/${randomUUID()}`, { method: 'DELETE' })).status, 404);
    }, options(owner)));
    await t.test('Premium reads/writes and nested subscription blocks are enforced server-side', async () => {
      await withServer(async request => {
        for (const suffix of ['resources/portal', 'resources/subscription-rule', 'resources/recovery', 'resources/cancel-flow', 'subscribers', 'recovery']) assert.equal((await request(`/api/stores/${standardStore.id}/${suffix}`)).status, 403);
        assert.equal((await request(`/api/stores/${standardStore.id}/resources/portal`, { method: 'POST', body: { title: 'Portal', config: portal } })).status, 403);
        const subscription = design([{ id: 'subscription', type: 'subscription-choice', title: 'Choose', body: 'Recurring', visible: true }]);
        assert.equal((await request(`/api/stores/${standardStore.id}/resources/checkout-design`, { method: 'POST', body: { title: 'Recurring', config: subscription } })).status, 403);
      }, options(owner));
      let recurringId, ordinaryId;
      await withServer(async request => {
        const created = await request(`/api/stores/${premiumStore.id}/resources/portal`, { method: 'POST', body: { title: 'Portal', config: portal } });
        assert.equal(created.status, 201);
        assert.equal((await request(`/api/stores/${premiumStore.id}/resources/portal`)).status, 200);
        const createdDesign = await request(`/api/stores/${premiumStore.id}/resources/checkout-design`, { method: 'POST', body: { title: 'Recurring choice', config: design([{ id: 'subscription', type: 'subscription-choice', title: 'Choice', body: '', visible: true }]) } });
        assert.equal(createdDesign.status, 201); recurringId = createdDesign.data.item.id;
        assert.equal((await request(`/api/stores/${premiumStore.id}/analytics`)).data.analytics.mrrMinor, '0');
        const ordinary = await request(`/api/stores/${premiumStore.id}/resources/checkout-design`, { method: 'POST', body: { title: 'Ordinary design', config: design([]) } });
        assert.equal(ordinary.status, 201); ordinaryId = ordinary.data.item.id;
      }, options(other));
      await pool.query("UPDATE mulch_entitlements SET plan='standard' WHERE id=$1", [premiumEntitlement]);
      await withServer(async request => {
        const library = await request(`/api/stores/${premiumStore.id}/resources/checkout-design`);
        assert.equal(library.status, 200);
        assert.ok(library.data.items.some(item => item.id === ordinaryId));
        assert.ok(!library.data.items.some(item => item.id === recurringId));
        assert.equal((await request(`/api/stores/${premiumStore.id}/resources/checkout-design/${recurringId}`, { method: 'DELETE' })).status, 403);
        const fresh = await request(`/api/stores/${premiumStore.id}/resources/checkout-design`, { method: 'POST', body: { title: 'Standard draft after downgrade', config: design([]) } });
        assert.equal(fresh.status, 201);
        assert.ok((await request(`/api/stores/${premiumStore.id}/resources/checkout-design`)).data.items.some(item => item.id === fresh.data.item.id));
        const bootstrap = await request(`/api/stores/${premiumStore.id}/bootstrap`);
        assert.equal(bootstrap.status, 200); assert.equal(bootstrap.data.resources.portal, undefined);
        assert.equal(bootstrap.data.resources['checkout-design'].some(item => item.id === recurringId), false);
      }, options(other));
      await pool.query("UPDATE mulch_entitlements SET plan='premium' WHERE id=$1", [premiumEntitlement]);
    });
    await t.test('draft activation remains 409 despite client or operator readiness claims; consent is durable only', async () => withServer(async request => {
      const activate = await request(`/api/stores/${standardStore.id}/resources/general/${durableResource.id}/activate`, { method: 'POST', body: {} });
      assert.equal(activate.status, 409); assert.equal(activate.data.error, 'operation_not_ready');
      await pool.query("INSERT INTO mulch_app_attestations(id,store_id,kind,reference,source,data,observed_at,expires_at) VALUES($1,$2,'billing',$3,'operator-reviewed','{\"plan\":\"premium\",\"verified\":true}',now(),now()+interval '1 day')", [randomUUID(), standardStore.id, randomUUID()]);
      const consent = await request(`/api/stores/${standardStore.id}/consent`, { method: 'POST', body: { policyVersion: 'mulch-2026-11-24-280-150-50', accepted: true } });
      assert.equal(consent.status, 200); assert.equal(consent.data.store.readiness.consent, true); assert.equal(consent.data.store.plan, 'standard');
      assert.equal(consent.data.store.readiness.payments, 'unconnected');
      assert.equal((await pool.query('SELECT status FROM mulch_app_resources WHERE id=$1', [durableResource.id])).rows[0].status, 'draft');
    }, options(owner)));
    await t.test('Shopify/Whop connections block honestly and legacy API key or business-ID paste is rejected', async () => withServer(async request => {
      const base = `/api/stores/${standardStore.id}/connections`;
      assert.equal((await request(`${base}/shopify`, { method: 'POST', body: { shopDomain: standardStore.shopDomain } })).status, 503);
      for (const action of ['connect', 'refresh', 'payouts']) assert.equal((await request(`${base}/payments`, { method: 'POST', body: { action } })).status, 503);
      assert.equal((await request(`${base}/payments`, { method: 'POST', body: { action: 'connect', apiKey: 'legacy', businessId: 'biz_Unrelated' } })).status, 400);
    }, options(owner)));
    await t.test('empty operational routes contain zero/empty data, no example accounts or bank-money forecast', async () => withServer(async request => {
      const base = `/api/stores/${standardStore.id}`;
      const analytics = (await request(`${base}/analytics`)).data.analytics;
      assert.equal(analytics.revenueMinor, '0'); assert.equal(analytics.orders, 0); assert.equal(analytics.mrrMinor, undefined); assert.deepEqual(analytics.series, []);
      assert.deepEqual((await request(`${base}/orders`)).data.items, []); assert.deepEqual((await request(`${base}/abandoned`)).data.items, []);
      const fees = (await request(`${base}/fees`)).data; assert.equal(fees.lifetimeGrossMinor, '0'); assert.equal(fees.collectedFeeMinor, '0');
      assert.equal((await request(`${base}/ai-mcp`)).data.verified, false);
      assert.equal((await request(`${base}/billing`)).data.plans[0].amountMinor, 15000);
      assert.equal((await request(`${base}/billing`)).data.plans[1].amountMinor, 25000);
    }, options(owner)));
    await t.test('existing verified fee ledger facts drive fees/analytics; refunded gross never reduces lifetime rate', async () => {
      const attemptId = randomUUID();
      await pool.query('INSERT INTO mulch_fee_stores(id,merchant_id,shop_domain,login_email,country,lifetime_minor,earned_basis_points) VALUES($1,$2,$3,$4,$5,$6,$7)', [standardStore.id, owner.id, standardStore.shopDomain, owner.email, 'US', '5000000', 150]);
      await pool.query(`INSERT INTO mulch_fee_attempts(id,store_id,command_key,request_hash,order_reference,policy_version,status,gross_minor,tax_minor,fee_minor,actual_fee_minor,refunded_minor,basis_points,counted_at)
        VALUES($1,$2,'fixture-only','fixture-hash','fixture-paid-order','mulch-2026-11-24-280-150-50','succeeded',10800,800,162,162,2000,150,now())`, [attemptId, standardStore.id]);
      await withServer(async request => {
        const base = `/api/stores/${standardStore.id}`; const fees = (await request(`${base}/fees`)).data;
        assert.equal(fees.lifetimeGrossMinor, '5000000'); assert.equal(fees.earnedBasisPoints, 150); assert.equal(fees.expectedFeeMinor, '162'); assert.equal(fees.collectedFeeMinor, '162'); assert.equal(fees.refundedMinor, '2000');
        const analytics = (await request(`${base}/analytics`)).data.analytics; assert.equal(analytics.revenueMinor, '10800'); assert.equal(analytics.orders, 1); assert.equal(analytics.averageOrderMinor, '10800');
        const orders = (await request(`${base}/orders`)).data.items; assert.equal(orders.length, 1); assert.equal(orders[0].source, 'verified-fee-ledger'); assert.equal(orders[0].shopifyFulfillmentVerified, false);
      }, options(owner));
    });
    await t.test('inactive/expired bound entitlements retain data but deny every store endpoint', async () => {
      await pool.query("UPDATE mulch_entitlements SET verification_expires_at=now()-interval '1 second' WHERE id=$1", [standardEntitlement]);
      await withServer(async request => {
        for (const suffix of ['bootstrap', 'analytics', 'resources/general', 'orders', 'fees', 'billing', 'setup-check']) assert.equal((await request(`/api/stores/${standardStore.id}/${suffix}`)).status, 404);
        assert.equal((await request('/api/stores')).data.stores.some(store => store.id === standardStore.id), false);
      }, options(owner));
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM mulch_app_resources WHERE id=$1', [durableResource.id])).rows[0].count, 1);
      await pool.query("UPDATE mulch_entitlements SET verification_expires_at=now()+interval '1 hour' WHERE id=$1", [standardEntitlement]);
    });
    await t.test('experiment variants must be owned Mulch designs and resource deletes are durable', async () => withServer(async request => {
      const base = `/api/stores/${standardStore.id}/resources`;
      const designs = [];
      for (const title of ['Variant A', 'Variant B']) { const result = await request(`${base}/checkout-design`, { method: 'POST', body: { title, config: design() } }); assert.equal(result.status, 201); designs.push(result.data.item.id); }
      const config = { variantA: designs[0], variantB: designs[1], splitPercent: 50, metric: 'checkout-conversion' };
      assert.equal((await request(`${base}/experiment`, { method: 'POST', body: { title: 'Foreign', config: { ...config, variantB: randomUUID() } } })).status, 404);
      const experiment = await request(`${base}/experiment`, { method: 'POST', body: { title: 'Draft test', config } }); assert.equal(experiment.status, 201);
      assert.equal((await request(`${base}/checkout-design/${designs[0]}`, { method: 'DELETE' })).status, 409);
      assert.equal((await request(`${base}/experiment/${experiment.data.item.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await request(`${base}/checkout-design/${designs[0]}`, { method: 'DELETE' })).status, 200);
      assert.equal((await request(`${base}/general/${durableResource.id}`, { method: 'DELETE' })).status, 200);
      assert.equal((await pool.query('SELECT id FROM mulch_app_resources WHERE id=$1', [durableResource.id])).rows.length, 0);
    }, options(owner)));
  } finally {
    // Delete only rows belonging to this file's randomly allocated fixture users.
    // Never truncate or clear a shared table, even in an isolated database.
    const ids = (await pool.query('SELECT id FROM mulch_app_stores WHERE owner_id=ANY($1::uuid[])', [users])).rows.map(row => row.id);
    if (ids.length) {
      await pool.query('DELETE FROM mulch_fee_attempts WHERE store_id=ANY($1::text[])', [ids]);
      await pool.query('DELETE FROM mulch_fee_stores WHERE id=ANY($1::text[])', [ids]);
      for (const table of ['mulch_app_audit', 'mulch_app_products', 'mulch_app_attestations', 'mulch_app_consents', 'mulch_app_resources']) await pool.query(`DELETE FROM ${table} WHERE store_id=ANY($1::uuid[])`, [ids]);
    }
    await pool.query('DELETE FROM mulch_entitlements WHERE id=ANY($1::uuid[])', [entitlements]);
    await pool.query('DELETE FROM mulch_app_stores WHERE owner_id=ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM mulch_users WHERE id=ANY($1::uuid[])', [users]);
    await pool.end();
  }
});
