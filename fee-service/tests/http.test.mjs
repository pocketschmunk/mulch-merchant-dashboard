import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.js';
import { createHmac } from 'node:crypto';
import { API_VERSION_DATE } from '../src/whop.js';
const token='test-only-backend-token-with-more-than-32-chars';
async function withApp(work) {
  let mutated=0;
  const service={charge:async()=>{mutated++;return {status:'pending'};},webhook:async()=>{mutated++;return {ok:true};}};
  const app=createApp({repository:{},service,env:{BACKEND_SERVICE_TOKEN:token,WHOP_WEBHOOK_SECRET:'ws_'+'11'.repeat(32)}});
  app.listen(0,'127.0.0.1');await once(app,'listening');const origin=`http://127.0.0.1:${app.address().port}`;
  try{await work(origin,()=>mutated);}finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
}
const post=(origin,path,body,auth=true)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
test('fee schedule is public but does not activate collection',()=>withApp(async(origin)=>{const response=await fetch(origin+'/api/fee-policy');const body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.tiers.map(t=>t.basisPoints),[280,150,50]);assert.equal(body.monthlyPlans.standard,150);assert.equal(body.monthlyPlans.premium,250);}));
test('private backend endpoints reject unauthorized browsers',()=>withApp(async(origin,count)=>{const response=await post(origin,'/api/stores',{},false);assert.equal(response.status,401);assert.equal(count(),0);}));
test('backend fee preview includes tax-gross and whole crossing charge',()=>withApp(async(origin)=>{const response=await post(origin,'/api/fees/preview',{lifetimeMinor:'4995000',grossMinor:'10800'});const body=await response.json();assert.equal(response.status,200);assert.equal(body.feeMinor,'162');assert.equal(body.basisPoints,150);}));
test('browser return cannot verify payments or account access',()=>withApp(async(origin,count)=>{const response=await fetch(origin+'/payments/return?success=true');assert.equal((await response.json()).verified,false);assert.equal(count(),0);}));
test('unsigned webhook fails before state changes',()=>withApp(async(origin,count)=>{const response=await post(origin,'/api/webhooks/whop',{type:'payment.succeeded',data:{id:'pay_Test'}},false);assert.equal(response.status,401);assert.equal(count(),0);}));
test('unknown account override is not accepted in a charge request',()=>withApp(async(origin,count)=>{const response=await post(origin,'/api/stores/Store/charges',{account_id:'biz_Attacker'});assert.equal(response.status,400);assert.equal(count(),0);}));
test('merchant fee basis cannot be a numeric float',()=>withApp(async(origin)=>{const response=await post(origin,'/api/fees/preview',{lifetimeMinor:'0',grossMinor:108.00});assert.equal(response.status,400);}));
test('unsupported method cannot mutate private state',()=>withApp(async(origin,count)=>{const response=await fetch(origin+'/api/stores/Store/charges',{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,405);assert.equal(count(),0);}));
function signed(raw) {
  const id='msg_SignedRaw';const timestamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','ws_'+'11'.repeat(32)).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return {'Content-Type':'application/json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':`v1,${signature}`};
}
test('official SDK accepts signature over exact raw bytes and literal ws_ secret',()=>withApp(async(origin,count)=>{
  const raw=`{ "api_version_date": "${API_VERSION_DATE}", "type": "payment.succeeded", "id": "msg_SignedRaw", "data": {} }`;
  const response=await fetch(origin+'/api/webhooks/whop',{method:'POST',headers:signed(raw),body:raw});assert.equal(response.status,200);assert.equal(count(),1);
}));
test('tampering or wrong API version cannot process a signed webhook',()=>withApp(async(origin,count)=>{
  const raw=JSON.stringify({api_version_date:API_VERSION_DATE,type:'payment.succeeded'});
  const tampered=await fetch(origin+'/api/webhooks/whop',{method:'POST',headers:signed(raw),body:raw+' '});assert.equal(tampered.status,401);
  const wrong=JSON.stringify({api_version_date:'2025-01-01',type:'payment.succeeded'});
  const response=await fetch(origin+'/api/webhooks/whop',{method:'POST',headers:signed(wrong),body:wrong});assert.equal(response.status,400);assert.equal(count(),0);
}));
test('oversized JSON body is rejected without state changes',()=>withApp(async(origin,count)=>{
  const response=await post(origin,'/api/fees/preview',{padding:'x'.repeat(70000)});assert.equal(response.status,413);assert.equal(count(),0);
}));
test('health reports configuration readiness, not a fabricated live-activation result',()=>withApp(async(origin)=>{
  const body=await (await fetch(origin+'/healthz')).json();assert.equal(body.productionConfigurationReady,false);assert.equal(body.liveActivated,undefined);
}));
test('unsupported saved-method purchases fail explicitly',()=>withApp(async(origin,count)=>{
  const response=await post(origin,'/api/stores/Store/charges',{order_reference:'saved_method',subtotal_minor:'10000',member_id:'mber_Test',payment_method_id:'payt_Test',off_session:true,billing_address:{country:'US'}});
  assert.equal(response.status,409);assert.equal((await response.json()).error,'unsupported_saved_method');assert.equal(count(),0);
}));
