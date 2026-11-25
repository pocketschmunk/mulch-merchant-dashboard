import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Repository } from '../src/repository.js';
import { FeeService } from '../src/service.js';
import { Vault } from '../src/vault.js';
import { FakeProvider, purchase, money } from './fixtures.mjs';
import { POLICY_VERSION } from '../src/policy.js';
const database=process.env.TEST_DATABASE_URL;
test('PostgreSQL ledger and controlled-payment integration',{skip:!database},async t => {
  // This test destroys only its own declared isolated test database tables.
  if (!new URL(database).pathname.includes('test')) throw new Error('TEST_DATABASE_URL must name a test database.');
  const pool=new Pool({connectionString:database,max:8});
  try {
    await pool.query('DROP TABLE IF EXISTS mulch_fee_events,mulch_fee_attempts,mulch_fee_stores,mulch_schema_migrations CASCADE');
    await pool.query(await readFile(new URL('../migrations/001_fee_ledger.sql',import.meta.url),'utf8'));
    const repository=new Repository(pool); const provider=new FakeProvider();
    const service=new FeeService({repository,provider,vault:new Vault('11'.repeat(32)),env:{PUBLIC_APP_ORIGIN:'https://app.mulchcheckout.com'}});
    let sequence=0;
    async function store(volume='0') {
      const id=`Store${++sequence}`;
      await repository.register({id,merchant_id:'Merchant',shop_domain:`test-${sequence}.myshopify.com`,login_email:'merchant@example.test',country:'US'});
      await repository.readiness(id,{access_verified:true,shopify_verified:true,store_review_approved:true,consent_reference:'consent:verified:28015050',product_id:'prod_Test',consent_policy_version:POLICY_VERSION});
      await service.connect(id); await service.refresh(id);
      await pool.query('UPDATE mulch_fee_stores SET lifetime_minor=$2 WHERE id=$1',[id,volume]);
      return id;
    }
    await t.test('two quotes bind full tax-inclusive fee and successful capture',async () => {
      const id=await store(); const result=await service.charge(id,'command_1',purchase('order_1'));
      assert.equal(result.status,'succeeded'); assert.equal(result.gross_minor,'10800'); assert.equal(result.fee_minor,'302'); assert.equal(result.actual_fee_minor,'302');
      const summary=await repository.summary(id); assert.equal(summary.lifetimeGrossMinor,'10800');
      const body=provider.paymentCalls.at(-1).body; assert.equal(body.quote_id,result.quote_id); assert.equal(body.apply_surcharge,undefined); assert.equal(body.billing_address,undefined); assert.equal(body.capture,true);
      assert.equal(provider.quoteCalls.at(-1).body.variant.application_fee_amount,3.02);
      assert.equal((await repository.getAttempt(result.id)).payload_ciphertext,null);
    });
    await t.test('first crossing entire payment uses Growth',async () => {
      const id=await store('4995000'); const result=await service.charge(id,'crossing_1',purchase('crossing1'));
      assert.equal(result.basis_points,150); assert.equal(result.fee_minor,'162'); assert.equal((await repository.summary(id)).earnedBasisPoints,150);
    });
    await t.test('second crossing entire payment uses Scale',async () => {
      const id=await store('24995000'); const result=await service.charge(id,'crossing_2',purchase('crossing2'));
      assert.equal(result.basis_points,50); assert.equal(result.fee_minor,'54');
    });
    await t.test('same key replay does not charge or count twice',async () => {
      const id=await store(); const before=provider.chargeCount;
      const first=await service.charge(id,'same_key',purchase('same_order'));
      const second=await service.charge(id,'same_key',purchase('same_order'));
      assert.equal(first.id,second.id); assert.equal(provider.chargeCount,before+1); assert.equal((await repository.summary(id)).lifetimeGrossMinor,'10800');
      await assert.rejects(() => service.charge(id,'same_key',purchase('different_order')),error => error.code==='idempotency_conflict');
    });
    await t.test('concurrent payments serialize a store and cannot advance on unpaid reservations',async () => {
      const id=await store('4995000'); provider.pending=true;
      const results=await Promise.allSettled([service.charge(id,'concurrent_a',purchase('conc_a')),service.charge(id,'concurrent_b',purchase('conc_b'))]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const failed=results.find(result=>result.status==='rejected'); assert.equal(failed.reason.code,'store_busy');
      assert.equal((await repository.summary(id)).lifetimeGrossMinor,'4995000');
      const result=results.find(result=>result.status==='fulfilled').value;
      const payment=provider.payments.get(result.payment_id); payment.status='paid';payment.paid_at=new Date().toISOString();provider.pending=false;
      await service.reconcile(result.id); assert.equal((await repository.summary(id)).lifetimeGrossMinor,'5005800');
    });
    await t.test('lost creation response replays exact provider key and encrypted payload',async () => {
      const id=await store(); provider.failOnce=true; const before=provider.chargeCount;
      await assert.rejects(()=>service.charge(id,'lost_response',purchase('lost_order')));
      const retry=await service.charge(id,'lost_response',purchase('lost_order'));
      assert.equal(retry.status,'succeeded');assert.equal(provider.chargeCount,before+1);
      assert.deepEqual(provider.paymentCalls.at(-1),provider.paymentCalls.at(-2));
    });
    await t.test('changed final quote never submits or advances lifetime',async () => {
      const id=await store();provider.changedQuote=true;const before=provider.chargeCount;
      await assert.rejects(()=>service.charge(id,'changed_quote',purchase('changed_order')),error=>error.code==='quote_changed');provider.changedQuote=false;
      assert.equal(provider.chargeCount,before);assert.equal((await repository.summary(id)).lifetimeGrossMinor,'0');assert.equal((await repository.summary(id)).unresolvedAttemptId,null);
    });
    await t.test('buyer fee mismatch locks review and does not silently certify collection',async () => {
      const id=await store();provider.extraBuyerFee=100n;
      const result=await service.charge(id,'buyer_mismatch',purchase('buyer_mismatch'));provider.extraBuyerFee=0n;
      assert.equal(result.status,'review');assert.equal(result.issue,'captured_gross_or_tax_mismatch');assert.equal((await repository.getStore(id)).provider_verified,false);
      assert.equal((await repository.summary(id)).lifetimeGrossMinor,'0');
    });
    await t.test('actual application fee mismatch is exposed and halts store',async () => {
      const id=await store();provider.feeDifference=-1n;
      const result=await service.charge(id,'fee_mismatch',purchase('fee_mismatch'));provider.feeDifference=0n;
      assert.equal(result.status,'review');assert.equal(result.issue,'application_fee_collection_mismatch');
      assert.equal((await repository.summary(id)).lifetimeGrossMinor,'10800');assert.equal(result.actual_fee_minor,'301');assert.equal((await service.refresh(id)).readyForPayments,false);
    });
    await t.test('refund preserves gross lifetime and earned tier; duplicate events are idempotent',async () => {
      const id=await store('24995000');const result=await service.charge(id,'refund_order',purchase('refund_order'));
      const payment=provider.payments.get(result.payment_id);payment.presentment_refunded_amount=money(10800);
      const event={id:'msg_RefundTest',type:'payment.succeeded',account_id:payment.account_id,data:payment};
      await service.webhook(event);assert.deepEqual(await service.webhook(event),{duplicate:true});
      const summary=await repository.summary(id);assert.equal(summary.lifetimeGrossMinor,'25005800');assert.equal(summary.earnedBasisPoints,50);assert.equal(summary.refunded_minor,'10800');
    });
    await t.test('provider terminal nonpayment releases slot without counting failed volume',async () => {
      const id=await store();provider.pending=true;const result=await service.charge(id,'terminal_void',purchase('terminal_void'));provider.pending=false;
      const payment=provider.payments.get(result.payment_id);payment.status='void';
      const reconciled=await service.reconcile(result.id);assert.equal(reconciled.status,'failed');assert.equal((await repository.summary(id)).lifetimeGrossMinor,'0');assert.equal((await repository.summary(id)).unresolvedAttemptId,null);
    });
    await t.test('webhook from another account cannot bind an attempt',async () => {
      const id=await store();provider.pending=true;const result=await service.charge(id,'isolated',purchase('isolated'));provider.pending=false;
      await assert.rejects(()=>service.webhook({id:'msg_WrongAccount',type:'payment.succeeded',account_id:'biz_OtherStore',data:{id:result.payment_id,metadata:{mulch_attempt_id:result.id,mulch_store_id:id}}}),error=>error.code==='event_account_mismatch');
    });
    await t.test('a new command key cannot charge an already-paid order',async()=>{
      const id=await store();await service.charge(id,'original_order_key',purchase('unique_order'));const before=provider.chargeCount;
      await assert.rejects(()=>service.charge(id,'different_order_key',purchase('unique_order')),e=>e.code==='duplicate_order');assert.equal(provider.chargeCount,before);
    });
    await t.test('canonical hashing accepts reordered equivalent purchases',async()=>{
      const id=await store();const input=purchase('canonical');const first=await service.charge(id,'canonical_key',input);
      const reordered={billing_address:{postal_code:'94105',state:'CA',country:'US'},confirmation_token:input.confirmation_token,subtotal_minor:input.subtotal_minor,order_reference:input.order_reference};
      assert.equal((await service.charge(id,'canonical_key',reordered)).id,first.id);
    });
    await t.test('nullable payment tax means zero only for an untaxed quote',async()=>{
      const id=await store();provider.noTax=true;const result=await service.charge(id,'no_tax_key',purchase('no_tax'));provider.noTax=false;
      assert.equal(result.status,'succeeded');assert.equal(result.tax_minor,'0');assert.equal(result.gross_minor,'10000');assert.equal(result.fee_minor,'280');
    });
    await t.test('captured volume and refunds count while actual fee evidence is pending',async()=>{
      const id=await store('4995000');provider.feePending=true;const result=await service.charge(id,'pending_fee_key',purchase('pending_fee'));
      assert.equal(result.status,'pending');assert.ok(result.counted_at);const summary=await repository.summary(id);
      assert.equal(summary.lifetimeGrossMinor,'5005800');assert.equal(summary.earnedBasisPoints,150);assert.equal(summary.unresolvedAttemptId,result.id);
      assert.equal((await repository.getAttempt(result.id)).payload_ciphertext,null);
      provider.payments.get(result.payment_id).presentment_refunded_amount=money(10800);await service.reconcile(result.id);
      assert.equal((await repository.summary(id)).refunded_minor,'10800');assert.equal((await repository.summary(id)).lifetimeGrossMinor,'5005800');
      provider.feePending=false;assert.equal((await service.reconcile(result.id)).status,'succeeded');
    });
    await t.test('prepared command resumes once without creating a new purchase',async()=>{
      const id=await store();const submit=service.submit;service.submit=async attemptId=>repository.getAttempt(attemptId);
      const prepared=await service.charge(id,'prepared_key',purchase('prepared_order'));service.submit=submit;
      assert.equal(prepared.status,'prepared');assert.equal((await service.charge(id,'prepared_key',purchase('prepared_order'))).status,'succeeded');
    });
    await t.test('stale submitting lease reuses the same provider command after acceptance',async()=>{
      const id=await store();const submit=service.submit;const before=provider.chargeCount;
      service.submit=async attemptId=>{const claimed=await repository.claim(attemptId);await provider.createPayment(service.vault.open(claimed.payload_ciphertext,attemptId),`mulch-payment-${attemptId}`);return claimed;};
      const stalled=await service.charge(id,'stale_submit_key',purchase('stale_submit'));service.submit=submit;
      await pool.query("UPDATE mulch_fee_attempts SET updated_at=now()-interval '31 seconds' WHERE id=$1",[stalled.id]);
      assert.equal((await service.charge(id,'stale_submit_key',purchase('stale_submit'))).status,'succeeded');assert.equal(provider.chargeCount,before+1);
    });
    await t.test('expired replay erases sensitive payload but never releases an unknown charge',async()=>{
      const id=await store();provider.failOnce=true;await assert.rejects(()=>service.charge(id,'expired_replay_key',purchase('expired_replay')));
      await pool.query("UPDATE mulch_fee_attempts SET first_submit_at=now()-interval '6 minutes' WHERE store_id=$1",[id]);const before=provider.chargeCount;
      const expiredId=(await pool.query('SELECT id FROM mulch_fee_attempts WHERE store_id=$1',[id])).rows[0].id;
      assert.equal((await service.reconcile(expiredId)).issue,'manual_reconciliation_required');assert.equal(provider.chargeCount,before);
      const result=await service.charge(id,'expired_replay_key',purchase('expired_replay'));assert.equal(result.status,'unknown');assert.equal(result.issue,'manual_reconciliation_required');
      assert.equal(provider.chargeCount,before);assert.equal((await repository.getAttempt(result.id)).payload_ciphertext,null);assert.equal((await repository.summary(id)).unresolvedAttemptId,result.id);
      await assert.rejects(()=>service.charge(id,'replacement_key',purchase('replacement')),e=>e.code==='store_busy');
      const payment=[...provider.payments.values()].find(p=>p.metadata.mulch_attempt_id===result.id);
      await service.webhook({id:'msg_LateRecovery',type:'payment.succeeded',account_id:payment.account_id,data:payment});assert.equal((await repository.summary(id)).lifetimeGrossMinor,'10800');
    });
    await t.test('unavailable tax fails before any payment submission',async()=>{
      const id=await store();provider.taxUnavailable=true;const before=provider.chargeCount;
      await assert.rejects(()=>service.charge(id,'tax_unavailable_key',purchase('tax_unavailable')),e=>e.code==='quote_not_payable');provider.taxUnavailable=false;
      assert.equal(provider.chargeCount,before);assert.equal((await repository.summary(id)).unresolvedAttemptId,null);
    });
    await t.test('proven first-submission quote refusal releases slot, allowing a failed-order retry',async()=>{
      const id=await store();provider.prechargeRefused=true;
      await assert.rejects(()=>service.charge(id,'refused_quote_key',purchase('refused_quote')),e=>e.code==='provider_precharge_refused');provider.prechargeRefused=false;
      assert.equal((await repository.summary(id)).unresolvedAttemptId,null);assert.equal((await service.charge(id,'retry_refused_key',purchase('refused_quote'))).status,'succeeded');
    });
    await t.test('failure cannot regress an already-counted payment',async()=>{
      const id=await store();const result=await service.charge(id,'counted_key',purchase('counted_order'));assert.equal((await repository.fail(result.id,'stale_failure',true)).status,'succeeded');assert.equal((await repository.summary(id)).lifetimeGrossMinor,'10800');
    });
    await t.test('different stores have independent pending-payment slots',async()=>{
      const a=await store();const b=await store();provider.pending=true;
      const results=await Promise.all([service.charge(a,'store_a_key',purchase('store_a')),service.charge(b,'store_b_key',purchase('store_b'))]);provider.pending=false;
      assert.ok(results.every(result=>result.status==='pending'));assert.notEqual(results[0].id,results[1].id);
    });
    await t.test('payment and quote requests use only fields in saved official contracts',async()=>{
      for(const [name,calls] of [['payment',provider.paymentCalls],['quote',provider.quoteCalls]]) {
        const contract=JSON.parse(await readFile(new URL(`../docs/whop-${name}-contract.json`,import.meta.url),'utf8'));
        const allowed=Object.assign({},...contract.request.allOf.map(part=>part.properties || contract.schemas[part.$ref.split('/').at(-1)].properties));
        for(const call of calls) for(const key of Object.keys(call.body)) assert.ok(key in allowed,`${name}: unsupported ${key}`);
      }
    });
  } finally { await pool.end(); }
});
