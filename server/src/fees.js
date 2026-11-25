import { Repository } from '@mulch/merchant-fees/src/repository.js';
import { FeeService } from '@mulch/merchant-fees/src/service.js';
import { WhopProvider } from '@mulch/merchant-fees/src/whop.js';
import { POLICY_VERSION, TIERS, feeFor } from '@mulch/merchant-fees/src/policy.js';
import { fail } from './security.js';

export { POLICY_VERSION, TIERS, feeFor };
export const PLANS = Object.freeze([
  Object.freeze({ code: 'standard', name: 'Standard', amountMinor: 15000, checkoutUrl: 'https://pay.mulchcheckout.com/?plan=standard' }),
  Object.freeze({ code: 'premium', name: 'Premium', amountMinor: 25000, checkoutUrl: 'https://pay.mulchcheckout.com/?plan=premium' })
]);
const EMPTY = Object.freeze({ lifetimeGrossMinor: '0', earnedBasisPoints: 280, expectedFeeMinor: '0', collectedFeeMinor: '0', refundedMinor: '0', unresolvedAttemptId: null, reviewRequired: false });

export class FeeAdapter {
  constructor(pool, env) {
    this.pool = pool;
    this.repository = new Repository(pool);
    this.provider = new WhopProvider({ ...env, PUBLIC_APP_ORIGIN: env.APP_ORIGIN });
    this.service = new FeeService({ repository: this.repository, provider: this.provider, env: { ...env, PUBLIC_APP_ORIGIN: env.APP_ORIGIN } });
  }
  async summary(storeId) {
    const found = await this.pool.query('SELECT id FROM mulch_fee_stores WHERE id=$1', [storeId]);
    if (!found.rows.length) return { ...EMPTY };
    const data = await this.repository.summary(storeId);
    return {
      lifetimeGrossMinor: data.lifetimeGrossMinor, earnedBasisPoints: data.earnedBasisPoints,
      expectedFeeMinor: data.expected_fee_minor, collectedFeeMinor: data.collected_fee_minor,
      refundedMinor: data.refunded_minor, unresolvedAttemptId: data.unresolvedAttemptId,
      reviewRequired: data.reviewRequired
    };
  }
  async connection(store, action) {
    // The browser cannot register a fee store, paste an account/API key, set fee
    // readiness, or grant access. The existing provider's activation guard is
    // retained; no invented OAuth/review implementation or flag can unlock it.
    try { this.provider.guard(); }
    catch { fail('connection_not_configured', 'Payments onboarding is disabled or lacks the fee service’s required platform/activation configuration.', 503); }
    void store; void action;
    // FeeService.connect/refresh are the verified upstream integration target.
    // They are deliberately not called until Shopify ownership, merchant country
    // and store review can be sourced from real server-side provider evidence.
    fail('connection_not_configured', 'Verified Shopify ownership, merchant-country verification and store review adapters are not implemented. No Whop account or provider link was created.', 503);
  }
}
