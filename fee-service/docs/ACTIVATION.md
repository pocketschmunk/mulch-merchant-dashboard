# Live activation remains blocked

This release is source-only. Checking environment flags is not validation or owner approval. No real provider sandbox payment, production account connection, charge, database migration or deployment was performed.

## Before isolated sandbox testing

Obtain the owner's Whop platform/parent-account setup and separate sandbox credentials. Confirm permission to create connected accounts, dedicated products/variants, native payment quotes/payments and payment fee retrieval. Do not use a researched Crisp account or merchants' standalone business API keys. Use an isolated test database and fictitious buyer/merchant data with provider-supported test methods.

Finish the upstream authenticated merchant application: verified Shopify ownership/OAuth, trusted store review, genuine $150/$250 subscription entitlement, consent for this policy, authoritative checkout prices/tax classifications, token collection and buyer authentication handling. Wire verified paid orders back to Shopify idempotently before presenting the product as a working checkout service. Browser returns are not proof of anything paid or verified.

## Required sandbox evidence

- [ ] Connected onboarding creates the correct merchant-owned child account for each store, preserves the parent binding and requires provider identity/payment-capability verification. Standalone accounts cannot bypass it.
- [ ] Dedicated product/tax settings reflect actual merchant goods and merchant-of-record requirements; customer tax/location is not assumed from a sample US address.
- [ ] Both quotes price the same customer total/tax with application_fee_amount, and quote consumption uses the token's matching billing location or actual shipping address.
- [ ] Untaxed purchases, exclusive/inclusive tax, physical/digital locations and supported buyer authentication/settlement work correctly. Unavailable/preview/expired quotes cannot charge.
- [ ] No extra buyer fees or surcharges alter amount_charged after the final quote. Resolve account-level settings rather than relying on the quote to establish this.
- [ ] Actual collected application_fee lines match the expected tax-inclusive amount; processing fees are separate. Verify capping/minimums/remaining-proceeds behavior, including small payments. This service never automatically tops up an under-collected fee.
- [ ] Exact $50k/$250k boundaries and whole crossing payments earn the lower 1.5%/0.5% rate and preserve it through refunds. Duplicate orders, concurrent commands and lost responses cannot charge/count twice.
- [ ] Provider idempotency really supports exact-body/key replay inside the selected five-minute window, including quote consumption. Validate the 30-second stale lease/recovery. Beyond that window, preserve locks and use provider evidence; never replace a possibly accepted payment.
- [ ] Signed raw-body webhooks use the exact ws_ secret and pinned API version, are retried while reconciliation is pending and recover a payment whose creation response was lost.
- [ ] Customer authentication UX, one-unresolved-payment-per-store throughput, alerting and failure/review paths are suitable for the merchant's actual traffic.

## Required deployment and operating controls

- [ ] Use Render plus durable PostgreSQL/backups. Existing seller checkout/Apple Pay association remains untouched. This source ZIP is not a drop-in replacement for the static checkout service.
- [ ] Keep the backend service/encryption/provider/signature credentials secret; secure the upstream merchant sessions and tenant ownership checks. Add deployment-level abuse protection and rate limits.
- [ ] Install version-1 schema explicitly in a new fee database; review the target and run with APPLY_FEE_SCHEMA=yes. Do not test against production or blindly import an older payment ledger.
- [ ] Integrate retrying reconciliation, retained evidence, alerts for unknown/review states and an operator procedure that cannot clear unknown slots without provider proof.
- [ ] Integrate the explicit retry-payload retention command at least once per minute; it deletes unusable encrypted bodies while preserving the unresolved ledger/slot. No such maintenance worker or schedule was created here.
- [ ] Approve refunds, disputes and application-fee reversal/accounting policy. This service does not issue refunds or automatically process refund events.
- [ ] Route **all supported merchant payments** through this controlled service. Native automatic recurring variants with fixed fees are not dynamically tiered. Recurring merchants require a separately implemented/verified controlled renewal flow before they qualify for activation.
- [ ] Obtain a new explicit owner approval for the exact production activation/charges. The present coding instruction is not that approval.

Only after these gates are genuinely satisfied may the operator set WHOP_ENVIRONMENT=production and all four flags true: LIVE_PAYMENT_ACTIVATION_APPROVED, TAX_INCLUSIVE_SANDBOX_VERIFIED, ALL_MERCHANT_PAYMENTS_USE_FEE_SERVICE and BUYER_FEES_DISABLED_VERIFIED. Those flags merely unblock requests; they do not supply missing integrations or prove successful collection. Review holds remain until a documented operator resolution.
