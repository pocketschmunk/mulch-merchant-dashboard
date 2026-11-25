import { PREMIUM_KINDS } from './validation.js';

const NOT_READY = 'The external provider/deployment runtime is not implemented or verified; drafts do not enable live operations.';
export function capabilities(plan) {
  const data = {
    configuration: { available: true }, analytics: { available: true },
    'checkout-design': { available: true }, 'thank-you': { available: true }, offer: { available: true },
    discount: { available: true }, 'buy-link': { available: true }, survey: { available: true },
    experiment: { available: true }, general: { available: true }, shipping: { available: true }, integration: { available: true },
    checkoutActivation: { available: false, reason: NOT_READY }, livePayments: { available: false, reason: NOT_READY },
    shopifyConnection: { available: false, reason: 'Verified Shopify OAuth and paid-order synchronization adapters are not configured.' },
    storeReview: { available: false, reason: 'A verified review adapter is not configured.' },
    pixelDelivery: { available: false, reason: NOT_READY }, customerCheckout: { available: false, reason: NOT_READY },
    customerPortalRuntime: { available: false, reason: NOT_READY }, renewalRuntime: { available: false, reason: NOT_READY },
    recoveryRuntime: { available: false, reason: NOT_READY }, experimentRuntime: { available: false, reason: NOT_READY },
    refunds: { available: false, reason: NOT_READY }, customDomainSsl: { available: false, reason: NOT_READY },
    aiMcp: { available: false, reason: 'AI & MCP is an unverified settings destination; no AI capability, credential flow or entitlement has been defined.' }
  };
  for (const key of PREMIUM_KINDS) data[key] = plan === 'premium'
    ? { available: true } : { available: false, reason: 'An active paid Premium plan is required for this subscription configuration module.' };
  data.subscribers = plan === 'premium' ? { available: true } : { available: false, reason: 'An active paid Premium plan is required.' };
  data.subscriptions = plan === 'premium' ? { available: true } : { available: false, reason: 'An active paid Premium plan is required.' };
  return data;
}
export function setupChecks(store, fees) {
  return [
    { id: 'plan', label: 'Paid Mulch plan', status: 'verified', detail: `An active paid ${store.plan === 'premium' ? 'Premium' : 'Standard'} membership is bound to this store; its proof is checked on every request.` },
    { id: 'shopify', label: 'Shopify ownership', status: 'blocked', detail: 'Shop domain saved as a declaration only. Verified Shopify OAuth is not configured.' },
    { id: 'country', label: 'Merchant country', status: 'configured', detail: 'Country is saved; provider identity/country verification has not been implemented.' },
    { id: 'consent', label: 'Tax-inclusive fee consent', status: store.readiness.consent ? 'verified' : 'missing', detail: store.readiness.consent ? 'Current policy acceptance is durably recorded. This does not verify a payment connection.' : 'Accept the current 2.8% → 1.5% → 0.5% fee policy.' },
    { id: 'payments', label: 'Connected merchant payments', status: 'blocked', detail: 'Merchant-owned per-store Whop onboarding remains blocked until verified upstream ownership/country evidence and fee-service configuration exist. No legacy API-key/business-ID shortcut.' },
    { id: 'review', label: 'Store review', status: 'blocked', detail: 'Verified store-review runtime is not configured. Saved/operator flags cannot approve a store.' },
    { id: 'ledger', label: 'Fee reconciliation', status: fees.reviewRequired || fees.unresolvedAttemptId ? 'blocked' : 'configured', detail: fees.reviewRequired || fees.unresolvedAttemptId ? 'An existing fee-ledger command needs reconciliation; do not create a replacement charge.' : 'Fee policy is shared with the tested ledger. No live fee collection is implied.' },
    { id: 'runtime', label: 'Checkout and fulfillment runtime', status: 'blocked', detail: NOT_READY },
    { id: 'ai-mcp', label: 'AI & MCP', status: 'blocked', detail: 'Unverified feature scope; no AI or MCP service is activated.' }
  ];
}
