import { useEffect, useState } from 'react';
import type { Access, Bootstrap, PurchasePlan, ResourceKind, Route, Store } from '../types';
import type { Requester } from '../lib/api';
import { describeError, storePath } from '../lib/api';
import { isPremium } from '../lib/routes';
import { Badge, Empty, Loading, Notice, Panel, money } from '../components/UI';
import { ResourceManager } from '../components/ResourceManager';
import { Connections, Overview, Records, SetupCheck } from './Operations';
import { HelpPage, ToolsPage } from './Help';
import { PlanCards, StoreCreator } from './Purchase';
export const configKindsByRoute: Record<string, ResourceKind[]> = {
  'subscriptions/setup': ['subscription-rule'], 'subscriptions/portal': ['portal', 'cancel-flow'],
  'subscriptions/recovery': ['recovery'], 'checkout/design': ['checkout-design'], 'checkout/thank-you': ['thank-you'],
  'checkout/upsells': ['offer', 'discount'], 'checkout/buy-links': ['buy-link'], 'checkout/surveys': ['survey'],
  'checkout/tests': ['experiment'], 'settings/general': ['general'], 'settings/shipping': ['shipping'], 'settings/integrations': ['integration'],
};
export const screenTypes: Record<string, string> = {
  '': 'overview', 'analytics/overview': 'overview', 'analytics/orders': 'orders', 'analytics/abandoned': 'abandoned',
  ...Object.fromEntries(Object.keys(configKindsByRoute).map(path => [path, 'configuration'])),
  'subscriptions/subscribers': 'subscribers', 'settings/shopify': 'connections', 'settings/payments': 'connections',
  'settings/ai-mcp': 'ai-mcp', 'settings/billing': 'billing', 'settings/stores': 'stores', 'settings/setup-check': 'setup-check', tools: 'tools', help: 'help',
};
function Billing({ storeId, api }: { storeId: string; api: Requester }) {
  const [billing, setBilling] = useState<{ plan: string; planStatus: string; plans: PurchasePlan[]; features: Record<string, unknown> } | null>(null); const [error, setError] = useState('');
  useEffect(() => { let active = true; api<typeof billing>(storePath(storeId, 'billing')).then(value => { if (active) setBilling(value); }).catch(err => { if (active) setError(describeError(err)); }); return () => { active = false; }; }, [api, storeId]);
  return <div className="stack"><Panel title="Current paid store membership">{error ? <Notice error>{error}</Notice> : billing ? <><div className="row"><Badge tone="blue">{billing.plan}</Badge><Badge tone={billing.planStatus === 'active' ? 'good' : 'warn'}>{billing.planStatus}</Badge></div><p className="muted">Membership details are verified by the server. Buying a plan here does not change the browser’s entitlement; refresh payment verification afterward.</p><div className="data-row"><span>Provider-verified plans</span><span>{billing.plans.map(plan => `${plan.name}: ${money(plan.amountMinor)} / month per store`).join(' · ')}</span></div></> : <Loading />}</Panel><PlanCards /><Notice>Existing store bindings are preserved by server refresh. A newly purchased unassigned membership does not silently replace a bound store’s plan. Plan changes must be verified for the actual bound membership.</Notice></div>;
}
export function DashboardPage({ route, bootstrap, access, stores, csrf, api, onChanged, onCreated, onStore, refreshAccess }: { route: Route; bootstrap: Bootstrap; access: Access; stores: Store[]; csrf: string; api: Requester; onChanged: () => Promise<void>; onCreated: (store: Store) => Promise<void>; onStore: (id: string) => void; refreshAccess: () => Promise<void> }) {
  const [creating, setCreating] = useState(false); const premium = isPremium(bootstrap.store); const storeId = bootstrap.store.id;
  if (route.premium && !premium) return <section className="upgrade-panel"><Badge tone="blue">PREMIUM FEATURE</Badge><h2>Recurring subscriptions belong on Premium.</h2><p>Standard is an active paid plan with all shared one-time checkout features. Customer subscriptions, subscriber portal, retention, payment recovery and subscription-specific reporting require Premium at $250 monthly per store.</p><p className="muted">This screen is locked; no Premium resource data is requested or editable. The backend independently enforces the same restriction.</p><a className="button primary" href="https://pay.mulchcheckout.com/?plan=premium" target="_blank" rel="noopener noreferrer">View Premium purchase ↗</a><p className="fine-print">Purchasing does not grant access from a return URL. Refresh server verification and confirm the bound membership’s plan.</p></section>;
  const resources = configKindsByRoute[route.path];
  if (resources) return <div className="stack">{route.path === 'subscriptions/recovery' && <Records storeId={storeId} api={api} endpoint="recovery" title="Failed-renewal evidence" description="Recovery history appears only after verified renewals and failed-payment evidence." />}{resources.map(kind => <ResourceManager key={kind} kind={kind} storeId={storeId} csrf={csrf} api={api} premium={premium} designs={bootstrap.resources['checkout-design'] ?? []} onChanged={onChanged} />)}</div>;
  switch (route.path) {
    case '': case 'analytics/overview': return <Overview bootstrap={bootstrap} full={route.path !== ''} />;
    case 'analytics/orders': return <><Notice>Order synchronization and refund operations need verified provider evidence. No one-click refund control is enabled without a real reconciled refund runtime.</Notice><Records storeId={storeId} api={api} endpoint="orders" title="Orders" description="Confirmed payment and order-sync records will appear here when available." /></>;
    case 'analytics/abandoned': return <Records storeId={storeId} api={api} endpoint="abandoned" title="Abandoned checkouts" description="Recorded checkout sessions without confirmed payment appear here." />;
    case 'subscriptions/subscribers': return <Records storeId={storeId} api={api} endpoint="subscribers" title="Subscribers" description="Only real customer subscriptions are listed; Mulch SaaS membership is separate." />;
    case 'settings/shopify': case 'settings/payments': return <Connections bootstrap={bootstrap} csrf={csrf} api={api} type={route.path.endsWith('shopify') ? 'shopify' : 'payments'} onChanged={onChanged} />;
    case 'settings/setup-check': return <SetupCheck storeId={storeId} api={api} />;
    case 'settings/ai-mcp': return <Panel title="AI & MCP readiness"><Empty title="No verified AI or MCP runtime">This observed settings destination does not promise an AI feature, agent connection or API. Capabilities, consent, server authorization and owner activation need a separate implementation definition. No fabricated connection control is shown.</Empty></Panel>;
    case 'settings/billing': return <Billing storeId={storeId} api={api} />;
    case 'settings/stores': return <div className="stack"><Panel title="Your active paid stores" action={<button className="button primary small" onClick={() => setCreating(true)}>Add paid store</button>}>{stores.map(store => <div className="data-row" key={store.id}><div><strong>{store.name}</strong><p className="muted">{store.shopDomain} · {store.country}</p></div><div className="row"><Badge tone="blue">{store.plan}</Badge><button className="button small" onClick={() => onStore(store.id)}>{store.id === storeId ? 'Selected' : 'Select store'}</button></div></div>)}<p className="muted">Only stores with current active bound paid proof are returned. Inactive records remain durable but inaccessible.</p><button className="button small" onClick={refreshAccess}>Refresh purchased memberships</button></Panel>{creating && <StoreCreator access={access} csrf={csrf} api={api} onCreated={onCreated} onCancel={() => setCreating(false)} />}</div>;
    case 'tools': return <ToolsPage />;
    case 'help': return <HelpPage />;
    default: return <Notice error>This destination is not implemented. No placeholder data is supplied.</Notice>;
  }
}
