import { FeeError, moneyMinor } from './policy.js';
export const API_VERSION_DATE = '2026-11-23-3';
const ORIGINS = Object.freeze({ sandbox:'https://sandbox-api.whop.com/api/v1', production:'https://api.whop.com/api/v1' });
const NO_CHARGE_REFUSALS = new Set(['quote_expired','quote_tax_unavailable','quote_preview_only','quote_mismatch','quote_rate_expired','payment_method_currency_unsupported','quote_processor_unsupported']);
export class WhopProvider {
  constructor(env = process.env, fetcher = fetch) { this.env = env; this.fetcher = fetcher; this.mode = env.WHOP_ENVIRONMENT || 'disabled'; }
  guard() {
    if (!ORIGINS[this.mode]) throw new FeeError('provider_disabled', 'Provider requests are disabled. Configure isolated sandbox credentials first.', 503);
    if (!this.env.WHOP_API_KEY || !/^biz_[A-Za-z0-9]+$/.test(this.env.WHOP_PLATFORM_ACCOUNT_ID || '')) {
      throw new FeeError('provider_not_configured', 'Platform credentials and account ID are required.', 503);
    }
    if (this.mode === 'production' && [
      'LIVE_PAYMENT_ACTIVATION_APPROVED','TAX_INCLUSIVE_SANDBOX_VERIFIED','ALL_MERCHANT_PAYMENTS_USE_FEE_SERVICE','BUYER_FEES_DISABLED_VERIFIED'
    ].some(name => this.env[name] !== 'true')) {
      throw new FeeError('production_not_approved', 'Production requires owner activation and verified tax, buyer-fee and controlled-flow gates.', 503);
    }
  }
  async request(method, path, body, idempotencyKey, legacy = false) {
    this.guard();
    if (!/^\/[a-z_]+(?:\/pay_[A-Za-z0-9]+(?:\/fees)?|\/biz_[A-Za-z0-9]+)?$/.test(path)) throw new FeeError('invalid_provider_path', 'Provider path is not allowed.');
    let response;
    try {
      response = await this.fetcher(`${ORIGINS[this.mode]}${path}`, {
        method, redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{ Authorization:`Bearer ${this.env.WHOP_API_KEY}`, 'Content-Type':'application/json',
          'Api-Version-Date':legacy ? '2026-11-23' : API_VERSION_DATE,
          ...(idempotencyKey ? {'Idempotency-Key':idempotencyKey} : {}) },
        ...(body ? { body:JSON.stringify(body) } : {})
      });
    } catch { throw new FeeError('provider_outcome_unknown', 'Provider request outcome is unknown; preserve the payment command.', 502); }
    let payload;
    try { payload = await response.json(); } catch { throw new FeeError('invalid_provider_response', 'Provider response was not valid JSON.', 502); }
    if (!response.ok && response.status === 400 && method === 'POST' && path === '/payments' && NO_CHARGE_REFUSALS.has(payload.error?.code)) {
      const error = new FeeError('provider_precharge_refused','The quoted payment was refused before the payment method was used.',409);
      error.providerCode = payload.error.code;
      throw error;
    }
    if (!response.ok) throw new FeeError('provider_request_failed', `Whop request failed with HTTP ${response.status}; reconcile before another charge.`, 502);
    return payload;
  }
  async createAccount(store) {
    const account = await this.request('POST','/accounts', {
      email:store.login_email, title:store.shop_domain, external_id:`mulch-store:${store.id}`,
      country:store.country.toLowerCase(), metadata:{mulch_store_id:store.id}
    }, `mulch-account-${store.id}`);
    if (!/^biz_[A-Za-z0-9]+$/.test(account.id || '')) throw new FeeError('account_response_invalid', 'Whop did not return an account ID.', 502);
    return account;
  }
  account(id) { return this.request('GET',`/accounts/${id}`); }
  async link(accountId, origin, useCase = 'account_onboarding') {
    const base = new URL(origin);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new FeeError('invalid_return_origin', 'PUBLIC_APP_ORIGIN must be a plain HTTPS origin.', 503);
    }
    const link = await this.request('POST','/account_links', {
      account_id:accountId, use_case:useCase,
      return_url:`${base.origin}/payments/return`, refresh_url:`${base.origin}/payments/refresh`
    }, undefined, true);
    const parsed = new URL(link.url);
    const allowed = this.mode === 'sandbox' ? 'sandbox.whop.com' : 'whop.com';
    if (parsed.protocol !== 'https:' || parsed.hostname !== allowed || parsed.username || parsed.password) throw new FeeError('invalid_onboarding_url', 'Provider returned an unexpected hosted URL.', 502);
    return { url:link.url, expires_at:link.expires_at };
  }
  verified(account, boundId) {
    const profiles = Object.values(account.verification || {}).filter(Boolean);
    return account.id === boundId && account.parent_account?.id === this.env.WHOP_PLATFORM_ACCOUNT_ID
      && account.status === 'active' && account.capabilities?.accept_card_payments === 'active'
      && profiles.length > 0 && profiles.every(profile => profile.status === 'approved');
  }
  quote(body, key) { return this.request('POST','/payment_quotes',body,key); }
  createPayment(body, key) { return this.request('POST','/payments',body,key); }
  payment(id) { return this.request('GET',`/payments/${id}`); }
  async applicationFee(id) {
    const result = await this.request('GET',`/payments/${id}/fees`);
    if (!Array.isArray(result.data)) throw new FeeError('invalid_fee_response', 'Provider fee breakdown is missing.', 502);
    if (result.data.some(line => line.origin === 'application_fee' && !line.collected_at)) return null;
    const lines = result.data.filter(line => line.origin === 'application_fee');
    if (!lines.length) return null;
    if (lines.some(line => !Number.isFinite(new Date(line.collected_at).getTime()))) throw new FeeError('invalid_fee_response','Fee collection timestamp is invalid.',502);
    return lines.reduce((sum,line) => sum + moneyMinor(line.amount), 0n).toString();
  }
}
