import { randomUUID } from 'node:crypto';
import { domain, country, text, uuid, object, integer, fail } from './security.js';
import { KINDS, PREMIUM_KINDS, kind, premium, requiresPremium, validateConfig } from './validation.js';
import { FeeAdapter, POLICY_VERSION, PLANS } from './fees.js';

const ACTIVE = `e.active=true AND e.status='active' AND e.verification_expires_at>clock_timestamp() AND e.paid_until>clock_timestamp()`;
const STORE_SQL = `SELECT s.*, e.id AS entitlement_id, e.plan, e.verification_expires_at, e.paid_until,
  EXISTS(SELECT 1 FROM mulch_app_consents c WHERE c.store_id=s.id AND c.user_id=s.owner_id AND c.policy_version=$2) AS consent
  FROM mulch_app_stores s JOIN mulch_entitlements e ON e.store_id=s.id AND e.user_id=s.owner_id
  WHERE s.owner_id=$1 AND ${ACTIVE}`;
const date = value => value instanceof Date ? value.toISOString() : value;
export function resource(row) {
  return { id: row.id, kind: row.kind, title: row.title, status: row.status, version: row.version,
    config: row.config, createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}

export class Models {
  constructor(pool, env = {}) { this.pool = pool; this.fees = new FeeAdapter(pool, env); }
  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async storeRow(userId, storeId, client = this.pool, lock = false) {
    uuid(storeId);
    const result = await client.query(`${STORE_SQL} AND s.id=$3${lock ? ' FOR UPDATE OF s,e' : ''}`, [userId, POLICY_VERSION, storeId]);
    if (!result.rows[0]) fail('not_found', 'Store not found or its paid entitlement is no longer active.', 404);
    if (new Date(result.rows[0].verification_expires_at).getTime() <= Date.now() || new Date(result.rows[0].paid_until).getTime() <= Date.now()) fail('not_found', 'Store entitlement proof expired. Refresh payment verification.', 404);
    return result.rows[0];
  }
  async publicStore(row) {
    const fees = await this.fees.summary(row.id);
    return {
      id: row.id, name: row.name, shopDomain: row.shop_domain, country: row.country,
      plan: row.plan, planStatus: 'active',
      // Domain/country declarations, operator notes, and old fee-service readiness
      // flags are not provider evidence. OAuth/review runtime remains unconfigured.
      readiness: { shopify: 'unconnected', payments: 'unconnected', storeReview: 'pending', consent: row.consent === true },
      lifetimeGrossMinor: fees.lifetimeGrossMinor, earnedBasisPoints: fees.earnedBasisPoints
    };
  }
  async stores(user) {
    const result = await this.pool.query(`${STORE_SQL} ORDER BY s.created_at,s.id`, [user.id, POLICY_VERSION]);
    return Promise.all(result.rows.map(row => this.publicStore(row)));
  }
  async createStore(user, input) {
    object(input, ['name', 'shopDomain', 'country', 'entitlementId'], ['name', 'shopDomain', 'country', 'entitlementId']);
    const name = text(input.name, 'Store name', 100);
    const shopDomain = domain(input.shopDomain); const code = country(input.country);
    const entitlementId = uuid(input.entitlementId);
    const id = await this.transaction(async client => {
      // Lock by owned ID first, then check wall-clock validity after acquiring the
      // lock. Concurrent requests cannot each spend the same membership.
      const selected = await client.query('SELECT * FROM mulch_entitlements WHERE id=$1 AND user_id=$2 FOR UPDATE', [entitlementId, user.id]);
      const entitlement = selected.rows[0];
      if (!entitlement) fail('not_found', 'Purchased entitlement not found.', 404);
      if (entitlement.store_id) fail('entitlement_already_bound', 'This purchased membership already belongs to one store.', 409);
      if (!entitlement.active || entitlement.status !== 'active' || new Date(entitlement.verification_expires_at).getTime() <= Date.now() || new Date(entitlement.paid_until).getTime() <= Date.now()) fail('subscription_required', 'Refresh a current paid membership before creating a store.', 402);
      const storeId = randomUUID();
      await client.query('INSERT INTO mulch_app_stores(id,owner_id,name,shop_domain,country) VALUES($1,$2,$3,$4,$5)', [storeId, user.id, name, shopDomain, code]);
      const bound = await client.query(`UPDATE mulch_entitlements SET store_id=$1,updated_at=now()
        WHERE id=$2 AND user_id=$3 AND store_id IS NULL AND active=true AND status='active'
        AND paid_until>clock_timestamp() AND verification_expires_at>clock_timestamp() RETURNING id`, [storeId, entitlementId, user.id]);
      if (!bound.rows.length) fail('subscription_required', 'The verification lease expired. Refresh payment verification.', 402);
      await this.audit(client, storeId, user.id, 'store.created');
      return storeId;
    });
    return this.publicStore(await this.storeRow(user.id, id));
  }
  async consent(user, storeId, input) {
    object(input, ['policyVersion', 'accepted'], ['policyVersion', 'accepted']);
    if (input.policyVersion !== POLICY_VERSION || input.accepted !== true) fail('invalid_input', 'Explicit acceptance of the current fee policy is required.');
    await this.transaction(async client => {
      await this.storeRow(user.id, storeId, client, true);
      await client.query('INSERT INTO mulch_app_consents(id,store_id,user_id,policy_version) VALUES($1,$2,$3,$4) ON CONFLICT(store_id,user_id,policy_version) DO NOTHING', [randomUUID(), storeId, user.id, POLICY_VERSION]);
      await this.audit(client, storeId, user.id, 'consent.accepted');
    });
    return this.publicStore(await this.storeRow(user.id, storeId));
  }
  async audit(client, storeId, userId, action, resourceId = null) {
    await client.query('INSERT INTO mulch_app_audit(id,store_id,actor_id,action,resource_id) VALUES($1,$2,$3,$4,$5)', [randomUUID(), storeId, userId, action, resourceId]);
  }
  async resources(row, resourceKind, client = this.pool) {
    kind(resourceKind);
    if (PREMIUM_KINDS.includes(resourceKind)) premium(row.plan);
    const result = await client.query('SELECT * FROM mulch_app_resources WHERE store_id=$1 AND kind=$2 ORDER BY created_at,id', [row.id, resourceKind]);
    const visible = row.plan === 'premium' ? result.rows : result.rows.filter(item => !requiresPremium(item));
    return visible.map(resource);
  }
  async resourcesForBootstrap(row) {
    const result = await this.pool.query('SELECT * FROM mulch_app_resources WHERE store_id=$1 ORDER BY created_at,id', [row.id]);
    const grouped = Object.fromEntries(KINDS.filter(value => row.plan === 'premium' || !PREMIUM_KINDS.includes(value)).map(value => [value, []]));
    for (const item of result.rows) {
      // Never disclose recurring blocks/resources after a Premium downgrade.
      if (row.plan !== 'premium' && requiresPremium(item)) continue;
      grouped[item.kind]?.push(resource(item));
    }
    return grouped;
  }
  async references(client, storeId, resourceKind, config, plan) {
    if (resourceKind !== 'experiment') return;
    const refs = await client.query("SELECT * FROM mulch_app_resources WHERE store_id=$1 AND kind='checkout-design' AND id=ANY($2::uuid[])", [storeId, [config.variantA, config.variantB]]);
    if (refs.rows.length !== 2) fail('not_found', 'Both experiment variants must be owned Mulch checkout designs.', 404);
    if (plan !== 'premium' && refs.rows.some(requiresPremium)) premium(plan);
  }
  async saveResource(user, storeId, resourceKind, input, resourceId = null) {
    kind(resourceKind);
    object(input, resourceId ? ['title', 'config', 'version'] : ['title', 'config'], resourceId ? ['title', 'config', 'version'] : ['title', 'config']);
    const title = text(input.title, 'Title', 100);
    if (resourceId) { uuid(resourceId); integer(input.version, 'Version', 1, 2147483646); }
    return this.transaction(async client => {
      const row = await this.storeRow(user.id, storeId, client, true);
      if (PREMIUM_KINDS.includes(resourceKind)) premium(row.plan);
      if (resourceId) {
        const current = await client.query('SELECT * FROM mulch_app_resources WHERE id=$1 AND store_id=$2 AND kind=$3', [resourceId, storeId, resourceKind]);
        if (!current.rows[0]) fail('not_found', 'Resource not found.', 404);
        if (row.plan !== 'premium' && requiresPremium(current.rows[0])) premium(row.plan);
      }
      const config = validateConfig(resourceKind, input.config, row.plan);
      await this.references(client, storeId, resourceKind, config, row.plan);
      const id = resourceId || randomUUID();
      const saved = resourceId
        ? await client.query(`UPDATE mulch_app_resources SET title=$1,config=$2::jsonb,version=version+1,status='draft',updated_at=now()
            WHERE id=$3 AND store_id=$4 AND kind=$5 AND version=$6 RETURNING *`, [title, JSON.stringify(config), id, storeId, resourceKind, input.version])
        : await client.query('INSERT INTO mulch_app_resources(id,store_id,kind,title,config) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *', [id, storeId, resourceKind, title, JSON.stringify(config)]);
      if (!saved.rows[0]) fail('version_conflict', 'This draft changed. Reload its current version before saving.', 409);
      await this.audit(client, storeId, user.id, resourceId ? 'resource.updated' : 'resource.created', id);
      return resource(saved.rows[0]);
    });
  }
  async deleteResource(user, storeId, resourceKind, resourceId) {
    kind(resourceKind); uuid(resourceId);
    return this.transaction(async client => {
      const row = await this.storeRow(user.id, storeId, client, true);
      if (PREMIUM_KINDS.includes(resourceKind)) premium(row.plan);
      const found = await client.query('SELECT * FROM mulch_app_resources WHERE id=$1 AND store_id=$2 AND kind=$3', [resourceId, storeId, resourceKind]);
      if (!found.rows[0]) fail('not_found', 'Resource not found.', 404);
      if (row.plan !== 'premium' && requiresPremium(found.rows[0])) premium(row.plan);
      if (resourceKind === 'checkout-design') {
        const refs = await client.query("SELECT id FROM mulch_app_resources WHERE store_id=$1 AND kind='experiment' AND (config->>'variantA'=$2 OR config->>'variantB'=$2) LIMIT 1", [storeId, resourceId]);
        if (refs.rows.length) fail('resource_in_use', 'An experiment references this design. Remove or update the experiment first.', 409);
      }
      await client.query('DELETE FROM mulch_app_resources WHERE id=$1 AND store_id=$2 AND kind=$3', [resourceId, storeId, resourceKind]);
      await this.audit(client, storeId, user.id, 'resource.deleted', resourceId);
      return { deleted: true };
    });
  }
  async activate(user, storeId, resourceKind, resourceId) {
    kind(resourceKind); uuid(resourceId);
    const row = await this.storeRow(user.id, storeId);
    if (PREMIUM_KINDS.includes(resourceKind)) premium(row.plan);
    const found = await this.pool.query('SELECT * FROM mulch_app_resources WHERE id=$1 AND store_id=$2 AND kind=$3', [resourceId, storeId, resourceKind]);
    if (!found.rows[0]) fail('not_found', 'Resource not found.', 404);
    if (row.plan !== 'premium' && requiresPremium(found.rows[0])) premium(row.plan);
    fail('operation_not_ready', 'Draft activation requires an implemented and externally verified deployment/provider runtime. This source does not activate checkouts, payments, pixels, subscriptions or experiments.', 409);
  }
  async analytics(row, period = '30d') {
    const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[period];
    if (!days) fail('invalid_input', 'Period must be 7d, 30d, 90d or 365d.');
    const totals = (await this.pool.query(`SELECT COALESCE(SUM(gross_minor),0)::text AS revenue,
      COUNT(*)::int AS orders, COALESCE(ROUND(AVG(gross_minor)),0)::text AS average
      FROM mulch_fee_attempts WHERE store_id=$1 AND counted_at IS NOT NULL AND counted_at>=now()-($2::int*interval '1 day')`, [row.id, days])).rows[0];
    const series = await this.pool.query(`SELECT to_char(counted_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date, SUM(gross_minor)::text AS revenue
      FROM mulch_fee_attempts WHERE store_id=$1 AND counted_at IS NOT NULL AND counted_at>=now()-($2::int*interval '1 day') GROUP BY 1 ORDER BY 1`, [row.id, days]);
    return { revenueMinor: totals.revenue, orders: totals.orders, averageOrderMinor: totals.average,
      sessions: 0, carts: 0, checkouts: 0, paid: totals.orders, storeConversion: null, checkoutConversion: null,
      series: series.rows.map(item => ({ date: item.date, revenueMinor: item.revenue })),
      ...(row.plan === 'premium' ? { mrrMinor: '0', subscribers: 0, churn: null, upcomingRenewals: [] } : {}) };
  }
  async orders(row) {
    const result = await this.pool.query(`SELECT id,order_reference,status,gross_minor,refunded_minor,counted_at
      FROM mulch_fee_attempts WHERE store_id=$1 AND counted_at IS NOT NULL ORDER BY counted_at DESC,id LIMIT 100`, [row.id]);
    return result.rows.map(item => ({ id: item.id, orderReference: item.order_reference, status: item.status, grossMinor: item.gross_minor, refundedMinor: item.refunded_minor, paidAt: date(item.counted_at), source: 'verified-fee-ledger', shopifyFulfillmentVerified: false }));
  }
  billing(row) {
    return { plan: row.plan, planStatus: 'active', plans: PLANS, features: {
      oneTimeCheckoutConfiguration: true, analytics: true, shippingConfiguration: true,
      customerSubscriptions: row.plan === 'premium', customerPortal: row.plan === 'premium',
      paymentRecovery: row.plan === 'premium', recurringAnalytics: row.plan === 'premium',
      liveOperationsVerified: false, aiMcpVerified: false
    } };
  }
}
