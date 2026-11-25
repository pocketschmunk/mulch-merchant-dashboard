import type { Route, Store, Session, Access } from '../types';
export const routes: Route[] = [
  { path: '', title: 'Home', group: 'Home', description: 'Your money, when you need it' },
  { path: 'analytics/overview', title: 'Overview', group: 'Analytics', description: 'Collected revenue and checkout performance.' },
  { path: 'analytics/orders', title: 'Orders', group: 'Analytics', description: 'Confirmed payments and Shopify order evidence.' },
  { path: 'analytics/abandoned', title: 'Abandoned checkouts', group: 'Analytics', description: 'Where customers leave before payment.' },
  { path: 'subscriptions/setup', title: 'Setup', group: 'Subscriptions', description: 'Customer subscription rules, separate from your Mulch membership.', premium: true },
  { path: 'subscriptions/portal', title: 'Portal', group: 'Subscriptions', description: 'Customer self-service and cancellation preferences.', premium: true },
  { path: 'subscriptions/recovery', title: 'Payment recovery', group: 'Subscriptions', description: 'Failed-renewal evidence and recovery preferences.', premium: true },
  { path: 'subscriptions/subscribers', title: 'Subscribers', group: 'Subscriptions', description: 'Customer recurring subscriptions and renewal status.', premium: true },
  { path: 'checkout/design', title: 'Design', group: 'Checkout', description: 'A checkout that feels like your store. Save drafts; activate separately.' },
  { path: 'checkout/thank-you', title: 'Thank-you page', group: 'Checkout', description: 'Clear next steps after a confirmed payment.' },
  { path: 'checkout/upsells', title: 'Upsells & discounts', group: 'Checkout', description: 'Offer drafts with transparent pricing and consent.' },
  { path: 'checkout/buy-links', title: 'Buy links', group: 'Checkout', description: 'Draft product-based links. Publishing requires verified routing.' },
  { path: 'checkout/surveys', title: 'Surveys', group: 'Checkout', description: 'Ask useful post-purchase questions.' },
  { path: 'checkout/tests', title: 'Tests', group: 'Checkout', description: 'Compare owned Mulch designs only; drafts do not allocate traffic.' },
  { path: 'settings/general', title: 'General', group: 'Settings', description: 'Checkout preferences, domains and support details.' },
  { path: 'settings/shopify', title: 'Store & Shopify', group: 'Settings', description: 'Verify ownership through the server-bound connection flow.' },
  { path: 'settings/payments', title: 'Payments', group: 'Settings', description: 'Merchant-owned payments. Verification before collection.' },
  { path: 'settings/shipping', title: 'Shipping', group: 'Settings', description: 'Country and rate drafts, before activation.' },
  { path: 'settings/integrations', title: 'Integrations', group: 'Settings', description: 'Saved tracking identifiers are not verified delivery.' },
  { path: 'settings/ai-mcp', title: 'AI & MCP', group: 'Settings', description: 'Capabilities require a separately defined and verified implementation.' },
  { path: 'settings/billing', title: 'Plan & billing', group: 'Settings', description: 'Your store membership and independently earned per-sale fee.' },
  { path: 'settings/stores', title: 'Stores', group: 'Settings', description: 'One paid membership for each owned store.' },
  { path: 'settings/setup-check', title: 'Setup check', group: 'Settings', description: 'Read-only evidence of readiness and outstanding work.' },
  { path: 'tools', title: 'Recommended tools', group: 'Tools', description: 'Official resources, without referrals or implied endorsement.' },
  { path: 'help', title: 'Help & guides', group: 'Help', description: 'Straight answers about setup, fees and checkout operations.' },
];
export const authPaths = ['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'] as const;
export const routeHref = (path: string) => `/dashboard${path ? `/${path}` : ''}`;
export function resolveRoute(path: string): Route | null {
  if (path !== '/dashboard' && !path.startsWith('/dashboard/')) return null;
  const relative = path.slice('/dashboard'.length).replace(/^\//, '').replace(/\/$/, '');
  return routes.find(route => route.path === relative) ?? null;
}
export function isPremium(store: Pick<Store, 'plan' | 'planStatus'> | null): boolean {
  return store?.plan === 'premium' && store.planStatus === 'active';
}
export type Gate = 'login' | 'purchase' | 'dashboard';
// Never infer payment from a query, client plan choice, local storage or URL.
export function paidGate(session: Session | null, access: Access | null): Gate {
  if (!session?.authenticated || !session.user || !session.csrfToken) return 'login';
  if (access?.hasAccess !== true || access.verification?.configured !== true || !Array.isArray(access.entitlements) ||
      !access.entitlements.some(item => item.status === 'active' && (item.plan === 'standard' || item.plan === 'premium'))) return 'purchase';
  return 'dashboard';
}
export function unassignedEntitlements(access: Access | null) {
  return access?.hasAccess === true && access.verification.configured === true
    ? access.entitlements.filter(item => item.status === 'active' && item.storeId === null && (item.plan === 'standard' || item.plan === 'premium')) : [];
}
