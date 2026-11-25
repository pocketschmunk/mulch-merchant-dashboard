import { decimalMinor, FeeError } from '../src/policy.js';
export const money = cents => ({currency:'usd',decimals:2,display_decimals:2,amount:`${BigInt(cents)/100n}.${String(BigInt(cents)%100n).padStart(2,'0')}`});
export class FakeProvider {
  constructor() { this.quotes=new Map(); this.payments=new Map(); this.commands=new Map(); this.quoteCalls=[]; this.paymentCalls=[]; this.accountCalls=[]; this.chargeCount=0; this.extraBuyerFee=0n; this.feeDifference=0n; this.failOnce=false; this.pending=false; this.changedQuote=false; this.noTax=false; this.feePending=false; this.prechargeRefused=false; this.taxUnavailable=false; }
  async createAccount(store) { this.accountCalls.push(store.id); return {id:`biz_${store.id.replace(/[^A-Za-z0-9]/g,'')}`}; }
  async link(id,origin,useCase) { return {url:`https://sandbox.whop.com/verify-identity/${id}?use_case=${useCase}`,expires_at:new Date(Date.now()+600000).toISOString()}; }
  async account(id) { return {id,status:'active',parent_account:{id:'biz_Platform'},capabilities:{accept_card_payments:'active'},verification:{individual:{status:'approved'},business:null}}; }
  verified(account,id) { return account.id===id; }
  async quote(body,key) {
    this.quoteCalls.push({body,key});
    const subtotal=decimalMinor(body.variant.initial_price.toFixed(2));
    const tax=this.noTax ? 0n : (subtotal*8n+50n)/100n;
    const total=subtotal+tax+(this.changedQuote && body.variant.application_fee_amount ? 1n : 0n);
    const id=`pq_${this.quotes.size+1}`;
    const quote={id,account_id:body.account_id,currency:'usd',tax_status:this.taxUnavailable ? 'unavailable' : (this.noTax ? 'not_applicable' : 'calculated'),located_by:body.shipping_address ? 'shipping_address' : 'address',tax_amount:money(tax),total:money(total),expires_at:new Date(Date.now()+600000).toISOString()};
    this.quotes.set(id,{...quote,body}); return quote;
  }
  async createPayment(body,key) {
    this.paymentCalls.push({body,key});
    if (this.prechargeRefused) { const error=new FeeError('provider_precharge_refused','Quote refused before charging.',409);error.providerCode='quote_mismatch';throw error; }
    let payment=this.commands.get(key);
    if (!payment) {
      const quote=this.quotes.get(body.quote_id);
      const id=`pay_${this.payments.size+1}`;
      payment={id,account_id:body.account_id,quote_id:body.quote_id,metadata:body.metadata,
        status:this.pending ? 'pending' : 'paid',paid_at:this.pending ? null : new Date().toISOString(),
        amount_charged:money(decimalMinor(quote.total.amount)+this.extraBuyerFee),tax_amount:this.noTax ? null : quote.tax_amount,
        actual_fee_minor:(decimalMinor(quote.body.variant.application_fee_amount.toFixed(2))+this.feeDifference).toString(),presentment_refunded_amount:money(0)};
      this.payments.set(id,payment); this.commands.set(key,payment); this.chargeCount++;
    }
    if (this.failOnce) { this.failOnce=false; throw new FeeError('provider_outcome_unknown','Response lost after provider accepted the command.',502); }
    return payment;
  }
  async payment(id) { return this.payments.get(id); }
  async applicationFee(id) { return this.feePending ? null : this.payments.get(id).actual_fee_minor; }
}
export function purchase(reference) {
  return {order_reference:reference,subtotal_minor:'10000',confirmation_token:'ctok_Test',
    billing_address:{country:'US',state:'CA',postal_code:'94105'}};
}
