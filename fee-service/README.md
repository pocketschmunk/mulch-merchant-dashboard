# Mulch merchant per-sale fees — source release 1

This is a portable backend component for Render, not a live payment service or a completed merchant dashboard. Whop requests are disabled by default. No live account was connected, no payment was charged, and no GitHub push, Render deployment or Manus hosting was performed for this release.

## Commercial rules

Each store earns its tier from lifetime successfully captured Mulch customer-payment gross in USD, including customer tax before payment-processing deductions:

- **2.8%** below $50,000.
- **1.5%** from $50,000.
- **0.5%** from $250,000.

The entire successful threshold-crossing payment receives the lower rate. Rates never increase after refunds or quiet periods. Refunds are tracked separately and never subtract from lifetime gross. Fees are rounded half-up to the nearest cent with integer arithmetic. A $108 tax-inclusive payment produces $3.02, $1.62 or $0.54 at the three rates.

Your own seller subscriptions remain Standard $150/month/store and Premium $250/month/store. Their checkout does not add these merchant per-sale fees. Shopify remains the landing-page host; there is no Shop Pay/native checkout fallback.

## What this source implements

The protected server-to-server API registers verified store ownership, records current-policy consent and plan/store-review attestations, creates a Whop connected account per store, requests provider onboarding/payout-management links, and refreshes provider verification. It does not attach an independently created standalone Whop business or accept a merchant's business ID/API key as a shortcut. Provider verification alone does not establish Shopify ownership or Mulch plan access.

For supported one-time purchases, an initial Whop quote establishes the final customer total and tax. The service selects the cascading fee, requests a second quote with an exact fixed application_fee_amount, verifies that customer total/tax did not change, and consumes that quote in the payment. The application fee is a deduction from merchant proceeds, not an added customer checkout line.

After retrieving the provider payment, the service verifies store/account/quote/metadata identity and captured gross/tax. Verified captured revenue and refunds are recorded even when fee evidence is delayed. Actual collected application_fee lines are reconciled separately. A mismatched or capped fee creates a review hold, not an automatic top-up charge. Provider refresh cannot remove that hold.

The PostgreSQL ledger locks one unresolved payment slot per store. Other stores remain independent. Stable input hashes, command keys and an order-reference uniqueness guard prevent duplicate charges. Failed orders may retry with a new command key only after a proven no-charge/terminal failure. Refunds never make a paid order chargeable again.

## Important limits

**Only one-time confirmation-token purchases are issued in this release.** Buyer token collection and 3DS/authentication completion UI are not included. Native saved-method charges, PayPal flows, tapped-card Tip semantics, controlled renewal workers and automatic recurring renewals are not enabled. A fixed application fee on a native recurring variant does not dynamically update future renewal tiers. If merchants sell recurring products, that controlled renewal integration is required before activation.

This is not merchant login, a customer-facing dashboard, Shopify OAuth, subscription-entitlement verification, checkout interception or Shopify paid-order synchronization. An authenticated upstream backend must verify all ownership/entitlement/consent evidence and supply authoritative purchase prices and matching buyer location. Never expose BACKEND_SERVICE_TOKEN to a browser, Liquid template, public JS or merchant.

One unresolved payment serializes the whole store, including authentication, settlement, fee-review and unknown-response delays. This correctness-first limitation needs capacity/UX evaluation before production. USD only; unsupported currencies and payments whose rounded fee is zero fail closed. No refunds, disputes or fee reversals are issued. Refund amounts update on explicit reconciliation; automatic refund-event handling is not included.

## Installation and tests

Use Node 22 and pinned pnpm 11.25.0:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

Without TEST_DATABASE_URL, the PostgreSQL integration group is explicitly skipped. For the complete isolated suite on Ubuntu with PostgreSQL 16 binaries, use:

```sh
bash tools/test-postgres.sh
```

The runner creates a temporary test cluster on loopback port 55432, runs tests, then stops and deletes it. Do not use a production database for TEST_DATABASE_URL. The recorded release run passed 77 tests with zero failures/skips, including real PostgreSQL, mocked native requests and a real SDK-signed raw-body webhook fixture. See docs/TEST-RESULTS.txt. There were no external Whop sandbox or live payment calls.

## Render setup — not performed by this release

Keep the existing subscription checkout at pay.mulchcheckout.com intact. This new ZIP is **not** a replacement upload over that checkout repository. Add the extracted backend as a separate directory/service, or integrate it deliberately into the future Render application backend.

1. Create a private Render PostgreSQL database and arrange durable backups. Add a new Node/Docker Web Service for this source. Use this directory as its service root. The native build command is `corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile`; the start command is `pnpm start`. Dockerfile is also provided, but a container build was not run here.
2. Set runtime values from .env.example in Render's secret environment settings, not Git. Use Render's database connection URL for DATABASE_URL. Generate a strong BACKEND_SERVICE_TOKEN and a 32-byte encryption key, for example `openssl rand -hex 32` for each. PAYLOAD_ENCRYPTION_KEY must be exactly 64 hex characters and retained until all encrypted retries are resolved/expired.
3. Set PUBLIC_APP_ORIGIN to your real HTTPS application origin. The supplied app.mulchcheckout.com value is an example, not an already-configured domain. Route the onboarding/payment return paths to the application or this service; browser returns never verify success. The API honors Render's PORT. Health path is /healthz and reports liveness/configuration only, not verified live collection.
4. Review the target database and explicitly install the schema: `APPLY_FEE_SCHEMA=yes pnpm migrate`. Run this in the intended service environment where the correct secret DATABASE_URL is already configured; do not paste secrets into public instructions/logs. Schema installation is not an application-start side effect. This version-1 schema is for a new fee database, not a migration of an existing merchant-payment ledger.
5. Leave WHOP_ENVIRONMENT=disabled and all four activation flags false. Set up an isolated Whop platform sandbox and follow docs/ACTIVATION.md before any sandbox connection/payment work. Production credentials and the merchant account's normal subscription plan IDs are not interchangeable.
6. Connect the verified upstream merchant backend to the protected API. Arrange signed webhook delivery to /api/webhooks/whop with the exact ws_ secret and pinned native API version 2026-11-23-3. Use retrying reconciliation/retention operations with alerts; no scheduler or worker was configured by this task.

## Recovery and sensitive-payload retention

Prepared commands may resume the same command. A stale submitting lease may be reclaimed after 30 seconds using the same encrypted request and provider idempotency key, only inside five minutes of first submission. An unknown outcome is never released by a timeout. Once a provider payment ID is durably bound, its encrypted retry body is erased; later work retrieves that payment instead of recreating it.

After the replay window, reconciliation/retry erases the body and reports manual_reconciliation_required while retaining the ledger and store slot. The explicit maintenance command is `APPLY_PAYLOAD_RETENTION=yes pnpm expire-retry-payloads` with the reviewed DATABASE_URL. Integrate it at least once per minute in the deployment's maintenance worker before activation; this source does not schedule it. It processes up to 1,000 candidates per invocation. Body deletion is not proof of payment failure.

For an unknown command without an ID, use provider evidence and the attempt metadata/idempotency key to locate the original payment. A verified signed webhook can bind it; there is no public/manual API that accepts an arbitrary replacement payment ID. Beyond the replay window, never issue a fresh key, clear the slot or assume no charge. A genuinely missing payment requires a reviewed operator procedure with provider evidence. Review holds require documented operator resolution; do not clear them merely because account verification is active.

Read docs/API.md for the contract, docs/ACTIVATION.md for the remaining gates and docs/PROVIDER-SOURCES.md for the verified API notes.
