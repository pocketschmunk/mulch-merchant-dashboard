# Render setup — source package, not a deployment

This ZIP is for a **new merchant application**, not an overwrite of the existing seller checkout repository. Shopify remains the public landing host; pay.mulchcheckout.com remains the existing Mulch-branded Whop seller checkout. The new app can use an owner-chosen Render hostname, then a custom subdomain such as app.mulchcheckout.com. Nothing in this task is published or hosted by Manus.

## The paid account flow

A merchant creates a Mulch email/password account, verifies their mailbox and signs in. If they have no verified active paid subscription, the app shows only the purchase/verification page. There is no free dashboard or public example workspace. They purchase Standard $150 or Premium $250 monthly per store through the existing seller checkout using the **same email address** as their verified Mulch account, then click Check payment. Browser return URLs never unlock the dashboard. The server verifies current Whop Member, Membership and captured-payment evidence before granting access.

Each purchased membership can be assigned to exactly one store. A second store needs a second membership. Plan changes are derived from provider membership evidence, not a browser selection or success query. Scheduled cancellation retains access only through the verified paid period. Trialing, past_due, canceled, expired, completed/one-time, free or unverified grants do not unlock the dashboard. The current verifier intentionally denies any refunded current-period payment; proration/refund handling needs a separately approved policy.

## Repository and service

1. Extract the merchant-app ZIP into a **new repository** root. Do not mix its files into the live seller checkout repo or upload this ZIP as a Shopify theme.
2. In Render create a Web Service from that repository. Choose Docker and the root Dockerfile. Select resources suitable for Node authentication and your traffic. The image installs pinned dependencies and builds the frontend; it does not migrate a database or call providers during build.
3. Create a separate Render PostgreSQL database for this app and set its internal connection string as DATABASE_URL. Do not use the seller checkout database or an unrelated store database.
4. Set APP_ORIGIN to the actual HTTPS app origin. Set PUBLIC_APP_ORIGIN to the same value for the fee component. PORT is supplied by Render; the server defaults to 3000 and must honor Render's value. Never use a request Host header as the email-link origin.
5. Before starting account traffic, install the schemas explicitly from the repository: `APPLY_MULCH_SCHEMA=yes pnpm migrate`. Review the database target first. Migrations create auth, entitlement, fee and app tables. Startup never silently runs migrations against an arbitrary database.
6. Set up the email and paid-verification variables below. Restart the service through Render when configuration is ready. Missing configuration keeps login/payment verification explicitly blocked, not a fake logged-in dashboard.
7. Confirm the health endpoint and account flow in your controlled test environment, then configure the Shopify theme's merchant-dashboard URL. No theme default points to a claimed-live app.

For a native Node service instead of Docker, use Node 22.23 or later and pinned pnpm11.25. Build with `corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile && pnpm build`; start with `pnpm start`. Keep all four workspace folders and the root lockfile together.

## Transactional email

Create an account with Resend and verify the sending domain through the DNS records it supplies. In Namecheap add those exact records without changing the working Shopify/checkout DNS records. Set server-only RESEND_API_KEY and AUTH_EMAIL_FROM, for example a verified accounts@ address. APP_ORIGIN must be the real HTTPS origin so verification/reset links land on your app. Mail delivery is not configured or exercised against real recipients in this source task.

Verification and password-reset links are expiring and single-use. Passwords are salted memory-hard hashes, never plaintext. Secure HttpOnly sessions and CSRF/origin checks protect mutations. Password reset revokes sessions and does not automatically log a merchant in. Transactional email configuration does not grant paid plan access.

## Whop seller-plan verification

Create a **read-only account API key for Mulch's seller account** with member:basic:read, member:email:read and payment:basic:read. Do not expose it in Shopify Liquid, Vite/browser variables or JavaScript bundles. Set MULCH_BILLING_ACCOUNT_ID to your Mulch seller account's biz_ ID and MULCH_BILLING_API_KEY to that server-side key. These are not merchants' payment-account keys.

Start with MULCH_BILLING_ENVIRONMENT=sandbox and separate sandbox account/plan IDs in MULCH_SANDBOX_STANDARD_PLAN_ID and MULCH_SANDBOX_PREMIUM_PLAN_ID. Sandbox IDs cannot match the production account environment. Set BILLING_VERIFICATION_ENABLED=yes only for the environment whose key/account/plans you have verified. The production plan mapping is pinned to the existing approved public IDs: Standard plan_GcWXKubnKvKib; Premium plan_HchAp18dt8rm5.

The verifier makes only GET requests to Whop, pins native API versions and compares exact identity, account, variant, membership and current paid-period payment. It uses a maximum 60-second durable proof lease, then rechecks. Missing or uncertain provider evidence locks access while retaining data and store bindings. Sandbox/native provider behavior and these scopes still need an actual account test before public launch; this task tests mocked provider responses only.

## Merchant-customer payments are not enabled by this setup

BILLING_VERIFICATION_ENABLED controls read-only access checks for your seller subscriptions. It is not permission to take a merchant's customer payment. Leave WHOP_ENVIRONMENT=disabled and all four live-payment gates false. The included fee component supports isolated one-time confirmation-token payment orchestration, not completed customer recurring renewals, refunds, portal, pixels or automatic Shopify order ingestion. See READINESS.md and fee-service/docs/ACTIVATION.md for the remaining integrations and separate activation requirements.

Do not set production fee gates true based on a theme upload, successful seller subscription or source test log. No live payments, account connections, Render deployment, GitHub push or Manus hosting were performed for this package.

## Account-system operations

Provision enough memory for two concurrent memory-hard password hashes plus Node/database connection overhead; the fixed hashing settings must not be weakened to fit a small service. Expired sessions/tokens and old rate buckets need periodic maintenance in your chosen external environment. No recurring cleanup automation was configured by this source task.

Auth rate limits use the direct transport IP and deliberately ignore spoofable forwarding headers. Render proxy IPs may group several clients and impose conservative shared limits; validate this behavior before public launch rather than trusting arbitrary X-Forwarded-For. Signup/recovery responses are generic and padded to a minimum 1–1.2 seconds, but slow provider delivery can still leak timing. Emails are sent inline with bounded timeouts; this version has no durable mail retry/outbox. Generic responses mask transient delivery errors, so sender deliverability and resend/reset behavior need monitored real-provider testing.
