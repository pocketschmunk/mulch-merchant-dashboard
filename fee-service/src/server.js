import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { unwrapWebhook } from '@whop/sdk/helpers';
import { Repository } from './repository.js';
import { FeeService } from './service.js';
import { WhopProvider, API_VERSION_DATE } from './whop.js';
import { Vault } from './vault.js';
import { FeeError, TIERS, POLICY_VERSION, feeFor, minor } from './policy.js';
const ID = /^[A-Za-z0-9_-]{1,80}$/;
function only(object, fields) {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(key => !fields.includes(key))) {
    throw new FeeError('invalid_fields', 'Request has unsupported fields.');
  }
}
function text(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new FeeError('invalid_input', `${label} is invalid.`);
}
function address(value) {
  if (!value) return;
  only(value,['country','state','postal_code','city','line1','line2','name']);
  for (const item of Object.values(value)) if (typeof item !== 'string' || item.length > 250) throw new FeeError('invalid_address','Address values must be short strings.');
  text(value.country,/^[A-Z]{2}$/,'Address country');
}
function chargeInput(body) {
  only(body,['order_reference','subtotal_minor','billing_address','shipping_address','confirmation_token','member_id','payment_method_id','off_session']);
  text(body.order_reference,/^[A-Za-z0-9:_-]{1,100}$/,'Order reference');
  minor(body.subtotal_minor); address(body.billing_address); address(body.shipping_address);
  if (!body.billing_address && !body.shipping_address) throw new FeeError('location_required','A verified buyer location is required to price customer tax.');
  if (body.confirmation_token) {
    text(body.confirmation_token,/^ctok_[A-Za-z0-9]+$/,'Confirmation token');
    if (body.member_id || body.payment_method_id || body.off_session !== undefined) throw new FeeError('method_conflict','Use a confirmation token or an authorized saved method, not both.');
  } else {
    text(body.member_id,/^mber_[A-Za-z0-9]+$/,'Member ID');
    text(body.payment_method_id,/^payt_[A-Za-z0-9]+$/,'Payment method ID');
    if (typeof body.off_session !== 'boolean') throw new FeeError('session_required','Saved-method charges require an explicit off_session boolean and upstream charge consent.');
    throw new FeeError('unsupported_saved_method','This source release supports one-time confirmation-token purchases only.',409);
  }
}
async function rawBody(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new FeeError('body_too_large','Body exceeds 64 KiB.',413);
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}
const digest = value => createHash('sha256').update(value).digest();
function authorized(req, token) {
  return typeof token === 'string' && token.length >= 32 && timingSafeEqual(digest(req.headers.authorization || ''),digest(`Bearer ${token}`));
}
export function createApp({repository,service,env = process.env,verifyWebhook = unwrapWebhook}) {
  return createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Robots-Tag','noindex, nofollow');
    const reply = (status,data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url,'http://local.invalid').pathname;
      if (req.method === 'GET' && path === '/healthz') {
        let productionConfigurationReady = false;
        if (env.WHOP_ENVIRONMENT === 'production') { try { new WhopProvider(env).guard(); productionConfigurationReady = true; } catch {} }
        return reply(200,{ok:true,providerMode:env.WHOP_ENVIRONMENT || 'disabled',productionConfigurationReady});
      }
      if (req.method === 'GET' && path === '/api/fee-policy') return reply(200,{version:POLICY_VERSION,currency:'usd',basis:'full_customer_payment_including_tax_before_processing_fees',tiers:TIERS,wholeCrossingPayment:true,earnedRatesNeverIncrease:true,monthlyPlans:{standard:150,premium:250}});
      if (req.method === 'GET' && ['/payments/return','/payments/refresh','/checkout/return'].includes(path)) {
        return reply(200,{verified:false,message:'Return to the merchant dashboard and refresh verified provider state. This browser return does not confirm payment, verification or access.'});
      }
      if (req.method === 'POST' && path === '/api/webhooks/whop') {
        if (!env.WHOP_WEBHOOK_SECRET) throw new FeeError('webhook_not_configured','Webhook verification is not configured.',503);
        let event;
        const raw = await rawBody(req);
        try { event = verifyWebhook(raw,{headers:req.headers,key:env.WHOP_WEBHOOK_SECRET}); }
        catch { throw new FeeError('invalid_signature','Webhook signature verification failed.',401); }
        if (event.api_version_date !== API_VERSION_DATE) throw new FeeError('webhook_version_mismatch','Pin the webhook to the documented API version.',400);
        return reply(200,await service.webhook(event));
      }
      if (!authorized(req,env.BACKEND_SERVICE_TOKEN)) throw new FeeError('unauthorized','Backend service authorization is required.',401);
      if (!['GET','POST'].includes(req.method)) throw new FeeError('method_not_allowed','Method not allowed.',405);
      let body = {};
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new FeeError('json_required','Content-Type must be application/json.',415);
        try { body = JSON.parse(await rawBody(req)); }
        catch (error) { if (error instanceof FeeError) throw error; throw new FeeError('invalid_json','Request is not valid JSON.'); }
      }
      if (req.method === 'POST' && path === '/api/fees/preview') {
        only(body,['lifetimeMinor','grossMinor','earnedBasisPoints']);
        return reply(200,feeFor(body));
      }
      if (req.method === 'POST' && path === '/api/stores') {
        only(body,['id','merchant_id','shop_domain','login_email','country']);
        text(body.id,ID,'Store ID'); text(body.merchant_id,ID,'Merchant ID');
        text(body.shop_domain,/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/,'Shopify domain');
        text(body.login_email,/^[^\s@]{1,100}@[^\s@]{1,150}\.[^\s@]{2,30}$/,'Merchant email');
        text(body.country,/^[A-Z]{2}$/,'Country');
        const store = await repository.register(body);
        return reply(201,{storeId:store.id,state:'registered'});
      }
      const storeMatch = path.match(/^\/api\/stores\/([A-Za-z0-9_-]{1,80})\/(readiness|connect-payments|refresh-payments|manage-payouts|fees|charges)$/);
      if (storeMatch) {
        const [,storeId,action] = storeMatch;
        if (req.method === 'GET' && action === 'fees') return reply(200,await repository.summary(storeId));
        if (req.method !== 'POST') throw new FeeError('method_not_allowed','This action requires POST.',405);
        if (action === 'readiness') {
          only(body,['access_verified','shopify_verified','store_review_approved','consent_reference','product_id','consent_policy_version']);
          for (const name of ['access_verified','shopify_verified','store_review_approved']) if (typeof body[name] !== 'boolean') throw new FeeError('invalid_readiness','Readiness flags require verified backend booleans.');
          text(body.consent_reference,/^[A-Za-z0-9:_-]{10,200}$/,'Fee-consent evidence reference');
          text(body.product_id,/^prod_[A-Za-z0-9]+$/,'Dedicated product ID');
          if (body.consent_policy_version !== POLICY_VERSION) throw new FeeError('consent_version_mismatch','Merchant consent must cover the current fee policy.',409);
          await repository.readiness(storeId,body); return reply(200,{storeId,state:'upstream_readiness_recorded'});
        }
        if (action === 'connect-payments' || action === 'manage-payouts') { only(body,[]); return reply(200,await service.connect(storeId,action === 'manage-payouts' ? 'payouts_portal' : 'account_onboarding')); }
        if (action === 'refresh-payments') { only(body,[]); return reply(200,await service.refresh(storeId)); }
        if (action === 'charges') {
          chargeInput(body); const key = req.headers['idempotency-key'];
          text(key,/^[A-Za-z0-9_-]{8,200}$/,'Idempotency-Key');
          return reply(200,await service.charge(storeId,key,body));
        }
      }
      const attemptMatch = path.match(/^\/api\/attempts\/([a-f0-9-]{36})\/reconcile$/);
      if (req.method === 'POST' && attemptMatch) { only(body,[]); return reply(200,await service.reconcile(attemptMatch[1])); }
      throw new FeeError('not_found','Route not found.',404);
    } catch (error) {
      if (error.code === '23505') return reply(409,{error:'duplicate_record',message:'A store, order or payment record already exists. Reconcile the original command.'});
      const known = error instanceof FeeError;
      reply(known ? error.status : 500,{error:known ? error.code : 'internal_error',message:known ? error.message : 'Request failed. No payment outcome is implied.'});
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL || !process.env.BACKEND_SERVICE_TOKEN || process.env.BACKEND_SERVICE_TOKEN.length < 32) throw new Error('DATABASE_URL and a strong BACKEND_SERVICE_TOKEN are required.');
  const pool = new Pool({connectionString:process.env.DATABASE_URL,max:10});
  const repository = new Repository(pool);
  const service = new FeeService({repository,provider:new WhopProvider(),vault:new Vault(process.env.PAYLOAD_ENCRYPTION_KEY)});
  const server = createApp({repository,service});
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',() => console.log('Mulch fee API started. Provider mode:',process.env.WHOP_ENVIRONMENT || 'disabled'));
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
}
