import type { ResourceKind } from '../types';
export interface FormField {
  key: string; label: string; type: 'text' | 'email' | 'number' | 'textarea' | 'select' | 'boolean';
  options?: string[]; min?: number; max?: number; maxLength?: number; integer?: boolean; hint?: string;
}
export interface FormSchema { label: string; defaults: Record<string, unknown>; fields: FormField[] }
const field = (key: string, label: string, type: FormField['type'] = 'text', extra: Partial<FormField> = {}): FormField => ({ key, label, type, ...extra });
export const schemas: Record<Exclude<ResourceKind, 'checkout-design'>, FormSchema> = {
  'thank-you': {
    label: 'Thank-you page', defaults: { heading: 'Thank you for your order', message: '', showOrderSummary: true },
    fields: [field('heading', 'Heading', 'text', { maxLength: 160 }), field('message', 'Customer message', 'textarea', { maxLength: 4000 }), field('showOrderSummary', 'Show confirmed order summary', 'boolean')],
  },
  offer: {
    label: 'Offer', defaults: { type: 'order-bump', productId: '', discountPercent: 0, description: '' },
    fields: [field('type', 'Offer placement', 'select', { options: ['order-bump', 'upsell'] }), field('productId', 'Shopify product GID', 'text', { hint: 'Draft gid://shopify/Product/…; publishing needs server-ingested product proof.' }), field('discountPercent', 'Discount percent', 'number', { min: 0, max: 100 }), field('description', 'Offer description', 'textarea', { maxLength: 1000 })],
  },
  discount: {
    label: 'Discount', defaults: { code: '', mode: 'percent', value: 0, minimumMinor: '0', enabled: false },
    fields: [field('code', 'Discount code', 'text', { maxLength: 50 }), field('mode', 'Discount mode', 'select', { options: ['percent', 'fixed'] }), field('value', 'Value', 'number', { min: 0, hint: 'Percent (0–100), or fixed USD dollars with up to two decimal places.' }), field('minimumMinor', 'Minimum order (USD cents)', 'text', { hint: 'Whole non-negative cents, e.g. 5000 for $50.00.' }), field('enabled', 'Configured as enabled (not live activation)', 'boolean')],
  },
  'buy-link': {
    label: 'Buy link', defaults: { productId: '', title: '', quantity: 1 },
    fields: [field('productId', 'Shopify product GID', 'text', { hint: 'Only verified server-ingested products can be published.' }), field('title', 'Customer-facing title', 'text', { maxLength: 160 }), field('quantity', 'Quantity', 'number', { min: 1, max: 1000, integer: true })],
  },
  survey: {
    label: 'Survey', defaults: { question: '', answers: [''], required: false },
    fields: [field('question', 'Survey question', 'text', { maxLength: 300 }), field('required', 'Require an answer', 'boolean')],
  },
  experiment: {
    label: 'Design test', defaults: { variantA: '', variantB: '', splitPercent: 50, metric: 'checkout-conversion' },
    fields: [field('variantA', 'Mulch design A', 'select'), field('variantB', 'Mulch design B', 'select'), field('splitPercent', 'Percent assigned to design A', 'number', { min: 1, max: 99, integer: true }), field('metric', 'Success metric', 'select', { options: ['checkout-conversion', 'average-order-value'] })],
  },
  general: {
    label: 'General settings', defaults: { currency: 'usd', timezone: 'UTC', supportEmail: '', customDomain: '' },
    fields: [field('currency', 'Currency', 'select', { options: ['usd'] }), field('timezone', 'IANA timezone', 'text', { maxLength: 80, hint: 'For example America/New_York or UTC.' }), field('supportEmail', 'Customer support email', 'email', { maxLength: 254 }), field('customDomain', 'Custom checkout domain', 'text', { maxLength: 253, hint: 'Hostname only. Configuration is not verified DNS or SSL.' })],
  },
  shipping: {
    label: 'Shipping', defaults: { currency: 'usd', zones: [] }, fields: [field('currency', 'Currency', 'select', { options: ['usd'] })],
  },
  integration: {
    label: 'Integration', defaults: { provider: 'meta', pixelId: '', enabled: false },
    fields: [field('provider', 'Provider', 'select', { options: ['meta', 'google', 'tiktok', 'klaviyo'] }), field('pixelId', 'Public pixel / tracking identifier', 'text', { maxLength: 100, hint: 'No secrets or API keys. A saved identifier is not verified event delivery.' }), field('enabled', 'Configured as enabled (not live delivery)', 'boolean')],
  },
  'subscription-rule': {
    label: 'Subscription rule', defaults: { name: '', cadence: 'monthly', discountPercent: 0, trialDays: 0, productId: '' },
    fields: [field('name', 'Subscription name', 'text', { maxLength: 100 }), field('productId', 'Shopify product GID'), field('cadence', 'Billing cadence', 'select', { options: ['weekly', 'monthly', 'quarterly'] }), field('discountPercent', 'Subscription discount percent', 'number', { min: 0, max: 100 }), field('trialDays', 'Trial days', 'number', { min: 0, max: 90, integer: true, hint: 'Draft only. Paid conversion, consent and provider support need verification.' })],
  },
  portal: {
    label: 'Customer portal', defaults: { allowPause: true, allowDeliveryChange: true, allowPaymentUpdate: true, allowCancel: true },
    fields: [field('allowPause', 'Allow pausing', 'boolean'), field('allowDeliveryChange', 'Allow delivery changes', 'boolean'), field('allowPaymentUpdate', 'Allow payment-method updates', 'boolean'), field('allowCancel', 'Allow cancellation', 'boolean')],
  },
  recovery: {
    label: 'Payment recovery', defaults: { retryDays: [1, 3, 7], emailReminders: false },
    fields: [field('emailReminders', 'Configure email reminders (does not send email)', 'boolean')],
  },
  'cancel-flow': {
    label: 'Cancellation flow', defaults: { question: '', retentionDiscountPercent: 0, allowPause: true },
    fields: [field('question', 'Cancellation question', 'text', { maxLength: 300 }), field('retentionDiscountPercent', 'Retention discount percent', 'number', { min: 0, max: 100 }), field('allowPause', 'Offer pause option', 'boolean')],
  },
};
export const premiumKinds: ResourceKind[] = ['subscription-rule', 'portal', 'recovery', 'cancel-flow'];
export function freshConfig(kind: Exclude<ResourceKind, 'checkout-design'>) { return structuredClone(schemas[kind].defaults); }
export function validateConfig(kind: Exclude<ResourceKind, 'checkout-design'>, config: Record<string, unknown>): string | null {
  const schema = schemas[kind];
  for (const key of Object.keys(config)) if (!(key in schema.defaults)) return `Unsupported field: ${key}.`;
  for (const key of Object.keys(schema.defaults)) if (!(key in config)) return `Required field: ${key}.`;
  for (const input of schema.fields) {
    const value = config[input.key];
    if (input.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (input.integer && !Number.isSafeInteger(value)) || (input.min !== undefined && value < input.min) || (input.max !== undefined && value > input.max))) return `${input.label} is outside the supported range.`;
    if (input.type === 'number' && !input.integer && Math.abs(Math.round(Number(value) * 100) - Number(value) * 100) > 1e-8) return `${input.label} supports at most two decimal places.`;
    if (input.type === 'boolean' && typeof value !== 'boolean') return `${input.label} must be enabled or disabled.`;
    if (input.options && !input.options.includes(String(value))) return `Choose a supported ${input.label.toLowerCase()}.`;
    if (['text', 'email', 'textarea'].includes(input.type) && (typeof value !== 'string' || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || value.length > (input.maxLength ?? 600))) return `${input.label} must be bounded plain text.`;
  }
  if ('productId' in config && !/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/.test(String(config.productId))) return 'Provide a Shopify Product GID such as gid://shopify/Product/123.';
  if ('minimumMinor' in config && !/^\d+$/.test(String(config.minimumMinor))) return 'Minimum order must be a whole number of USD cents.';
  if (kind === 'discount') {
    if (!/^[A-Z0-9_-]+$/i.test(String(config.code))) return 'Discount codes must use letters, numbers, underscores or hyphens.';
    if (config.mode === 'percent' && Number(config.value) > 100) return 'Percent discount cannot exceed 100.';
    if (config.mode === 'fixed' && Number(config.value) > 1000000) return 'Fixed USD discount exceeds the supported range.';
  }
  if (kind === 'survey' && (!Array.isArray(config.answers) || config.answers.length < 1 || config.answers.length > 20 || config.answers.some(answer => typeof answer !== 'string' || !answer.trim() || answer.length > 200 || /[<>]/.test(answer)))) return 'Provide 1–20 non-empty survey answers, at most 200 characters each.';
  if (kind === 'experiment' && (!config.variantA || !config.variantB || config.variantA === config.variantB)) return 'Select two different owned Mulch checkout designs.';
  if (kind === 'shipping') {
    const zones = config.zones as { country: string; rateMinor: string; freeOverMinor: string }[];
    if (!Array.isArray(zones) || zones.length > 100 || zones.some(zone => !/^[A-Z]{2}$/.test(zone.country) || !/^\d+$/.test(zone.rateMinor) || !/^\d+$/.test(zone.freeOverMinor))) return 'Shipping zones need a two-letter country and whole non-negative cent amounts.';
    if (new Set(zones.map(zone => zone.country)).size !== zones.length) return 'Use one shipping zone per country.';
  }
  if (kind === 'recovery' && (!Array.isArray(config.retryDays) || config.retryDays.length > 8 || config.retryDays.some((day, index, days) => !Number.isInteger(day) || Number(day) < 1 || Number(day) > 60 || (index > 0 && Number(day) <= Number(days[index - 1]))))) return 'Use at most 8 unique increasing whole retry days between 1 and 60.';
  if (kind === 'integration' && config.pixelId && !/^[A-Za-z0-9_-]+$/.test(String(config.pixelId))) return 'Pixel identifiers cannot contain scripts, URLs or credentials.';
  if (kind === 'general') {
    try { new Intl.DateTimeFormat('en', { timeZone: String(config.timezone) }); } catch { return 'Provide a valid IANA timezone.'; }
    if (config.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(config.supportEmail))) return 'Provide a valid support email.';
    if (config.customDomain && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(config.customDomain)) || /(?:^|\.)myshopify\.com$|(?:^|\.)shop\.app$/i.test(String(config.customDomain)))) return 'Use a custom hostname without a URL, path or native checkout domain.';
  }
  return null;
}
