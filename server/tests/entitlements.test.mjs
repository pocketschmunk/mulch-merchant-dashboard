import test from 'node:test';
import assert from 'node:assert/strict';
import { paidMembershipEvidence, SELLER_PLANS, createEntitlements } from '../src/entitlements.js';

const now = Date.parse('2026-11-25T03:10:00Z');
const money = amount => ({ amount, currency: 'usd', decimals: 2, display_decimals: 2 });
function fixture() {
  return { now, user: { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test' }, accountId: 'biz_Mulch', variants: SELLER_PLANS,
    member: { id: 'mber_One', account_id: 'biz_Mulch', user: { id: 'user_One' }, email: 'owner@example.test' },
    membership: { id: 'mem_One', account: { id: 'biz_Mulch' }, member_id: 'mber_One', user_id: 'user_One', variant_id: SELLER_PLANS[0].variantId,
      status: 'active', current_period_start: '2026-11-24T00:00:00Z', current_period_end: '2026-12-24T00:00:00Z', expires_at: null, cancel_at_period_end: false },
    payments: [{ id: 'pay_One', account_id: 'biz_Mulch', member_id: 'mber_One', membership_id: 'mem_One', variant_id: SELLER_PLANS[0].variantId,
      customer_email: 'owner@example.test', status: 'paid', substatus: 'succeeded', paid_at: '2026-11-24T00:01:00Z', auto_refunded: false,
      total: money('150.00'), refunded_amount: money('0.00'), presentment_refunded_amount: money('0.00'), billing_reason: 'subscription_create' }] };
}
test('active paid membership yields exact Standard evidence', () => {
  assert.equal(paidMembershipEvidence(fixture()).plan, 'standard');
});
test('Premium requires its exact purchased variant', () => {
  const value = fixture(); value.membership.variant_id = value.payments[0].variant_id = SELLER_PLANS[1].variantId;
  assert.equal(paidMembershipEvidence(value).plan, 'premium');
});
test('cancellation scheduled at paid-period end keeps access until the paid end', () => {
  const value = fixture(); value.membership.cancel_at_period_end = true;
  assert.ok(paidMembershipEvidence(value));
  value.now = Date.parse(value.membership.current_period_end);
  assert.equal(paidMembershipEvidence(value), null);
});
for (const status of ['trialing', 'past_due', 'completed', 'expired', 'canceled', 'unresolved']) {
  test(`membership ${status} never grants paid dashboard access`, () => {
    const value = fixture(); value.membership.status = status; assert.equal(paidMembershipEvidence(value), null);
  });
}
for (const [field, wrong] of [['account_id', 'biz_Other'], ['member_id', 'mber_Other'], ['membership_id', 'mem_Other'],
  ['variant_id', 'plan_Other'], ['customer_email', 'someone@example.test'], ['status', 'authorized'], ['substatus', 'refunded'],
  ['auto_refunded', true], ['billing_reason', 'manual'], ['paid_at', '2026-10-24T00:01:00Z']]) {
  test(`payment ${field} mismatch does not unlock dashboard`, () => {
    const value = fixture(); value.payments[0][field] = wrong; assert.equal(paidMembershipEvidence(value), null);
  });
}
test('member fuzzy email, buyer identity or seller mismatch is not proof', () => {
  for (const mutate of [v => {v.member.email='other@example.test';}, v => {v.member.user.id='user_Other';}, v => {v.membership.account.id='biz_Other';}]) {
    const value = fixture(); mutate(value); assert.equal(paidMembershipEvidence(value), null);
  }
});
test('free/partial/full/unknown refund or float money fail closed', () => {
  for (const mutate of [v=>{v.payments[0].total=money('0.00');}, v=>{v.payments[0].refunded_amount=money('1.00');},
    v=>{v.payments[0].presentment_refunded_amount=money('150.00');}, v=>{delete v.payments[0].refunded_amount;},
    v=>{v.payments[0].total.amount=150;}, v=>{v.payments[0].total.currency='eur';}]) {
    const value=fixture(); mutate(value); assert.equal(paidMembershipEvidence(value),null);
  }
});
test('unconfigured billing denies access without reading any database or provider', async () => {
  const billing=createEntitlements({pool:{query(){throw new Error('must not query');}},env:{},transport(){throw new Error('must not fetch');}});
  const result=await billing.access(fixture().user);
  assert.equal(result.hasAccess,false); assert.equal(result.verification.configured,false); assert.deepEqual(result.entitlements,[]);
  assert.deepEqual(result.plans.map(plan=>plan.amountMinor),[15000,25000]);
});
