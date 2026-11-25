import { randomUUID } from 'node:crypto';
import { moneyMinor } from '../../fee-service/src/policy.js';
import { AppError } from './security.js';

export const SELLER_PLANS = Object.freeze([
  Object.freeze({ code: 'standard', name: 'Standard', amountMinor: 15000, variantId: 'plan_GcWXKubnKvKib', checkoutUrl: 'https://pay.mulchcheckout.com/?plan=standard' }),
  Object.freeze({ code: 'premium', name: 'Premium', amountMinor: 25000, variantId: 'plan_HchAp18dt8rm5', checkoutUrl: 'https://pay.mulchcheckout.com/?plan=premium' })
]);
const LEASE_MS = 60_000;
const VALID_ID = { member: /^mber_[A-Za-z0-9]+$/, membership: /^mem_[A-Za-z0-9]+$/, user: /^user_[A-Za-z0-9]+$/, account: /^biz_[A-Za-z0-9]+$/, payment: /^pay_[A-Za-z0-9]+$/, variant: /^plan_[A-Za-z0-9]+$/ };
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;

// Pure verifier: no browser return, list-price, trial or historical account spend
// substitutes for a current captured payment on the exact purchased membership.
export function paidMembershipEvidence({ membership, member, payments, user, accountId, variants, now }) {
  if (!VALID_ID.membership.test(membership?.id || '') || !VALID_ID.member.test(member?.id || '') ||
      !VALID_ID.user.test(member?.user?.id || '') || member.account_id !== accountId ||
      normalizeEmail(member.email) !== normalizeEmail(user.email) || !normalizeEmail(user.email) ||
      membership.account?.id !== accountId || membership.member_id !== member.id ||
      membership.user_id !== member.user.id || membership.status !== 'active') return null;
  const plan = variants.find(item => item.variantId === membership.variant_id);
  const start = timestamp(membership.current_period_start);
  const end = timestamp(membership.current_period_end);
  const fixedEnd = membership.expires_at === null ? end : timestamp(membership.expires_at);
  const paidUntil = Math.min(end, fixedEnd);
  if (!plan || !Number.isFinite(start) || !Number.isFinite(paidUntil) || start > now || paidUntil <= now || paidUntil <= start) return null;
  for (const payment of payments) {
    const paidAt = timestamp(payment?.paid_at);
    if (!VALID_ID.payment.test(payment?.id || '') || payment.account_id !== accountId || payment.member_id !== member.id ||
        payment.membership_id !== membership.id || payment.variant_id !== membership.variant_id ||
        normalizeEmail(payment.customer_email) !== normalizeEmail(user.email) || payment.status !== 'paid' ||
        payment.substatus !== 'succeeded' || payment.auto_refunded !== false ||
        !Number.isFinite(paidAt) || paidAt < start || paidAt >= paidUntil || paidAt > now ||
        !['subscription_create', 'subscription_cycle', 'subscription_update', 'subscription'].includes(payment.billing_reason)) continue;
    try {
      // Fail closed on unsupported money, missing refund evidence or any refund.
      // Upgrades/partial refunds need an explicit future proration policy.
      if (moneyMinor(payment.total) <= 0n || moneyMinor(payment.refunded_amount) !== 0n ||
          moneyMinor(payment.presentment_refunded_amount) !== 0n) continue;
    } catch { continue; }
    return { membershipId: membership.id, memberId: member.id, providerUserId: member.user.id,
      accountId, variantId: membership.variant_id, paymentId: payment.id, plan: plan.code,
      status: membership.status, paidUntil: new Date(paidUntil).toISOString() };
  }
  return null;
}

export function createEntitlements({ pool, env = process.env, transport = fetch, clock = Date.now }) {
  const environment = env.MULCH_BILLING_ENVIRONMENT || 'sandbox';
  const accountId = env.MULCH_BILLING_ACCOUNT_ID || '';
  const token = env.MULCH_BILLING_API_KEY || '';
  const variants = environment === 'sandbox' ? SELLER_PLANS.map(plan => ({ ...plan,
    variantId: env[plan.code === 'standard' ? 'MULCH_SANDBOX_STANDARD_PLAN_ID' : 'MULCH_SANDBOX_PREMIUM_PLAN_ID'] || '' })) : SELLER_PLANS;
  const configured = env.BILLING_VERIFICATION_ENABLED === 'yes' && ['sandbox', 'production'].includes(environment) &&
    VALID_ID.account.test(accountId) && token.length >= 16 && variants.every(plan => VALID_ID.variant.test(plan.variantId)) &&
    variants[0].variantId !== variants[1].variantId;
  const base = environment === 'production' ? 'https://api.whop.com/api/v1' : 'https://sandbox-api.whop.com/api/v1';

  async function list(path, params, deadline, version = '2026-11-23-3') {
    const items = [];
    const seen = new Set();
    let after;
    for (let page = 0; page < 5; page += 1) {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new Error('billing deadline');
      const url = new URL(base + path);
      for (const [name, value] of Object.entries(params)) {
        for (const element of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(element));
      }
      url.searchParams.set('first', '100');
      if (after) url.searchParams.set('after', after);
      const response = await transport(url.href, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Api-Version-Date': version, Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(remaining, 10_000)) });
      if (!response.ok || Number(response.headers?.get('content-length') || 0) > 2_000_000) throw new Error('billing response unavailable');
      // Stream limit prevents a response without Content-Length exhausting memory.
      let bytes = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2_000_000) throw new Error('billing response too large');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data.data) || typeof data.page_info?.has_next_page !== 'boolean') throw new Error('billing contract mismatch');
      items.push(...data.data);
      if (!data.page_info.has_next_page) return items;
      after = data.page_info.end_cursor;
      if (typeof after !== 'string' || !after || after.length > 2048 || seen.has(after)) throw new Error('billing cursor mismatch');
      seen.add(after);
    }
    throw new Error('billing pagination incomplete');
  }

  async function state(client, user, message) {
    const { rows } = await client.query(`SELECT id,plan,status,store_id FROM mulch_entitlements
      WHERE user_id=$1 AND active=true AND verification_expires_at>now() AND paid_until>now() ORDER BY created_at,id`, [user.id]);
    return { hasAccess: configured && rows.length > 0,
      entitlements: configured ? rows.map(row => ({ id: row.id, plan: row.plan, status: row.status, storeId: row.store_id })) : [],
      plans: SELLER_PLANS.map(({ variantId, ...plan }) => plan),
      verification: { configured, message: message || (rows.length ? 'Active paid subscription verified.' : 'No active paid subscription was verified. Purchase with the same email as your Mulch account.') } };
  }

  async function refresh(user, { force = true } = {}) {
    if (!configured) return { hasAccess: false, entitlements: [], plans: SELLER_PLANS.map(({ variantId, ...plan }) => plan),
      verification: { configured: false, message: 'Paid subscription verification is not configured. Dashboard access remains locked.' } };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serializes checks and claims for this merchant across Render instances.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ['mulch-billing:' + user.id]);
      const previous = await client.query('SELECT * FROM mulch_billing_checks WHERE user_id=$1', [user.id]);
      const check = previous.rows[0];
      const fresh = check && new Date(check.expires_at).getTime() > clock();
      // Explicit refresh cannot be used as an unlimited provider enumeration loop.
      const recent = check && clock() - new Date(check.checked_at).getTime() < 10_000;
      if ((fresh && !force) || recent) {
        const result = await state(client, user, check.message);
        await client.query('COMMIT');
        return result;
      }
      const deadline = clock() + 25_000;
      let verified = [];
      let message = 'No active paid subscription was verified. Use the same verified email for Mulch and Whop checkout.';
      try {
        const members = await list('/members', { account_id: accountId, query: user.email }, deadline, '2026-11-19-2');
        const exact = members.filter(member => member.account_id === accountId && normalizeEmail(member.email) === normalizeEmail(user.email));
        if (exact.length > 1) throw new Error('ambiguous billing identity');
        if (exact.length === 1) {
          const member = exact[0];
          const memberships = await list('/memberships', { account_id: accountId, member_id: member.id,
            variant_ids: variants.map(plan => plan.variantId) }, deadline);
          if (memberships.length > 50) throw new Error('billing membership limit');
          for (const membership of memberships) {
            if (membership.status !== 'active' || !variants.some(plan => plan.variantId === membership.variant_id)) continue;
            const payments = await list('/payments', { account_id: accountId, member_id: member.id,
              membership_id: membership.id, variant_id: membership.variant_id }, deadline);
            const evidence = paidMembershipEvidence({ membership, member, payments, user, accountId, variants, now: clock() });
            if (evidence) verified.push(evidence);
          }
        }
        if (verified.length) message = 'Active paid subscription verified. Each purchased membership supports one store.';
      } catch {
        verified = [];
        message = 'Whop payment evidence could not be verified. Access is locked; check your receipt and try again later. No additional charge was made.';
      }
      // A failed/partial/unknown refresh revokes the lease, not the user's data.
      await client.query('UPDATE mulch_entitlements SET active=false,verification_expires_at=now(),updated_at=now() WHERE user_id=$1', [user.id]);
      for (const evidence of verified) {
        const existing = await client.query('SELECT user_id FROM mulch_entitlements WHERE provider_membership_id=$1 FOR UPDATE', [evidence.membershipId]);
        if (existing.rows[0] && existing.rows[0].user_id !== user.id) continue;
        await client.query(`INSERT INTO mulch_entitlements
          (id,user_id,provider_membership_id,provider_member_id,provider_user_id,provider_account_id,provider_variant_id,payment_id,plan,status,active,paid_until,verified_at,verification_expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,now(),now()+interval '60 seconds')
          ON CONFLICT(provider_membership_id) DO UPDATE SET
            provider_member_id=EXCLUDED.provider_member_id,provider_user_id=EXCLUDED.provider_user_id,
            provider_account_id=EXCLUDED.provider_account_id,provider_variant_id=EXCLUDED.provider_variant_id,
            payment_id=EXCLUDED.payment_id,plan=EXCLUDED.plan,status=EXCLUDED.status,active=true,
            paid_until=EXCLUDED.paid_until,verified_at=now(),verification_expires_at=now()+interval '60 seconds',updated_at=now()
          WHERE mulch_entitlements.user_id=EXCLUDED.user_id`,
        [randomUUID(), user.id, evidence.membershipId, evidence.memberId, evidence.providerUserId,
          evidence.accountId, evidence.variantId, evidence.paymentId, evidence.plan, evidence.status, evidence.paidUntil]);
      }
      await client.query(`INSERT INTO mulch_billing_checks(user_id,checked_at,expires_at,message)
        VALUES($1,now(),now()+interval '60 seconds',$2)
        ON CONFLICT(user_id) DO UPDATE SET checked_at=now(),expires_at=now()+interval '60 seconds',message=EXCLUDED.message`, [user.id, message]);
      const result = await state(client, user, message);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // A concurrent cross-user unique claim cannot give the losing user access.
      throw new AppError('billing_verification_unavailable', 'Subscription verification is temporarily unavailable. Dashboard access remains locked.', 503);
    } finally { client.release(); }
  }

  return { configured, access: user => refresh(user, { force: false }), refresh: user => refresh(user, { force: true }) };
}
