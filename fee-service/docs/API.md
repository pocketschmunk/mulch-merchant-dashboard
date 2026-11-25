# Backend API contract

All endpoints use JSON. Money inputs are exact integer-cent **strings**, never floats. Responses deliberately exclude tokens, encrypted bodies, login emails and credentials. No permissive CORS is enabled: this API is backend-to-backend, not a public merchant login.

Private requests require `Authorization: Bearer <BACKEND_SERVICE_TOKEN>` over HTTPS. The upstream application must authenticate the merchant, check store ownership, resolve real Mulch subscription entitlement and verify Shopify/store review before it calls these endpoints. The shared service token grants backend-wide access; it is not a merchant-scoped token and must never be sent to a browser. Rate limiting/abuse protection belong in the deployment/upstream application.

## Public endpoints

`GET /healthz` reports liveness, providerMode and productionConfigurationReady. Configuration flags are not proof of working payments, tax or actual fee collection. This is not database readiness.

`GET /api/fee-policy` returns the policy version, exact 280/150/50 basis-point tiers, tax-inclusive basis, whole-crossing-payment and never-increase rules, and unchanged $150/$250 monthly plans.

`GET /payments/return`, `/payments/refresh` and `/checkout/return` return verified:false. The upstream dashboard must refresh verified provider state. Query parameters such as success=true never grant account verification, payment success or plan access.

## Store registration and onboarding

`POST /api/stores` accepts exactly:

```json
{
  "id": "StoreExample",
  "merchant_id": "MerchantExample",
  "shop_domain": "example.myshopify.com",
  "login_email": "merchant@example.test",
  "country": "US"
}
```

These are fixtures, not real account values. Country is the verified merchant country. ID/merchant/domain/email/country cannot silently change after registration. Shopify domains are unique and remain bound to the original lifetime ledger.

`POST /api/stores/{storeId}/readiness` records verified **upstream attestations**, not client claims:

```json
{
  "access_verified": true,
  "shopify_verified": true,
  "store_review_approved": true,
  "consent_reference": "consent:merchant:fee-schedule-v1",
  "consent_policy_version": "mulch-2026-11-24-280-150-50",
  "product_id": "prod_Example"
}
```

Store the underlying current-policy consent and verified ownership/access evidence in the upstream application. The product must actually belong to this connected account and have the correct tax classification. The fee service does not create/configure that product or validate a Shopify access token. Readiness cannot change during an unresolved payment; provider status and fee-review holds are separate controls.

`POST /api/stores/{storeId}/connect-payments` with `{}` creates the store's connected Whop account if absent and returns a provider-hosted onboarding link. Shopify ownership must already be verified. No caller-supplied account ID is accepted. A independently created standalone account is not attached.

`POST /api/stores/{storeId}/refresh-payments` with `{}` retrieves verified provider account state. It checks the bound parent, active account/card capability and all present verification profiles. readyForPayments also requires upstream readiness/current consent and no fee review hold.

`POST /api/stores/{storeId}/manage-payouts` with `{}` returns the provider's payout-management link for the same account. It does not change payout settings itself.

`GET /api/stores/{storeId}/fees` returns lifetimeGrossMinor, earnedBasisPoints, unresolvedAttemptId, reviewRequired, expected_fee_minor, collected_fee_minor and refunded_minor. Expected/collected fees include verified captured payments even while fee reconciliation is pending. Refunded gross does not reduce lifetime gross.

## Supported one-time payment command

`POST /api/stores/{storeId}/charges` requires a stable `Idempotency-Key` header, 8–200 letters/digits/underscores/hyphens, and:

```json
{
  "order_reference": "order:Example1",
  "subtotal_minor": "10000",
  "confirmation_token": "ctok_Example",
  "billing_address": {
    "country": "US",
    "state": "CA",
    "postal_code": "94105"
  }
}
```

The upstream backend must price the genuine purchase and obtain the buyer's token through an approved Whop client flow. For digital goods the supplied quote address must match the token's own billing location. For physical goods add the actual shipping_address, which is included unchanged in quote and payment. Do not invent a shipping address to work around tax-location matching. Supported address fields are country/state/postal_code/city/line1/line2/name.

The service calculates authoritative tax from provider quotes; it does not accept an account override, fee amount/rate override, client tax total, variant override or caller-selected lifetime tier. billing_address is used for quoting only; the native card-token payment gets its own token billing location. apply_surcharge is omitted because it is incompatible with quote_id and defaults false. Absence of extra buyer fees must be separately proven in sandbox before activation.

Saved member/payment-method purchases are explicitly rejected with unsupported_saved_method. This release is not a dynamic recurring-renewal engine. The seller's $150/$250 subscription checkout is a different codebase and must not call this endpoint to add merchant fees to those subscriptions.

Same key plus equivalent canonical input returns/reconciles the original attempt. Same key with changed input returns 409 idempotency_conflict. A new key for an already-paid/unresolved order returns 409 duplicate_order. Another unresolved purchase on that store returns 409 store_busy. A proven failed order may retry with a new key. Payment creation/HTTP 200 does not by itself mean capture, fee collection, fulfilled order or subscription access.

Returned attempts contain IDs, order_reference, status, quote_id/payment_id, expected gross/tax/fee cents, actual fee cents, basis points, refunds, issue and counted_at. counted_at means provider-verified captured gross was recorded; status succeeded additionally means expected application-fee collection reconciled. pending can therefore have counted_at while the store remains serialized. review is an incident requiring operator review. failed means proven no-charge/terminal nonpayment. unknown means preserve the original command and do not replace it.

## Reconciliation and webhooks

`POST /api/attempts/{attemptUUID}/reconcile` with `{}` retrieves the original known provider payment and fee evidence; it never creates a payment. With no ID, it only preserves the unknown state/slot and expires unusable retry bodies when appropriate. signed webhook recovery may bind the originally submitted attempt by its provider metadata and account; unsubmitted quoting/prepared attempts cannot be bound by an early event.

`POST /api/webhooks/whop` does not require the service bearer token. It requires a valid provider raw-body signature, exact configured ws_ secret and webhook-id/webhook-timestamp/webhook-signature headers. Pin event api_version_date to 2026-11-23-3. Verification happens before ledger handling. The handler accepts payment.succeeded/payment.failed and retrieves provider truth rather than trusting event amounts/status. Duplicate event IDs are idempotent; conflicting account/payment/type reuse fails. Pending reconciliation returns 503 for retry. Other event types are ignored; refund-event automation is not provided.

Bodies above 64 KiB, unknown fields, malformed JSON and unsupported currencies/methods fail closed. Errors are sanitized; they do not reveal raw provider customer details. Do not interpret a server error as proof that a payment failed. See ../README.md for the bounded same-command replay and manual recovery procedure.
