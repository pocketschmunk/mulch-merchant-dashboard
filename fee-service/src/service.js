import { createHash } from 'node:crypto';
import { feeFor, FeeError, major, moneyMinor, POLICY_VERSION } from './policy.js';
import { publicAttempt } from './repository.js';
const canonical = input => input && typeof input === 'object'
  ? (Array.isArray(input) ? input.map(canonical) : Object.fromEntries(Object.keys(input).sort().map(key => [key,canonical(input[key])]))) : input;
const hash = input => createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
export class FeeService {
  constructor({repository,provider,vault,env = process.env}) { this.repository = repository; this.provider = provider; this.vault = vault; this.env = env; }
  async connect(storeId, useCase = 'account_onboarding') {
    let store = await this.repository.getStore(storeId);
    if (!store.shopify_verified) throw new FeeError('connect_shopify_first', 'Verify Shopify ownership before connecting payments.', 409);
    if (!store.account_id) {
      const account = await this.provider.createAccount(store);
      store = await this.repository.bindAccount(storeId, account.id);
    }
    const link = await this.provider.link(store.account_id,this.env.PUBLIC_APP_ORIGIN,useCase);
    return { storeId, state:'verification_not_finished', ...link };
  }
  async refresh(storeId) {
    const store = await this.repository.getStore(storeId);
    if (!store.account_id) throw new FeeError('account_not_connected', 'Connect payments first.', 409);
    const account = await this.provider.account(store.account_id);
    const verified = this.provider.verified(account,store.account_id);
    await this.repository.setProviderVerified(storeId,verified);
    return {storeId,state:verified ? 'payments_connected' : 'verification_not_finished',
      readyForPayments:verified && !store.fee_review_required && store.access_verified && store.shopify_verified && store.store_review_approved && store.consent_policy_version === POLICY_VERSION && Boolean(store.consent_reference && store.product_id)};
  }
  async charge(storeId, key, input) {
    if (!input.confirmation_token) throw new FeeError('unsupported_saved_method','This release issues one-time confirmation-token purchases only. Controlled saved-method renewals need a separately verified integration.',409);
    const start = await this.repository.start(storeId,key,hash(input),input.order_reference);
    let attempt = start.attempt;
    if (!start.created) {
      if (attempt.payment_id) return this.reconcile(attempt.id);
      if (['prepared','unknown','submitting'].includes(attempt.status)) return this.submit(attempt.id);
      if (attempt.status !== 'quoting') return publicAttempt(attempt);
    }
    const store = start.store;
    try {
      const origin = new URL(this.env.PUBLIC_APP_ORIGIN);
      if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new FeeError('invalid_return_origin','PUBLIC_APP_ORIGIN must be a plain HTTPS origin.',503);
      const base = {
        account_id:store.account_id,
        variant:{product_id:store.product_id,currency:'usd',billing_type:'one_time',
          initial_price:major(input.subtotal_minor),title:`Mulch order ${input.order_reference}`},
        ...(input.billing_address ? {address:input.billing_address} : {}),
        ...(input.shipping_address ? {shipping_address:input.shipping_address} : {}),
        presentment_currency:'usd'
      };
      const first = await this.provider.quote(base,`${attempt.id}-quote-base`);
      this.verifyQuote(first,store.account_id);
      const grossMinor = moneyMinor(first.total).toString();
      const calculation = feeFor({lifetimeMinor:store.lifetime_minor,grossMinor,earnedBasisPoints:store.earned_basis_points});
      if (BigInt(calculation.feeMinor) >= BigInt(input.subtotal_minor)) throw new FeeError('fee_exceeds_variant_price', 'Fee must be less than the variant initial price.');
      const final = await this.provider.quote({ ...base,
        variant:{...base.variant,application_fee_amount:major(calculation.feeMinor)}
      }, `${attempt.id}-quote-fee`);
      this.verifyQuote(final,store.account_id);
      if (moneyMinor(final.total).toString() !== grossMinor || moneyMinor(final.tax_amount) !== moneyMinor(first.tax_amount)) {
        throw new FeeError('quote_changed', 'Tax or customer total changed after adding the software fee. No charge was submitted.', 409);
      }
      const payment = {
        account_id:store.account_id,quote_id:final.id,capture:true,confirmation_token:input.confirmation_token,
        ...(input.shipping_address ? {shipping_address:input.shipping_address} : {}),
        return_url:`${origin.origin}/checkout/return`,
        metadata:{mulch_attempt_id:attempt.id,mulch_store_id:storeId,mulch_order_reference:input.order_reference,
          mulch_fee_policy:POLICY_VERSION,mulch_fee_basis_points:String(calculation.basisPoints),
          mulch_expected_gross_minor:calculation.grossMinor,mulch_expected_fee_minor:calculation.feeMinor}
      };
      await this.repository.prepare(attempt.id,final.id,moneyMinor(final.tax_amount).toString(),calculation,this.vault.seal(payment,attempt.id),final.expires_at);
    } catch (error) {
      await this.repository.fail(attempt.id,error.code || 'quote_preparation_failed');
      throw error;
    }
    return this.submit(attempt.id);
  }
  verifyQuote(quote, accountId) {
    if (!/^pq_[A-Za-z0-9]+$/.test(quote.id || '') || quote.account_id !== accountId || quote.currency !== 'usd') {
      throw new FeeError('invalid_quote', 'Quote must belong to the bound connected account in USD.', 502);
    }
    const expires = new Date(quote.expires_at).getTime();
    if (!quote.expires_at || !Number.isFinite(expires) || expires <= Date.now()) throw new FeeError('quote_expired', 'Provider quote has expired or has an invalid expiry.', 409);
    if (!['calculated','not_applicable'].includes(quote.tax_status) || ['ip_address','presentment_country'].includes(quote.located_by)) throw new FeeError('quote_not_payable','Tax must be authoritative and the quote must not be preview-only.',409);
    moneyMinor(quote.total); moneyMinor(quote.tax_amount);
  }
  async submit(attemptId) {
    const claimed = await this.repository.claim(attemptId);
    if (!claimed) return publicAttempt(await this.repository.getAttempt(attemptId));
    try {
      const payment = await this.provider.createPayment(this.vault.open(claimed.payload_ciphertext,attemptId),`mulch-payment-${attemptId}`);
      if (!/^pay_[A-Za-z0-9]+$/.test(payment.id || '')) throw new FeeError('invalid_payment_response', 'Provider did not return a payment ID.', 502);
      await this.repository.submitted(attemptId,payment.id);
    } catch (error) {
      if (error.code === 'provider_precharge_refused' && !claimed.replayed) await this.repository.fail(attemptId,error.providerCode,true);
      else await this.repository.unknown(attemptId);
      throw error;
    }
    return this.reconcile(attemptId);
  }
  async reconcile(attemptId) {
    const attempt = await this.repository.getAttempt(attemptId);
    if (!attempt.payment_id) return publicAttempt(await this.repository.expirePayload(attemptId));
    const store = await this.repository.getStore(attempt.store_id);
    const payment = await this.provider.payment(attempt.payment_id);
    const identityMatches = payment.id === attempt.payment_id && payment.account_id === store.account_id
      && payment.quote_id === attempt.quote_id && payment.metadata?.mulch_attempt_id === attempt.id
      && payment.metadata?.mulch_store_id === attempt.store_id;
    if (!identityMatches) return this.incident(attempt,'provider_identity_mismatch');
    if (['void','uncollectible'].includes(payment.status) && !payment.paid_at) {
      return publicAttempt(await this.repository.fail(attemptId,`provider_${payment.status}`,true));
    }
    if (payment.status !== 'paid' || !payment.paid_at) return publicAttempt(attempt);
    const taxMinor = payment.tax_amount === null ? '0' : moneyMinor(payment.tax_amount).toString();
    if (moneyMinor(payment.amount_charged).toString() !== attempt.gross_minor
      || taxMinor !== attempt.tax_minor) return this.incident(attempt,'captured_gross_or_tax_mismatch');
    const refunded = payment.presentment_refunded_amount ? moneyMinor(payment.presentment_refunded_amount).toString() : '0';
    await this.repository.capture(attemptId,refunded);
    const actualFee = await this.provider.applicationFee(payment.id);
    if (actualFee === null) return publicAttempt(await this.repository.getAttempt(attemptId));
    await this.repository.recordActualFee(attemptId,actualFee);
    if (actualFee !== attempt.fee_minor) return this.incident(attempt,'application_fee_collection_mismatch');
    return publicAttempt(await this.repository.settle(attemptId,actualFee,refunded));
  }
  async incident(attempt, code) {
    return publicAttempt(await this.repository.review(attempt.id,code));
  }
  async webhook(event) {
    if (!['payment.succeeded','payment.failed'].includes(event.type)) return {ignored:true};
    if (!event.id || !/^biz_[A-Za-z0-9]+$/.test(event.account_id || '') || !/^pay_[A-Za-z0-9]+$/.test(event.data?.id || '')) {
      throw new FeeError('invalid_event', 'A pinned payment event requires account and payment IDs.');
    }
    const saved = await this.repository.eventBegin(event);
    if (saved.processed_at) return {duplicate:true};
    let attempt = await this.repository.findPayment(event.account_id,event.data.id);
    if (!attempt && /^[a-f0-9-]{36}$/.test(event.data.metadata?.mulch_attempt_id || '')) {
      attempt = await this.repository.getAttempt(event.data.metadata.mulch_attempt_id);
      const store = await this.repository.getStore(attempt.store_id);
      if (store.account_id !== event.account_id || event.data.metadata.mulch_store_id !== store.id) throw new FeeError('event_account_mismatch', 'Event does not belong to the bound store.', 409);
      if (attempt.payment_id && attempt.payment_id !== event.data.id) throw new FeeError('event_payment_mismatch', 'Event conflicts with a known payment.', 409);
      if (!attempt.payment_id) attempt = await this.repository.submitted(attempt.id,event.data.id);
    }
    if (!attempt) { await this.repository.eventDone(event.id); return {ignored:true,reason:'not_a_mulch_command'}; }
    const result = await this.reconcile(attempt.id);
    // Leave pending events retryable; a signed success event is not itself proof of a matched fee.
    if (['succeeded','failed','review'].includes(result.status)) await this.repository.eventDone(event.id);
    else throw new FeeError('reconciliation_pending', 'Provider fee/terminal state is not ready; retry reconciliation.', 503);
    return result;
  }
}
