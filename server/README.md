# Mulch merchant server — source-only handoff

Node 22, PostgreSQL, `pg@8.23.1`, and the workspace package `@mulch/merchant-fees`. This is portable Render source, not a hosted service or a completed live checkout/renewal system. No provider requests, account connections, charges, browser sessions, Git operations, Manus Preview, deployment or resident application service were performed for this work.

## Integration and ownership

`src/app.js` exports `createApp({ pool, env, auth, entitlements })`, returning an unstarted Node HTTP Server. The parent startup module creates the real pool, auth and entitlement services and calls `listen`; importing the API never starts a server, migrates a database or creates an account.

The authentication implementation, passwords, mail, entitlement verifier and startup are separately owned: `src/auth.js`, `passwords.js`, `mail.js`, `entitlements.js`, `start.js`; `migrations/000_auth.sql` and `001_entitlements.sql`; and their tests. This work did not modify them. Auth must supply `{mode:'email', configured, handle(req,res,url,body), session(req), verifyCsrf(req,session)}`. Entitlements must supply `{configured, access(user), refresh(user)}`. No environment-based development identity, paid-access override or public demo API exists. Synthetic identities/entitlements occur only through explicit dependency injection in tests.

Package dependencies are ready and match the parent-installed workspace. `package.json` runs tests serially using `node --test --test-concurrency=1 tests/*.test.mjs` to avoid cross-file migration/fixture contention.

## Implemented API boundary

Public configuration, session and known public email auth endpoints remain reachable without a paid membership. Signed-in unpaid accounts can read `/api/access` and POST an empty `/api/access/refresh`; refresh requires the exact `APP_ORIGIN` and session CSRF token. All dashboard/store/configuration routes first call `entitlements.access(user)` and require `hasAccess === true`, otherwise `402 subscription_required`. Store lookups separately join the owned, bound entitlement with `active=true`, `status='active'`, future `paid_until` and future `verification_expires_at`. Foreign or expired stores are `404` and their data remains durable.

Store creation accepts only `name`, `shopDomain`, `country`, `entitlementId`. A transaction locks the owned entitlement, checks its current proof/paid period after the lock, creates a UUID store and conditionally binds the one previously unassigned membership. An already-bound membership is `409`; no browser plan, verification, account or status value is accepted. Store plan always comes from the entitlement. Operator notes, including billing notes, cannot grant or upgrade service access.

Every private mutation checks the exact origin and auth-owned CSRF validator. Errors sanitize SQL, stack traces and provider secrets. APIs have private/no-store responses and no permissive CORS.

## Durable configuration and feature permissions

`src/validation.js` implements the exact fields in `../contracts/API.md` for all 14 resource kinds. Titles are plain text. Configurations have bounded arrays/strings, exact USD minor-unit strings where specified, restricted enums and unknown-field rejection. Shopify Product GIDs are draft references, not proof or arbitrary checkout destinations. Native Shopify/Shop Pay fallback routes and legacy API-key/business-ID onboarding are not accepted.

Checkout designs retain visible contact/delivery/shipping/payment blocks. Custom HTML supports a small balanced formatting-only language without attributes, scripts, CSS, embedded resources or links; normalization is idempotent. Images accept restricted HTTPS raster URLs. Experiment variants must reference two owned Mulch checkout designs; referenced designs cannot be deleted until their experiment is removed or updated.

Resource saves are durable PostgreSQL inserts/updates and always remain `draft`. Updates require the current positive integer `version`; concurrent stale updates return `409 version_conflict`. Tenant-scoped IDs prevent another paid account reading/writing/deleting resources. Customer subscription rules, portal, recovery, cancel flow, subscriber reads, recovery reads and nested subscription-choice blocks require Premium on the server. Standard bootstrap omits recurring configuration, including previously Premium checkout designs after a downgrade. No activation endpoint writes a fake active state: activation returns `409 operation_not_ready` until a real, verified external runtime exists.

## Operational screens and truthful readiness

Store bootstrap, analytics, orders, abandoned checkouts, subscribers, recovery, fees, setup check, billing and the AI & MCP settings destination are implemented. New paid stores have zero/empty operational data, never example accounts or fabricated live results. Analytics use existing provider-verified captured fee-ledger records when present, with UTC dated series; revenue is captured tax-inclusive gross and refunds are shown separately. Fee-ledger order facts are marked `source:'verified-fee-ledger'` and `shopifyFulfillmentVerified:false`; they are not claimed as synchronized Shopify fulfillment orders. Sessions/carts/checkouts, recurring metrics and renewal forecasts remain zero/empty because their event/runtime integrations are not implemented. Conversion is `null`, not an invented percentage. Forecasts never represent spendable bank balance.

`src/fees.js` reuses the tested fee-service policy and repository directly, without exposing a backend bearer token or provider credentials. The source of truth remains the fee ledger: tax-inclusive 280/150/50 basis points, whole crossing payment gets the lower rate, refunds do not reduce lifetime volume, earned rates never increase. Seller links remain exactly `https://pay.mulchcheckout.com/?plan=standard` and `?plan=premium`, at $150/$250 monthly per store; seller variant IDs are left to the parent verifier and are unchanged.

**Payment onboarding intentionally remains blocked.** The adapter retains the existing fee provider's sandbox/production activation guard. It does not construct a vault or require an encryption key to boot the configuration UI with Whop disabled. No invented Shopify OAuth URL, provider request, merchant-owned account, payout link, country verification or store-review success is returned. Existing fee `access_verified`/Shopify/review booleans and operator annotations do not unlock this source. Real upstream Shopify ownership, verified merchant country and review adapters must exist before safely wiring `FeeService.connect`/`refresh`/payout links for merchant-owned per-store accounts. No browser flags can replace those adapters.

Shopify ownership is unconnected; review is pending; payments are unconnected. Fee consent is independently and durably recorded but never changes connection status. Setup checks explain these blocks. AI & MCP is expressly unverified: there is no defined AI capability, live MCP connection, credential flow or AI entitlement.

## Static application serving

The same server serves `../client/dist`, or the server-only `CLIENT_DIST` override, with safe SPA routing. Missing assets/APIs do not fall back to application HTML. Missing client build returns a clear `503 client_not_built`. Paths cannot escape the static root, and unsupported file types/dotfiles/symlink escapes are refused. Standalone Render responses deny framing (`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`) because Manus Preview was explicitly declined. CSP uses same-origin scripts/connections, no embedded checkout frames, no objects and a restricted form origin. HSTS is set for HTTPS `APP_ORIGIN`; sessions remain auth-owned.

## Schema installation

Apply explicitly, using the parent migration runner: auth 000 → parent entitlements 001 → fee ledger 001 → app 002. HTTP startup never installs schemas. `002_app.sql` creates stores, resources, consents, reserved operator-note/product tables and an audit log, then adds the nullable entitlement-to-store foreign key. App stores are UUIDs; fee-service store IDs are the same UUID represented as text only once genuinely verified upstream registration exists. No arbitrary user-supplied provider identity is forwarded.

## Test evidence

On November 24, 2026, the owned suite passed **55 tests, 0 failures, 0 skips**, including real PostgreSQL 16 transactions and finite loopback HTTP listeners. Commands:

```sh
node tools/check.mjs
bash tools/test-postgres.sh
```

The server-only runner initializes a fresh temporary loopback PostgreSQL cluster, creates `mulch_server_test`, runs only this work's API/validation/PostgreSQL tests, and always stops/removes the cluster with a shell trap. It does not use `DATABASE_URL` or an existing database. The tests refuse any supplied `TEST_DATABASE_URL` unless the database name matches `mulch_*_test` or the parent explicitly sets `TEST_ALLOW_ISOLATED_DATABASE=yes`. Fixture cleanup deletes only randomly allocated fixture users and their records, never truncates tables. Test-only authentication and entitlements are dependency-injected, not a production bypass.

Coverage includes unauthenticated/unpaid denial, session/purchase-gate reachability, exact-origin CSRF, sanitized errors, concurrent one-membership binding, expired/inactive/past-due/unpaid denial, tenant `404`, persistent CRUD across app instances, optimistic concurrent update conflicts, all strict schemas, Premium reads/writes and downgrade filtering, required design blocks, safe formatting HTML, owned experiment references, permanent non-activation, current consent, blocked providers/legacy keys, exact fee-policy reuse, zero/empty operational states and existing fee-ledger facts. Parent-owned auth/entitlement suites are outside this owned-suite count; the parent full isolated runner should execute them with the assembled client.

## Remaining source limitations

Verified Shopify OAuth/ownership, authoritative Shopify product ingestion, custom-domain DNS/SSL, checkout publishing/interception, customer token/authentication UX, paid-order/refund synchronization, experiment runtime/events, pixel delivery, verified store review, controlled customer renewals, subscriber/portal/recovery runtime and AI & MCP implementation remain blocked/open. Environment or configuration flags are not runtime proof or owner activation approval. Do not sell this source as full production parity or enable payments until those integrations and the fee-service activation evidence are actually complete.
