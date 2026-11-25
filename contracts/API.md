# Merchant application API — source 1

Mulch-owned email/password sign-in was selected. Dashboard access requires a server-verified active paid Standard/Premium subscription; there is NO free dashboard, public demo or build-before-purchase access. Authenticated unpaid accounts may use only session/logout, access/purchase-verification and email recovery endpoints. Browser payment returns, membership IDs, plan fields or connection booleans cannot grant access.

## Auth and paid access

GET /api/public-config -> {brand:'Mulch Checkout',authMode:'email',authConfigured:boolean,checkoutOrigin:'https://pay.mulchcheckout.com',policy:{tiers:[{thresholdMinor,basisPoints,rate}],monthlyPlans:{standard:150,premium:250}},sourceOnly:true}
GET /api/session -> {authenticated:boolean,user?:{id,email,name},csrfToken?:string,authMode:'email'}
POST /api/auth/signup {name,email,password} ->202 {message,verificationRequired:true}; login {email,password} ->200 {authenticated:true,user,csrfToken}; logout {}; forgot-password {email} ->202 generic message; resend-verification {email} ->202 generic message; verify-email {token} ->200 {message}; reset-password {token,password} ->200 {message}. Email links lead to /verify-email?token=... or /reset-password?token=..., consumed through POST only. Password reset revokes all sessions and does not auto-login. Missing email service/public origin ->503 auth_not_configured. No email tokens in API responses/logs. POST auth endpoints validate exact APP_ORIGIN; logout also requires X-CSRF-Token. All private mutations require that CSRF token.
GET /api/access -> {hasAccess:boolean,entitlements:[{id,plan:'standard'|'premium',status,storeId:string|null}],plans:[{code,name,amountMinor,checkoutUrl}],verification:{configured:boolean,message:string}}
POST /api/access/refresh {} -> same shape after server-side read-only Whop checks. Access derives from verified Mulch email, exact seller account/variant/member/current membership and a current-period captured positive payment, not only membership status. Only active paid monthly subscriptions, no free trials/past_due/completed grants. A short verification lease expires and refresh fails closed on provider uncertainty. No live provider calls during this build.

Parent supplies createAuth({pool,env}): {mode:'email',configured,handle(req,res,url,body),session(req),verifyCsrf(req,session)}. session returns {user:{id,email,name},csrfToken}|null. Parent supplies createEntitlements({pool,env}): {configured,access(user),refresh(user)}. API createApp({pool,env,auth,entitlements}) returns Node HTTP Server. Its paid guard calls access(user), denies 402 subscription_required if hasAccess false. Root startup serves client/dist through backend static routing; no hosting here.

## Paid stores

GET /api/stores -> {stores:Store[]} (only owned stores with active bound entitlement)
POST /api/stores {name,shopDomain,country,entitlementId} -> {store:Store}. Transactionally lock mulch_entitlements row: owner=user.id, active, verification_expires_at>now(), paid_until>now(), store_id IS NULL; bind once to new mulch_app_stores ID. Never accept plan/status from the browser. Existing inactive store data is retained but denied.
Store = {id,name,shopDomain,country,plan:'standard'|'premium',planStatus:'active',readiness:{shopify:'unconnected'|'configured'|'verified',payments:'unconnected'|'pending'|'verified',storeReview:'pending'|'approved',consent:boolean},lifetimeGrossMinor:string,earnedBasisPoints:280|150|50}
GET /api/stores/:id/bootstrap -> {store,user,resources:Record<string,Resource[]>,analytics,fees,capabilities:Record<string,{available:boolean,reason?:string}>}
POST /api/stores/:id/consent {policyVersion:'mulch-2026-11-24-280-150-50',accepted:true} -> updated store. Consent is not connection verification.
All store endpoints check ownership AND active bound entitlement on each access; Premium gates read/write subscription data and nested subscription-choice blocks. App/operator attestations cannot grant SaaS entitlement.

Parent-owned mulch_entitlements fields: id uuid PK, user_id uuid, provider_membership_id text UNIQUE, provider_member_id text, provider_user_id text, provider_account_id text, provider_variant_id text, payment_id text, plan standard|premium, status text, active boolean, store_id uuid nullable UNIQUE, paid_until timestamptz, verified_at timestamptz, verification_expires_at timestamptz. Parent migration 001_entitlements.sql before fee/schema002; backend migration002 may add FK store_id after stores created. Verification preserves existing store binding across refresh and refuses another user claiming the same membership.

## Resources

GET /api/stores/:id/resources/:kind -> {items:Resource[]}; POST {title,config} -> {item}; PUT /:resourceId {title,config,version} -> {item}; DELETE /:resourceId -> {deleted:true}. Resource = {id,kind,title,status:'draft'|'configured'|'active'|'paused',version,config,createdAt,updatedAt}. Title plain text; config bounded object, strict supported fields, optimistic version conflict409. Drafts/configured are not live. POST /:resourceId/activate {} ->409 operation_not_ready unless actual deployment/provider gates exist; never fake active state. No raw scripts, credentials or native fallback routes.
Kinds and config fields (client/backend use these exact names):
- checkout-design: {accent,background,logoUrl,heading,language,blocks:[{id,type,title,body,visible}]}; required contact/delivery/shipping/payment fixed blocks cannot be removed/hidden. Added block types express,testimonial,rating,trust,guarantee,text,image,timer,faq,value-props,payment-icons,announcement,custom-html,subscription-choice,order-bump. subscription-choice Premium-only; formatting-only custom HTML accepted/safely previewed, no arbitrary JS. All preview cart/buyer/payment data clearly sample, no charge controls.
- thank-you: {heading,message,showOrderSummary:boolean}
- offer: {type:'order-bump'|'upsell',productId:string,discountPercent:number,description:string}
- discount: {code,mode:'percent'|'fixed',value:number,minimumMinor:string,enabled:boolean}
- buy-link: {productId,title,quantity:number}; product IDs are draft Shopify GIDs, activation needs server-ingested product proof. No arbitrary destination/checkout URL.
- survey: {question,answers:string[],required:boolean}
- experiment: {variantA:string,variantB:string,splitPercent:number,metric:'checkout-conversion'|'average-order-value'}; references owned Mulch checkout-design IDs, never native traffic. Test lifecycle stays draft until actual experiment runtime exists.
- general: {currency:'usd',timezone,supportEmail,customDomain}; customDomain configuration is not verified DNS/SSL.
- shipping: {currency:'usd',zones:[{country,rateMinor:string,freeOverMinor:string}]}
- integration: {provider:'meta'|'google'|'tiktok'|'klaviyo',pixelId,enabled:boolean}; no API secrets in these drafts, no claim live delivery.
- subscription-rule: {name,cadence:'weekly'|'monthly'|'quarterly',discountPercent:number,trialDays:number,productId:string} (Premium)
- portal: {allowPause:boolean,allowDeliveryChange:boolean,allowPaymentUpdate:boolean,allowCancel:boolean} (Premium)
- recovery: {retryDays:number[],emailReminders:boolean} (Premium)
- cancel-flow: {question,retentionDiscountPercent:number,allowPause:boolean} (Premium)

## Operational/connection endpoints

GET /api/stores/:id/analytics?period=30d -> {analytics:{revenueMinor:string,orders:number,averageOrderMinor:string,sessions:number,carts:number,checkouts:number,paid:number,storeConversion:number|null,checkoutConversion:number|null,series:[{date,revenueMinor}],mrrMinor?:string,subscribers?:number,churn?:number|null,upcomingRenewals?:object[]}}
GET /orders, /abandoned, /subscribers -> {items:[]}; subscribers Premium-only. GET /recovery -> {items:[],metrics:{}} Premium-only. Empty paid accounts return zeros/empty arrays, never synthetic operational data. Forecast != spendable cash.
GET /fees -> {lifetimeGrossMinor,earnedBasisPoints,expectedFeeMinor,collectedFeeMinor,refundedMinor,unresolvedAttemptId,reviewRequired}
GET /setup-check -> {checks:[{id,label,status:'missing'|'configured'|'verified'|'blocked',detail}]}; read-only no payment calls.
POST /connections/shopify {shopDomain} -> verified OAuth URL if adapter configured; otherwise503 connection_not_configured. No submitted flag marks verified.
POST /connections/payments {action:'connect'|'refresh'|'payouts'} -> {url?,state,readyForPayments?}; current flow creates merchant-owned Whop child per store; no legacy merchant API-key/business-ID paste. Guard via existing fee service; incomplete upstream verification returns honest blocked reason.
GET /billing -> {plan,planStatus,plans:[{code,name,amountMinor,checkoutUrl}],features:object}. Exact seller link format https://pay.mulchcheckout.com/?plan=standard|premium.
Errors {error,message,details?};401 unauthenticated,402 subscription_required,403 csrf_invalid/premium_required,404 foreign store/resource,409 optimistic version/operation_not_ready,503 missing configuration. Sanitize SQL/provider secrets. No browser plan/status override, provider token or fee BACKEND_SERVICE_TOKEN.
