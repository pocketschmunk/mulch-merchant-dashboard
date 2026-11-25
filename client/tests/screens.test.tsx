import * as React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { routes, authPaths } from '../src/lib/routes';
import { DashboardPage, screenTypes } from '../src/pages/Dashboard';
import { CheckoutPreview } from '../src/components/CheckoutBuilder';
import { StoreCreator, PurchasePage } from '../src/pages/Purchase';
import { ResourceFields } from '../src/components/ResourceFields';
import { AuthPage } from '../src/pages/Auth';
import { schemas, freshConfig } from '../src/lib/resourceSchemas';
import { initialDesign } from '../src/lib/builder';
import { Shell } from '../src/components/Shell';
import type { Access, Bootstrap, Session } from '../src/types';
import type { Requester } from '../src/lib/api';
// Synthetic accounts exist exclusively in tests; no app import or public fixture route.
const session: Session = { authenticated: true, user: { id: 'test-owner', name: 'Internal fixture', email: 'fixture@example.test' }, csrfToken: 'fixture-csrf' };
const bootstrap: Bootstrap = { user: session.user!, store: { id: 'fixture-store', name: 'Internal fixture store', shopDomain: 'fixture.myshopify.com', country: 'US', plan: 'premium', planStatus: 'active', readiness: { shopify: 'unconnected', payments: 'unconnected', storeReview: 'pending', consent: false }, lifetimeGrossMinor: '0', earnedBasisPoints: 280 }, resources: {}, analytics: { revenueMinor: '0', orders: 0, averageOrderMinor: '0', sessions: 0, carts: 0, checkouts: 0, paid: 0, storeConversion: null, checkoutConversion: null, series: [], mrrMinor: '0', subscribers: 0, churn: null, upcomingRenewals: [] }, fees: { lifetimeGrossMinor: '0', earnedBasisPoints: 280, expectedFeeMinor: '0', collectedFeeMinor: '0', refundedMinor: '0', unresolvedAttemptId: null, reviewRequired: false }, capabilities: {} };
const access: Access = { hasAccess: true, entitlements: [{ id: 'unassigned', status: 'active', plan: 'premium', storeId: null }], plans: [], verification: { configured: true, message: 'Test-only proof' } };
const api: Requester = async () => { throw new Error('SSR test must never call provider or API'); };
const noop = async () => {};
for (const route of routes) test(`paid route is wired and renders: ${route.path || 'Home'}`, () => {
  assert.ok(screenTypes[route.path]);
  const html = renderToStaticMarkup(<DashboardPage route={route} bootstrap={bootstrap} access={access} stores={[bootstrap.store]} csrf="test" api={api} onChanged={noop} onCreated={noop} onStore={() => {}} refreshAccess={noop} />);
  assert.ok(html.length > 50); assert.doesNotMatch(html, /This destination is not implemented/);
});
for (const route of routes.filter(item => item.premium)) test(`Standard sees explicit upgrade gate, not editor: ${route.path}`, () => {
  const standard = { ...bootstrap, store: { ...bootstrap.store, plan: 'standard' as const } };
  const html = renderToStaticMarkup(<DashboardPage route={route} bootstrap={standard} access={access} stores={[standard.store]} csrf="test" api={api} onChanged={noop} onCreated={noop} onStore={() => {}} refreshAccess={noop} />);
  assert.match(html, /PREMIUM FEATURE/); assert.match(html, /no Premium resource data is requested/); assert.doesNotMatch(html, /Save draft|resource-form/);
});
for (const kind of Object.keys(schemas) as (keyof typeof schemas)[]) test(`exact field form renders without raw JSON editor: ${kind}`, () => {
  const html = renderToStaticMarkup(<ResourceFields kind={kind} config={freshConfig(kind)} onChange={() => {}} designs={[]} />);
  assert.ok(html.length > 20); assert.doesNotMatch(html, /JSON|apiKey|accessToken/);
});
test('sample preview has disabled charge presentation and no scripts', () => {
  for (const device of ['desktop', 'mobile'] as const) {
    const html = renderToStaticMarkup(<CheckoutPreview design={initialDesign()} device={device} />);
    assert.match(html, /SAMPLE PREVIEW/); assert.match(html, /payment disabled/); assert.match(html, /Sample product/); assert.doesNotMatch(html, /<script|<form|<button/);
  }
});
test('purchase gate has exact paid URLs and never exposes dashboard navigation', () => {
  const html = renderToStaticMarkup(<PurchasePage session={session} access={null} error="Provider missing" busy={false} refresh={noop} logout={noop} />);
  assert.match(html, /https:\/\/pay\.mulchcheckout\.com\/\?plan=standard/); assert.match(html, /https:\/\/pay\.mulchcheckout\.com\/\?plan=premium/);
  assert.match(html, /\$150/); assert.match(html, /\$250/); assert.match(html, /Provider verification unavailable/); assert.doesNotMatch(html, /nav-rail|href="\/dashboard/);
});
test('store creator exposes active unassigned entitlement ID, no client plan override', () => {
  const html = renderToStaticMarkup(<StoreCreator access={access} csrf="test" api={api} onCreated={noop} />);
  assert.match(html, /value="unassigned"/); assert.match(html, /server chooses the plan/); assert.doesNotMatch(html, /name="plan"|value="standard"|value="premium"/);
  assert.match(html, /maxLength="100"/i); assert.match(html, /Declared country/);
  assert.match(html, /business country remains unverified until provider review/);
  assert.doesNotMatch(html, /Verification country|server verified|maxLength="120"/i);
  const none = renderToStaticMarkup(<StoreCreator access={{ ...access, entitlements: [] }} csrf="test" api={api} onCreated={noop} />); assert.match(none, /No active unassigned membership/); assert.doesNotMatch(none, /<form/);
});
test('navigation contains every functional destination and readiness badges', () => {
  const html = renderToStaticMarkup(<Shell route={routes[0]} store={bootstrap.store} stores={[bootstrap.store]} session={session} onStore={() => {}} logout={noop} refreshAccess={noop} dark={false} toggleTheme={() => {}}>Test-only content</Shell>);
  for (const route of routes) assert.ok(html.includes(route.title.replaceAll('&', '&amp;')), route.title);
  assert.match(html, /Payments not verified/); assert.match(html, /2.8% earned fee/); assert.match(html, /Your money, when you need it/);
});
test('all five auth screens render without automatic token consumption', () => {
  const original = globalThis.window;
  Object.assign(globalThis, { window: { location: { search: '?token=internal-test-only' } } });
  try { for (const path of authPaths) { const html = renderToStaticMarkup(<AuthPage path={path} api={api} configured={true} onLogin={noop} />); assert.match(html, /Your money/); assert.ok(html.includes('<form')); if (path === '/verify-email' || path === '/reset-password') assert.match(html, /internal-test-only/); } }
  finally { Object.assign(globalThis, { window: original }); }
});

test('supported order shape displays captured gross, refunds, paid date and ledger-only fulfillment evidence', async () => {
  const { OrderTable } = await import('../src/pages/Operations');
  const html = renderToStaticMarkup(<OrderTable items={[{ id: 'internal-test-order', orderReference: 'ORDER-123', status: 'succeeded',
    grossMinor: '10800', refundedMinor: '2000', paidAt: '2026-11-24T03:00:00.000Z', source: 'verified-fee-ledger', shopifyFulfillmentVerified: false }]} />);
  assert.match(html, /ORDER-123/); assert.match(html, /\$108\.00/); assert.match(html, /\$20\.00/);
  assert.match(html, /2026-11-24T03:00:00.000Z/); assert.match(html, /Verified fee ledger/); assert.match(html, /Shopify sync unverified/);
  assert.doesNotMatch(html, /Not reported|Shopify fulfillment verified/);
});
