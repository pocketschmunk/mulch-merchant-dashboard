import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateConfig, PREMIUM_KINDS } from '../src/validation.js';
import { safeHtml, safeUrl } from '../src/security.js';
import { feeFor, PLANS } from '../src/fees.js';
import { design } from './api-fixtures.mjs';

const PRODUCT = 'gid://shopify/Product/123';
const CONFIGS = {
  'checkout-design': design(), 'thank-you': { heading: 'Thank you', message: 'Order received', showOrderSummary: true },
  offer: { type: 'upsell', productId: PRODUCT, discountPercent: 1.1, description: 'Draft only' },
  discount: { code: 'save10', mode: 'percent', value: 10, minimumMinor: '0', enabled: true },
  'buy-link': { productId: PRODUCT, title: 'Draft product', quantity: 1 },
  survey: { question: 'How did you find us?', answers: ['Search', 'Friend'], required: false },
  experiment: { variantA: randomUUID(), variantB: randomUUID(), splitPercent: 50, metric: 'checkout-conversion' },
  general: { currency: 'usd', timezone: 'America/New_York', supportEmail: 'support@example.test', customDomain: 'checkout.example.test' },
  shipping: { currency: 'usd', zones: [{ country: 'US', rateMinor: '500', freeOverMinor: '10000' }] },
  integration: { provider: 'meta', pixelId: '123456', enabled: true },
  'subscription-rule': { name: 'Monthly', cadence: 'monthly', discountPercent: 10, trialDays: 0, productId: PRODUCT },
  portal: { allowPause: true, allowDeliveryChange: true, allowPaymentUpdate: true, allowCancel: true },
  recovery: { retryDays: [1, 3, 7], emailReminders: true },
  'cancel-flow': { question: 'Why leave?', retentionDiscountPercent: 10, allowPause: true }
};
for (const [kind, config] of Object.entries(CONFIGS)) {
  test(`${kind}: exact documented config accepted and unsupported status/credentials rejected`, () => {
    assert.ok(validateConfig(kind, config, 'premium'));
    assert.throws(() => validateConfig(kind, { ...config, active: true }, 'premium'), error => error.code === 'unknown_field');
    assert.throws(() => validateConfig(kind, { ...config, apiKey: 'secret' }, 'premium'), error => error.code === 'unknown_field');
  });
}
for (const kind of PREMIUM_KINDS) test(`Standard denied ${kind} config`, () => {
  assert.throws(() => validateConfig(kind, CONFIGS[kind], 'standard'), error => error.status === 403 && error.code === 'premium_required');
});
test('nested subscription-choice requires Premium even inside checkout design', () => {
  const config = design([{ id: 'recurring', type: 'subscription-choice', title: 'Subscription', body: 'Draft', visible: true }]);
  assert.throws(() => validateConfig('checkout-design', config, 'standard'), error => error.status === 403);
  assert.ok(validateConfig('checkout-design', config, 'premium'));
});
test('fixed contact/delivery/shipping/payment blocks cannot be hidden, removed or duplicated', () => {
  const hidden = design(); hidden.blocks[0].visible = false;
  const removed = design(); removed.blocks = removed.blocks.slice(1);
  const duplicated = design(); duplicated.blocks.push({ ...duplicated.blocks[0], id: 'second-contact' });
  for (const config of [hidden, removed, duplicated]) assert.throws(() => validateConfig('checkout-design', config, 'premium'));
});
test('only formatting HTML is accepted and normalization is idempotent', () => {
  const html = '<p>Hello <strong>merchant</strong> & buyer</p>';
  const safe = safeHtml(html); assert.equal(safeHtml(safe), safe); assert.match(safe, /&amp;/);
  for (const bad of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<p onclick="x">Hi</p>', '<iframe></iframe>', '<svg></svg>', '<p>&#x3c;script</p><!---->', '<a href="https://shop.app/checkout">Pay</a>']) assert.throws(() => safeHtml(bad));
});
test('image URLs cannot be scripts, native checkout paths or private hosts', () => {
  for (const bad of ['javascript:alert(1)', 'data:image/png,x', 'https://127.0.0.1/a.png', 'https://example.myshopify.com/cart.png', 'https://cdn.example.test/checkout/a.png']) assert.throws(() => safeUrl(bad, 'Image', { image: true }));
});
test('buy link cannot accept destination URL or native product ID shortcut', () => {
  assert.throws(() => validateConfig('buy-link', { ...CONFIGS['buy-link'], url: 'https://shop.app/checkout' }, 'standard'));
  assert.throws(() => validateConfig('buy-link', { ...CONFIGS['buy-link'], productId: 'https://example.myshopify.com/cart/123' }, 'standard'));
});
test('shipping uses exact money and unique countries; unsupported currencies fail', () => {
  for (const config of [{ ...CONFIGS.shipping, currency: 'eur' }, { currency: 'usd', zones: [{ country: 'US', rateMinor: 1.25, freeOverMinor: '0' }] }, { currency: 'usd', zones: [...CONFIGS.shipping.zones, ...CONFIGS.shipping.zones] }]) assert.throws(() => validateConfig('shipping', config, 'standard'));
});
test('experiments cannot route to native checkout or use identical designs', () => {
  assert.throws(() => validateConfig('experiment', { ...CONFIGS.experiment, variantA: 'native-shopify' }, 'standard'));
  assert.throws(() => validateConfig('experiment', { ...CONFIGS.experiment, variantB: CONFIGS.experiment.variantA }, 'standard'));
});
test('recovery schedules and unsupported provider scripts fail validation', () => {
  assert.throws(() => validateConfig('recovery', { retryDays: [3, 1], emailReminders: true }, 'premium'));
  assert.throws(() => validateConfig('integration', { provider: 'meta', pixelId: '<script>x</script>', enabled: true }, 'standard'));
});
test('adapter reuses exact fee policy at whole-payment thresholds and never increases earned rate', () => {
  assert.equal(feeFor({ lifetimeMinor: '4999900', grossMinor: '200', earnedBasisPoints: 280 }).basisPoints, 150);
  assert.equal(feeFor({ lifetimeMinor: '24999900', grossMinor: '200', earnedBasisPoints: 150 }).basisPoints, 50);
  assert.equal(feeFor({ lifetimeMinor: '0', grossMinor: '10800', earnedBasisPoints: 50 }).feeMinor, '54');
  assert.equal(feeFor({ lifetimeMinor: '0', grossMinor: '10800', earnedBasisPoints: 280 }).feeMinor, '302');
  assert.deepEqual(PLANS.map(plan => plan.checkoutUrl), ['https://pay.mulchcheckout.com/?plan=standard', 'https://pay.mulchcheckout.com/?plan=premium']);
});
