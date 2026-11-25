import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WhopProvider, API_VERSION_DATE } from '../src/whop.js';
import { Vault } from '../src/vault.js';
const env={WHOP_ENVIRONMENT:'sandbox',WHOP_API_KEY:'test_fixture_not_a_real_key',WHOP_PLATFORM_ACCOUNT_ID:'biz_Platform'};
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
test('disabled provider never calls network',async()=>{let called=false;const provider=new WhopProvider({},async()=>{called=true;});await assert.rejects(()=>provider.quote({},'test'),e=>e.code==='provider_disabled');assert.equal(called,false);});
test('production requires every explicit activation gate',async()=>{const provider=new WhopProvider({...env,WHOP_ENVIRONMENT:'production'},async()=>{throw new Error('must not call network');});await assert.rejects(()=>provider.quote({},'test'),e=>e.code==='production_not_approved');});
test('sandbox requests cannot be redirected to production',async()=>{const calls=[];const provider=new WhopProvider(env,async(url,options)=>{calls.push({url,options});return response({id:'pq_Test'});});await provider.quote({account_id:'biz_Store'},'stable-key');assert.match(calls[0].url,/^https:\/\/sandbox-api\.whop\.com\/api\/v1\/payment_quotes$/);assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers['Api-Version-Date'],API_VERSION_DATE);assert.equal(calls[0].options.headers['Idempotency-Key'],'stable-key');});
test('fee breakdown selects collected application_fee, never Whop processing fee',async()=>{const money=amount=>({amount,currency:'usd',decimals:2});const provider=new WhopProvider(env,async()=>response({data:[{origin:'whop_processing_fee',amount:money('10.00'),collected_at:'2026-11-24'},{origin:'application_fee',amount:money('3.02'),collected_at:'2026-11-24'}]}));assert.equal(await provider.applicationFee('pay_Test'),'302');});
test('missing collected fee stays pending, not reported paid',async()=>{const provider=new WhopProvider(env,async()=>response({data:[{origin:'application_fee',amount:{amount:'3.02',currency:'usd',decimals:2},collected_at:null}]}));assert.equal(await provider.applicationFee('pay_Test'),null);});
test('connected verification checks ownership, capability and provider status',()=>{const provider=new WhopProvider(env);const account={id:'biz_Store',status:'active',parent_account:{id:'biz_Platform'},capabilities:{accept_card_payments:'active'},verification:{individual:{status:'approved'}}};assert.equal(provider.verified(account,'biz_Store'),true);assert.equal(provider.verified({...account,parent_account:{id:'biz_Other'}},'biz_Store'),false);assert.equal(provider.verified({...account,status:'suspended'},'biz_Store'),false);});
test('onboarding creates its own store account and uses only documented fields',async()=>{const calls=[];const provider=new WhopProvider(env,async(url,options)=>{calls.push(JSON.parse(options.body));return response({id:'biz_NewAccount'});});await provider.createAccount({id:'Store',shop_domain:'store.myshopify.com',login_email:'merchant@example.test',country:'US'});const schema=JSON.parse(await readFile(new URL('../docs/whop-account-contract.json',import.meta.url)));assert.ok(Object.keys(calls[0]).every(key=>key in schema.request.properties));assert.equal(calls[0].external_id,'mulch-store:Store');assert.equal(calls[0].country,'us');assert.equal(calls[0].email,'merchant@example.test');});
test('vault ciphertext does not expose payload and is bound to one attempt',()=>{const vault=new Vault('11'.repeat(32));const payload={confirmation_token:'ctok_NotStoredInPlaintext',address:{postal_code:'94105'}};const ciphertext=vault.seal(payload,'attemptA');assert.ok(!ciphertext.includes('ctok_'));assert.deepEqual(vault.open(ciphertext,'attemptA'),payload);assert.throws(()=>vault.open(ciphertext,'attemptB'));assert.throws(()=>new Vault('short'));});

import { FeeService } from '../src/service.js';
import { money } from './fixtures.mjs';
test('each missing production gate independently blocks all requests',()=>{
  const gates=['LIVE_PAYMENT_ACTIVATION_APPROVED','TAX_INCLUSIVE_SANDBOX_VERIFIED','ALL_MERCHANT_PAYMENTS_USE_FEE_SERVICE','BUYER_FEES_DISABLED_VERIFIED'];
  for(const missing of gates) { const settings={...env,WHOP_ENVIRONMENT:'production',...Object.fromEntries(gates.map(name=>[name,'true'])),[missing]:'false'};assert.throws(()=>new WhopProvider(settings).guard(),e=>e.code==='production_not_approved'); }
});
test('quote-specific native fields are checked against the saved documentation',async()=>{
  const contract=JSON.parse(await readFile(new URL('../docs/whop-payment-contract.json',import.meta.url),'utf8'));
  const properties=contract.request.allOf[1].properties;
  assert.match(properties.apply_surcharge.description,/not with `quote_id`/);assert.match(properties.billing_address.description,/Only with a `paypal`/);
});
test('only whitelisted 400 quote refusals receive proven pre-charge classification',async()=>{
  const provider=new WhopProvider(env,async()=>new Response(JSON.stringify({error:{type:'bad_request',code:'quote_mismatch',message:'sensitive raw customer detail'}}),{status:400}));
  await assert.rejects(()=>provider.createPayment({},'fixture'),e=>e.code==='provider_precharge_refused' && e.providerCode==='quote_mismatch' && !e.message.includes('sensitive'));
  const unknown=new WhopProvider(env,async()=>new Response(JSON.stringify({error:{code:'quote_in_use',message:'not proof of zero charges'}}),{status:409}));
  await assert.rejects(()=>unknown.createPayment({},'fixture'),e=>e.code==='provider_request_failed');
});
test('quote validation rejects invalid expiry and preview-only tax',()=>{
  const service=new FeeService({repository:{},provider:{},vault:{}});
  const quote={id:'pq_Test',account_id:'biz_Store',currency:'usd',total:money(10800),tax_amount:money(800),tax_status:'calculated',located_by:'address',expires_at:new Date(Date.now()+600000).toISOString()};
  service.verifyQuote(quote,'biz_Store');assert.throws(()=>service.verifyQuote({...quote,expires_at:'not-a-date'},'biz_Store'),e=>e.code==='quote_expired');assert.throws(()=>service.verifyQuote({...quote,located_by:'ip_address'},'biz_Store'),e=>e.code==='quote_not_payable');
});
test('partly approved verification cannot enable payments',()=>{
  const account={id:'biz_Store',status:'active',parent_account:{id:'biz_Platform'},capabilities:{accept_card_payments:'active'},verification:{individual:{status:'approved'},business:{status:'pending'}}};assert.equal(new WhopProvider(env).verified(account,'biz_Store'),false);
});
