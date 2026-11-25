# Mulch source handoff — Shopify v8 and Render merchant v1

The Shopify Liquid landing and the portable Render merchant source now mirror the verified reference's section/navigation organization with original Mulch fintech branding. The headline remains “Your money, when you need it.” No deployment, GitHub push, live payment activation, DNS change, real email delivery, merchant connection or Manus hosting was performed.

## Which ZIP goes where

Upload `mulch-checkout-shopify-theme-v8.zip` as a Shopify theme ZIP. Its seven Shopify folders are at the archive root. It contains the branded landing, seller subscription purchase links and a blank-by-default merchant dashboard URL setting. Preview the theme in Shopify and set that URL only after your own merchant app is configured.

Extract `mulch-merchant-dashboard-render-v1.zip` into a **new repository** for a Render Web Service. Its package.json, lockfile and Dockerfile are at the archive root. Do not upload it to Shopify, and do not merge it into the existing `pay.mulchcheckout.com` seller checkout repository. The existing checkout and Apple Pay association file were not replaced. Render setup is in RENDER-SETUP.md; API shapes are in ../contracts/API.md; the full tier feature bullets are in FEATURES.md.

## Paid-only accounts and plans

The source implements Mulch-owned email/password signup, email verification, password reset, durable sessions and server-only paid entitlement checks. An authenticated but unpaid account sees only the purchase/payment-verification gate, not dashboard data, stores or configuration. There is no free workspace, public demo, development bypass or success-URL access grant.

Standard is **$150/month per store**. Premium is **$250/month per store**, with the same common configuration features plus recurring-subscription, portal/cancellation, recovery and subscription-reporting configuration. One verified paid membership binds once to one store. The server determines the plan from provider evidence; browser fields cannot choose permissions. Plan upgrades/downgrades refresh authoritative store metadata and discard stale Premium bootstrap state. After downgrade, ordinary checkout designs stay listable while recurring designs and their mutations remain protected.

Both plans share the approved tax-inclusive per-sale schedule: **2.8% below $50,000; 1.5% from $50,000; 0.5% from $250,000** in lifetime captured Mulch customer gross per store, before processor deductions. The whole crossing payment receives the lower rate and earned rates never rise. Whop processing fees are separate. There is no Shop Pay or native Shopify checkout fallback.

## Configuration before testing accounts

You must provide a separate PostgreSQL database, the exact HTTPS APP_ORIGIN, a verified Resend sender and server-side email API key. Install the schemas explicitly after checking the database target. The password hashing settings require suitable runtime memory and must not be weakened to fit a small service. Mail delivery is inline without a durable retry outbox; proxy-IP rate limits and cleanup maintenance need operational validation.

Paid verification needs a read-only key for **Mulch's seller account**, that account's ID, and controlled native Whop sandbox testing before production use. The merchant must buy with the same email as their verified Mulch account. Seller-plan verification is separate from merchant-customer payment activation. Missing or uncertain current paid evidence denies dashboard access without erasing store data/bindings. Leave merchant live-payment gates off.

## What is and is not finished

Finished source includes all navigation destinations, responsive light/dark shell, purchase gate, account screens, owned-store binding, safe/versioned resource forms and checkout block builder/sample preview. Standard/Premium permissions are enforced on the server. Orders display actual captured gross, refunds, paid timestamp and **verified fee ledger / Shopify sync unverified** labels, not invented Shopify fulfillment. Empty analytics and subscriber states are not fake customer traffic.

**Not ready as a complete live checkout replacement:** Shopify ownership/data ingestion and order/refund synchronization; actual merchant connected-account verification; customer checkout routing and domain/wallet proof; operational upsells/refunds and pixels/CAPI; automatic customer renewals, paid-renewal Shopify orders, delivery management, customer portal and recovery/dunning. These remain blocked or unverified where adapters are absent. The included fee service covers its documented one-time confirmation-token path, not a complete recurring/refund engine. See READINESS.md before advertising target features as operational.

## Saved validation evidence

The initial assembled isolated run passed **77 fee tests, 96 server tests and 77 client tests**, with no failures/skips; syntax checks and the frontend build passed. An additional **1/1 full-flow loopback HTTP test** used the real auth and paid-verifier code with mocked email/provider responses. It verified that email proof alone remains unpaid, paid evidence unlocks one store, Standard cannot access Premium, live operations remain blocked, and logout denies access.

After the concrete review fixes, the affected PostgreSQL backend suite passed **55 tests**, and the updated client suite passed **80 tests** with no failures/skips. Frontend typecheck/production build and server/fee syntax checks were rerun. These are overlapping suite runs, not additional unique test totals. The saved logs are ASSEMBLED-TEST-RESULTS.txt, FULL-FLOW-TEST-RESULTS.txt, SERVER-REGRESSION-RESULTS.txt, CLIENT-REGRESSION-RESULTS.txt and FINAL-SYNTAX-RESULTS.txt.

Shopify v8 passed **52 tests**, parsed **26 Liquid files** and received **zero official Theme Check findings**. Temporary test databases/listeners were stopped and cleaned up. Tests did not use real provider credentials, send real emails or charge anyone. Archive hashes and sizes are recorded in the external RELEASE-MANIFEST.json.
