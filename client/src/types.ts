export type Plan = 'standard' | 'premium';
export interface User { id: string; email: string; name: string }
export interface PublicConfig {
  brand: string; authMode: 'email'; authConfigured: boolean; checkoutOrigin: string;
  policy: { tiers: { thresholdMinor: string | number; basisPoints: number; rate: string }[]; monthlyPlans: { standard: number; premium: number } };
  sourceOnly: boolean;
}
export interface Session { authenticated: boolean; user?: User; csrfToken?: string; authMode?: 'email' }
export interface PurchasePlan { code: Plan; name: string; amountMinor: number; checkoutUrl: string }
export interface Entitlement { id: string; plan: Plan; status: string; storeId: string | null }
export interface Access { hasAccess: boolean; entitlements: Entitlement[]; plans: PurchasePlan[]; verification: { configured: boolean; message: string } }
export interface Store {
  id: string; name: string; shopDomain: string; country: string; plan: Plan; planStatus: 'active';
  readiness: { shopify: 'unconnected' | 'configured' | 'verified'; payments: 'unconnected' | 'pending' | 'verified'; storeReview: 'pending' | 'approved'; consent: boolean };
  lifetimeGrossMinor: string; earnedBasisPoints: 280 | 150 | 50;
}
export type ResourceKind = 'checkout-design' | 'thank-you' | 'offer' | 'discount' | 'buy-link' | 'survey' | 'experiment' | 'general' | 'shipping' | 'integration' | 'subscription-rule' | 'portal' | 'recovery' | 'cancel-flow';
export interface Resource { id: string; kind: ResourceKind; title: string; status: 'draft' | 'configured' | 'active' | 'paused'; version: number; config: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface Analytics {
  revenueMinor: string; orders: number; averageOrderMinor: string; sessions: number; carts: number; checkouts: number; paid: number;
  storeConversion: number | null; checkoutConversion: number | null; series: { date: string; revenueMinor: string }[];
  mrrMinor?: string; subscribers?: number; churn?: number | null; upcomingRenewals?: Record<string, unknown>[];
}
export interface FeeSummary { lifetimeGrossMinor: string; earnedBasisPoints: number; expectedFeeMinor: string; collectedFeeMinor: string; refundedMinor: string; unresolvedAttemptId: string | null; reviewRequired: boolean }
export interface Capability { available: boolean; reason?: string }
export interface Bootstrap { store: Store; user: User; resources: Record<string, Resource[]>; analytics: Analytics; fees: FeeSummary; capabilities: Record<string, Capability> }
export interface Check { id: string; label: string; status: 'missing' | 'configured' | 'verified' | 'blocked'; detail: string }
export interface Block { id: string; type: string; title: string; body: string; visible: boolean }
export interface Design { accent: string; background: string; logoUrl: string; heading: string; language: string; blocks: Block[] }
export interface Route { path: string; title: string; group: string; description: string; premium?: boolean }
export interface Order {
  id: string; orderReference: string; status: string; grossMinor: string; refundedMinor: string;
  paidAt: string | null; source: 'verified-fee-ledger'; shopifyFulfillmentVerified: boolean;
}
