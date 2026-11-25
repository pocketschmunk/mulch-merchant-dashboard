import { object, text, bool, integer, oneOf, country, safeUrl, safeHtml, fail, uuid } from './security.js';
import { minor } from '@mulch/merchant-fees/src/policy.js';

export const PREMIUM_KINDS = Object.freeze(['subscription-rule', 'portal', 'recovery', 'cancel-flow']);
export const KINDS = Object.freeze(['checkout-design', 'thank-you', 'offer', 'discount', 'buy-link', 'survey', 'experiment', 'general', 'shipping', 'integration', ...PREMIUM_KINDS]);
export const FIXED_BLOCKS = Object.freeze(['contact', 'delivery', 'shipping', 'payment']);
export const BLOCK_TYPES = Object.freeze([...FIXED_BLOCKS, 'express', 'testimonial', 'rating', 'trust', 'guarantee', 'text', 'image', 'timer', 'faq', 'value-props', 'payment-icons', 'announcement', 'custom-html', 'subscription-choice', 'order-bump']);

function fields(value, keys) { return object(value, keys, keys); }
function list(value, label, max = 50, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail('invalid_input', `${label} must contain ${min}–${max} items.`);
  return value;
}
function percent(value, label = 'Discount', max = 100) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || Math.abs(Math.round(value * 100) - value * 100) > 1e-8) fail('invalid_input', `${label} must be a number from 0 to ${max} with at most two decimal places.`);
  return value;
}
function cents(value, label) {
  try { minor(value, label); } catch { fail('invalid_input', `${label} must be an exact nonnegative integer-cent string within the ledger range.`); }
  return value;
}
function color(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('invalid_input', 'Colors must be six-digit hexadecimal values.');
  return value.toLowerCase();
}
function product(value) {
  if (typeof value !== 'string' || !/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,19}$/.test(value)) fail('invalid_input', 'Use a draft Shopify Product GID, not a checkout URL.');
  return value;
}
function email(value) {
  const result = text(value, 'Support email', 254, true).toLowerCase();
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail('invalid_input', 'Support email is invalid.');
  return result;
}
function customDomain(value) {
  const result = text(value, 'Custom domain', 253, true).toLowerCase();
  if (result && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(result) || /(?:^|\.)myshopify\.com$|(?:^|\.)shop\.app$/i.test(result))) fail('invalid_input', 'Use a custom hostname without a URL, path or native checkout domain.');
  return result;
}
export function requiresPremium(item) {
  return PREMIUM_KINDS.includes(item.kind) || (item.kind === 'checkout-design' && item.config?.blocks?.some(block => block.type === 'subscription-choice'));
}
export function premium(plan) {
  if (plan !== 'premium') fail('premium_required', 'An active paid Premium plan is required for customer subscription features.', 403);
}
export function kind(value) { return oneOf(value, KINDS, 'Resource kind'); }

export function validateConfig(resourceKind, input, plan) {
  kind(resourceKind);
  if (PREMIUM_KINDS.includes(resourceKind)) premium(plan);
  let result;
  switch (resourceKind) {
    case 'checkout-design': {
      fields(input, ['accent', 'background', 'logoUrl', 'heading', 'language', 'blocks']);
      const language = text(input.language, 'Language', 35);
      if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) fail('invalid_input', 'Use a valid language code.');
      const ids = new Set(); const fixed = new Set();
      const blocks = list(input.blocks, 'Blocks', 40, 4).map(block => {
        fields(block, ['id', 'type', 'title', 'body', 'visible']);
        const id = text(block.id, 'Block ID', 80);
        if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) fail('invalid_input', 'Block IDs must be unique letters, numbers, underscores or hyphens.');
        ids.add(id);
        const type = oneOf(block.type, BLOCK_TYPES, 'Block type');
        const visible = bool(block.visible, 'Block visibility');
        if (FIXED_BLOCKS.includes(type)) {
          if (!visible || fixed.has(type)) fail('required_block', 'Contact, delivery, shipping and payment blocks must each appear once and remain visible.');
          fixed.add(type);
        }
        if (type === 'subscription-choice') premium(plan);
        const body = type === 'custom-html' ? safeHtml(block.body)
          : type === 'image' ? safeUrl(block.body, 'Block image', { image: true, empty: false })
            : text(block.body, 'Block body', 4000, true);
        return { id, type, title: text(block.title, 'Block title', 120, true), body, visible };
      });
      if (fixed.size !== FIXED_BLOCKS.length) fail('required_block', 'Contact, delivery, shipping and payment blocks cannot be removed.');
      result = { accent: color(input.accent), background: color(input.background), logoUrl: safeUrl(input.logoUrl, 'Logo', { image: true }), heading: text(input.heading, 'Heading', 160), language, blocks };
      break;
    }
    case 'thank-you':
      fields(input, ['heading', 'message', 'showOrderSummary']);
      result = { heading: text(input.heading, 'Heading', 160), message: text(input.message, 'Message', 4000, true), showOrderSummary: bool(input.showOrderSummary, 'Order summary') }; break;
    case 'offer':
      fields(input, ['type', 'productId', 'discountPercent', 'description']);
      result = { type: oneOf(input.type, ['order-bump', 'upsell'], 'Offer type'), productId: product(input.productId), discountPercent: percent(input.discountPercent), description: text(input.description, 'Description', 1000, true) }; break;
    case 'discount': {
      fields(input, ['code', 'mode', 'value', 'minimumMinor', 'enabled']);
      const code = text(input.code, 'Discount code', 50).toUpperCase();
      if (!/^[A-Z0-9_-]+$/.test(code)) fail('invalid_input', 'Discount codes must use letters, numbers, underscores or hyphens.');
      const mode = oneOf(input.mode, ['percent', 'fixed'], 'Discount mode');
      const value = mode === 'percent' ? percent(input.value) : percent(input.value, 'Fixed USD discount', 1000000);
      result = { code, mode, value, minimumMinor: cents(input.minimumMinor, 'Minimum'), enabled: bool(input.enabled, 'Enabled') }; break;
    }
    case 'buy-link':
      fields(input, ['productId', 'title', 'quantity']);
      result = { productId: product(input.productId), title: text(input.title, 'Link title', 160), quantity: integer(input.quantity, 'Quantity', 1, 1000) }; break;
    case 'survey':
      fields(input, ['question', 'answers', 'required']);
      result = { question: text(input.question, 'Question', 300), answers: list(input.answers, 'Answers', 20, 1).map(answer => text(answer, 'Answer', 200)), required: bool(input.required, 'Required') }; break;
    case 'experiment':
      fields(input, ['variantA', 'variantB', 'splitPercent', 'metric']);
      if (input.variantA === input.variantB) fail('invalid_input', 'Select two distinct owned Mulch checkout designs.');
      result = { variantA: uuid(input.variantA), variantB: uuid(input.variantB), splitPercent: integer(input.splitPercent, 'Split', 1, 99), metric: oneOf(input.metric, ['checkout-conversion', 'average-order-value'], 'Metric') }; break;
    case 'general': {
      fields(input, ['currency', 'timezone', 'supportEmail', 'customDomain']);
      const timezone = text(input.timezone, 'Timezone', 80);
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { fail('invalid_input', 'Timezone must be a supported IANA timezone.'); }
      result = { currency: oneOf(input.currency, ['usd'], 'Currency'), timezone, supportEmail: email(input.supportEmail), customDomain: customDomain(input.customDomain) }; break;
    }
    case 'shipping': {
      fields(input, ['currency', 'zones']);
      const seen = new Set();
      result = { currency: oneOf(input.currency, ['usd'], 'Currency'), zones: list(input.zones, 'Zones', 100).map(zone => {
        fields(zone, ['country', 'rateMinor', 'freeOverMinor']);
        const code = country(zone.country);
        if (seen.has(code)) fail('invalid_input', 'Each shipping country can appear once.');
        seen.add(code);
        return { country: code, rateMinor: cents(zone.rateMinor, 'Shipping rate'), freeOverMinor: cents(zone.freeOverMinor, 'Free-shipping threshold') };
      }) }; break;
    }
    case 'integration': {
      fields(input, ['provider', 'pixelId', 'enabled']);
      const pixelId = text(input.pixelId, 'Pixel ID', 100, true);
      if (pixelId && !/^[A-Za-z0-9_-]+$/.test(pixelId)) fail('invalid_input', 'Pixel IDs cannot contain scripts, URLs or credentials.');
      result = { provider: oneOf(input.provider, ['meta', 'google', 'tiktok', 'klaviyo'], 'Provider'), pixelId, enabled: bool(input.enabled, 'Enabled') }; break;
    }
    case 'subscription-rule':
      fields(input, ['name', 'cadence', 'discountPercent', 'trialDays', 'productId']);
      result = { name: text(input.name, 'Subscription name', 100), cadence: oneOf(input.cadence, ['weekly', 'monthly', 'quarterly'], 'Cadence'), discountPercent: percent(input.discountPercent), trialDays: integer(input.trialDays, 'Trial days', 0, 90), productId: product(input.productId) }; break;
    case 'portal':
      fields(input, ['allowPause', 'allowDeliveryChange', 'allowPaymentUpdate', 'allowCancel']);
      result = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, bool(value, key)])); break;
    case 'recovery':
      fields(input, ['retryDays', 'emailReminders']);
      result = { retryDays: list(input.retryDays, 'Retry days', 8).map(day => integer(day, 'Retry day', 1, 60)), emailReminders: bool(input.emailReminders, 'Email reminders') };
      if (new Set(result.retryDays).size !== result.retryDays.length || result.retryDays.some((day, index, days) => index && day <= days[index - 1])) fail('invalid_input', 'Retry days must be unique and increasing.');
      break;
    case 'cancel-flow':
      fields(input, ['question', 'retentionDiscountPercent', 'allowPause']);
      result = { question: text(input.question, 'Question', 300), retentionDiscountPercent: percent(input.retentionDiscountPercent), allowPause: bool(input.allowPause, 'Allow pause') }; break;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 60000) fail('body_too_large', 'Configuration exceeds its storage bound.', 413);
  return result;
}
