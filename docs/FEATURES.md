# Mulch Checkout — Crisp-based structure and subscription tiers

CrispCheckout's current public pricing says Pro adds subscriptions and that everything else is identical between its two paid plans. The equivalent Mulch structure is therefore **Standard for one-time checkout operations; Premium for everything in Standard plus recurring-subscription operations**. Mulch keeps its owner-selected $150/$250 monthly prices and 2.8%→1.5%→0.5% lifetime-volume fees. The bullet lists below define the intended full product entitlements. The source implements paid access, the merchant UI and configuration workflows, but not all provider-backed live engines; see the implementation status below before treating any target feature as operational. [1]

*Reference checked November 24, 2026. Prepared by Manus AI. Owner confirmed both the merchant dashboard and landing page, selected Mulch email/password sign-in, and requires payment before any dashboard access.*

## Standard — $150/month per store

The intended common/core feature set is:

- Branded merchant checkout using a merchant-owned connected Whop account.
- One-time customer purchases.
- No-code drag-and-drop checkout builder with live preview and branding controls.
- Checkout blocks such as testimonials, ratings, trust badges, guarantees, timers, FAQs, images and supported custom HTML.
- Checkout order bumps and one-click post-purchase upsells.
- Discount codes, quantity offers and checkout add-ons.
- Custom checkout domain and SSL.
- Supported Whop payment methods, including Apple Pay/Google Pay where verified and available.
- Paid-order synchronization into Shopify Admin for fulfillment.
- Refund controls with payment-to-Shopify reconciliation.
- Revenue, order, average-order-value and store/checkout-conversion analytics.
- Checkout-layout A/B testing between Mulch designs, not native-Shopify traffic splitting.
- Thank-you page configuration, buy links and surveys.
- Shipping configuration and country/rate rules.
- Marketing/pixel integrations, including the advertised Meta CAPI, TikTok and Google Analytics tracking capabilities.
- Store selection, account/settings, plan billing, setup checks and help guides.

The public pricing card directly names live Whop payments, one-time purchases, bumps/upsells, custom domains, pixels and one-click refunds. The builder and other shared modules are shown elsewhere on the site and in the authorized dashboard review. The additional module allocation above follows the explicit statement that subscriptions are the paid-plan difference; it is an intended Mulch entitlement mapping, not a separate audit of every Crisp backend permission. [1] [2]

**Not included in Standard:** customer recurring subscriptions, Subscribe & Save, trials, subscriber portal/cancellation flows, renewal recovery and subscription-specific MRR reporting. A merchant paying Mulch monthly does not automatically mean that merchant can sell customer subscriptions on Standard.

## Premium — $250/month per store

Premium includes **everything in Standard**, plus:

- Customer recurring subscriptions and automatic renewal workflows.
- Subscribe & Save offers on product pages and inside checkout.
- Per-product subscription discounts and one-time-versus-subscription purchase choices.
- Free trials with clear conversion into paid billing.
- Configurable subscription/delivery schedules for supported physical and digital products.
- A Shopify fulfillment order for each successfully paid renewal.
- Subscriber management and recurring-customer status reporting.
- Branded customer self-service portal for delivery changes, pausing, payment-method updates and cancellation.
- Cancellation-flow configuration and retention experiments.
- Failed-renewal recovery/dunning workflows and customer communications.
- MRR, paying-subscriber, churn and renewal-performance reporting.
- Upcoming renewal calendar and scheduled-revenue forecasts, clearly distinguished from collected money and spendable provider balance.

The public Premium-equivalent Pro card explicitly lists subscriptions, Subscribe & Save, trials, portal/cancel flow, payment recovery and MRR analytics. Delivery/product controls, subscriber management and forecast detail were observed in the authorized dashboard review. Provider constraints, consent and supported payment methods must be validated during implementation. [1] [2]

## Fee schedule shared by both plans

The monthly plan does not choose the per-sale rate. Each store earns its rate from its own lifetime captured Mulch customer-payment gross in USD:

- 2.8% below $50,000.
- 1.5% from $50,000.
- 0.5% from $250,000.

Both thresholds and fee basis include customer tax before processor deductions. The entire crossing payment receives the lower rate, which never increases afterward. Whop processing charges are separate. No other software fee or invoice fallback is approved here. These are the owner's Mulch terms; they are not Crisp's advertised 1%/0.75%/0.5% software rates. Crisp currently advertises $99 Standard and $199 Pro, so Mulch's $150/$250 plans must not be advertised as 10% cheaper than those prices. [1]

## Merchant application navigation

To mirror the visible functional organization, use the reference's actual navigation rather than inventing a different grouping. The authorized review recorded: [2]

- **Home:** operational overview, revenue/orders, conversion funnel, recent activity, connection status and needs attention. Premium additionally displays subscription/MRR information.
- **Analytics:** Overview, Orders and Abandoned checkouts. Subscription-specific metrics and forecasts are Premium-only.
- **Subscriptions:** Setup, Portal, Payment recovery and Subscribers. Standard may see the navigation as a clearly locked upgrade destination, not a working recurring feature.
- **Checkout:** Design, Thank-you page, Upsells & discounts, Buy links, Surveys and Tests. Do not add the competitor's native-checkout Traffic split module.
- **Settings:** General, Store & Shopify, Payments, Shipping, Integrations, AI & MCP, Plan & billing, Stores and Setup check. AI & MCP is an observed settings destination, not a verified promise of any particular AI feature; its implementation/entitlement needs a separate definition.
- **Recommended tools:** curated links, without copying competitor referral IDs or endorsements.
- **Help & guides:** searchable operational documentation and contextual guides.

Retain the store selector, current-plan badge, earned fee-tier badge, connection/readiness states and optional light/dark mode. Use original Mulch branding, components and wording; do not copy competitor code, testimonials, customer data or assets.

There is no free dashboard plan or public demo workspace. An unpaid Mulch account may verify/reset its email, sign in, purchase a plan and request server-side payment verification, but cannot access dashboard data or configuration. One verified paid membership supports one store. Standard and Premium differ only in included features.

## Current connected-account onboarding

The current documented sequence is Shopify ownership connection, merchant verification country, Connect payments, new merchant-owned Whop account per store, Whop identity/business/bank verification, return to the app, pending review with Refresh/Continue verification, and Payments connected only after verified provider state. Taking live payments also requires an active plan and store review. Manage payouts opens the provider portal. Existing Whop users can retain their login, but cannot paste an unrelated standalone business ID as the current connected-account shortcut. The reviewed research account's older API-key form is legacy, not the model for new Mulch merchants. [3]

## Landing page structure

Crisp's public page sequence is hero, payout-problem explanation, three-step handoff, setup walkthrough, traffic split, dashboard preview, subscriptions, business suitability, features, comparison, pricing, FAQ, final call to action and footer. [1]

Mulch can follow that order while retaining “Your money, when you need it,” the approved fintech styling and the cash-flow/MRR positioning. The native traffic-split section must be removed or replaced by an explanation of exclusive Mulch routing. Preserve the existing Shopify-hosted landing and Render-hosted application/checkout separation.

## Exceptions and current implementation status

“Exact” functional parity cannot include native Shopify checkout fallback or Shop Pay without changing the owner's explicit restriction. This release excludes them. Checkout design A/B draft configuration is restricted to Mulch layouts, with live experiment activation blocked until its runtime is implemented.

The v8 Shopify Liquid theme and Render-targeted merchant source now follow the verified landing/navigation organization using original Mulch branding. The merchant source includes email/password signup, verification/reset, durable sessions and rate limits, a read-only Whop seller-subscription verifier, paid-only global access, tenant/store binding and server-enforced Standard/Premium gates. Authentication or a checkout success URL alone cannot unlock any dashboard/configuration API. Real email delivery and native seller-account access verification still need owner configuration and controlled provider tests.

Source-backed configuration includes checkout block drag/drop, safe supported HTML, sample preview, saved/versioned designs, thank-you pages, offers/discounts, buy links, surveys, shipping, integrations and Mulch-layout experiment drafts. Premium adds subscription-rule, portal/cancellation and recovery configuration. Standard retains compatible designs after downgrade while recurring designs remain protected. Available order/analytics facts come from the verified fee ledger, not a fabricated Shopify synchronization or fulfillment state.

**Still unfinished:** Shopify ownership authorization and data ingestion; verified merchant connected-account onboarding; operational customer checkout routing and domain/wallet validation; live upsells/refunds and Shopify order/refund synchronization; pixels/CAPI and event ingestion; automatic customer renewals, paid-renewal Shopify orders, delivery management, customer portal and recovery/dunning engines. The included merchant fee component covers its documented one-time confirmation-token path, not those complete recurring/refund systems. These are open target features, not production-ready capabilities merely because their screen or draft exists. The new package's READINESS.md records the limits.

Payments stay subject to Whop's terms, verification, payment-method availability, payout timing, holds and reserves. Do not copy claims promising immunity from all freezes, guaranteed bank availability or a specific setup time. [1]

This release delivers new source ZIPs only. Prior delivered theme/checkout/fee archives and the existing Apple Pay association file are preserved. No live account, billing setting, deployment, GitHub repository, DNS, hosting configuration or payment activation was changed. No Manus hosting or public Preview was used.

## References

[1]: https://www.crispcheckout.com/ "Current public Standard/Pro feature split, product sections and provider caveats"
[2]: https://www.crispcheckout.com/dashboard "Authorized dashboard review of navigation and visible feature modules"
[3]: https://www.crispcheckout.com/dashboard/help/connect-payments-verify-whop "Current merchant connected-account onboarding guide reviewed in the authorized session"
