# Implementation readiness

The release reproduces the reference's functional navigation and intended Standard/Premium allocation with original Mulch branding. It is a portable source build, **not proof of a live replacement checkout platform**. Only paid verified accounts can access the dashboard. A screen, saved draft, provider status request or passing local test is not a completed live merchant integration.

## Source-backed account and configuration workflows

Mulch email/password account creation, verification, password reset, server sessions and payment-access gates are implemented as server code with isolated tests. Resend delivery requires the owner's verified sender and key. Paid access requires the owner's configured Whop read-only seller key and actual sandbox/native verification. Unpaid accounts have only the purchase/verification gate. Standard and Premium are paid plan entitlements; no free dashboard or public demo exists.

Durable owned-store configuration and resource drafts include checkout design/blocks/preview, thank-you page, offers/discounts, buy links, surveys, Mulch-layout experiments, general settings, shipping and integration identifiers. Premium adds subscription-rule, portal, cancellation and recovery configuration. Version conflicts, tenant authorization and server-side plan locks are part of the source. Draft preview uses clearly labeled sample cart/payment content and cannot charge a buyer. Live activation is deliberately separate and blocked where no actual runtime adapter exists.

Operational pages use available ledger facts or honest zero/empty states. They do not invent paid orders, sessions, abandoned carts, subscribers, MRR, provider balances or forecast collections. A future subscription forecast is not spendable cash. AI & MCP is an observed settings destination with no verified requested capability; this release does not pretend it runs a configured AI service.

## Provider/runtime work still required

Shopify ownership OAuth, product/order/customer ingestion, event/funnel collection and a verified external-checkout deployment path must be connected and tested for each client store. No native Shopify fallback, Shop Pay route or competitor native traffic split is permitted. Custom domain DNS/SSL and wallet validation need real domain/provider proof. Pixels/CAPI require a verified server/browser delivery implementation, not just saved identifiers.

The copied merchant fee component provides exact cents, tax-inclusive quotes, per-sale application-fee orchestration, tenant/attempt locking, reconciliation and signed webhook processing for its documented one-time confirmation-token path. Its upstream Shopify/plan/review attestations are not complete automatic verification implementations. All payment traffic must use the fee service and pass the documented provider tests before live collection is approved. Missing/mismatched fee evidence holds the store for review; no automatic top-up or invoice fallback is added.

One-click upsells, refunds with Shopify reconciliation, automatic recurring customer renewals and paid-renewal Shopify orders, subscription delivery management, customer portal, cancellation retention experiments and recovery/dunning communications are **target plan features, not a complete live engine in this package**. The UI/configuration structure is present; provider-backed behavior remains blocked until its real adapters, consent/security paths and sandbox outcomes are implemented and verified. A merchant's monthly Mulch seller subscription does not make customer subscriptions functional.

Source tests use isolated PostgreSQL, loopback HTTP and mocked native provider/email responses. They do not verify production Whop permissions, sender deliverability, Shopify compatibility/policy, store verification, tax handling across supported markets, payout timing or live renewal execution. Those open outcomes cannot be marked complete based only on source tests.

## Owner-controlled live activation

Live merchant fee collection still requires all four independent gates: LIVE_PAYMENT_ACTIVATION_APPROVED, TAX_INCLUSIVE_SANDBOX_VERIFIED, ALL_MERCHANT_PAYMENTS_USE_FEE_SERVICE and BUYER_FEES_DISABLED_VERIFIED. No gate was activated in this task. Nothing was deployed, hosted by Manus, pushed to GitHub, connected to a real merchant account or charged. The existing Shopify landing/seller checkout assets and prior ZIPs remain separate and unchanged until the owner chooses to replace them.
