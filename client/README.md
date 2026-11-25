# Mulch merchant client

Portable React 19.3.1, Vite 8.3.8 and TypeScript 7.0.2 source. Package: `@mulch/merchant-client`. The parent `merchant-app` workspace owns the pnpm 11.25.0 lockfile, dependency installation and reviewed `esbuild: true` lifecycle permission. No client-specific lockfile or hosted project is required.

## Local finite checks

After the parent workspace installation, run from this directory:

```sh
pnpm typecheck
pnpm test
pnpm build
```

These commands do not start a server, send transactional email, contact Whop or Shopify, perform payments or deploy. `dist/` is the production static output. The parent Render backend serves that output and the same-origin `/api` contract; direct page requests must use the backend’s SPA/static router. Configure the real `APP_ORIGIN`, database, email provider and read-only entitlement verifier on the server, never in client environment variables. See `../contracts/API.md` and parent deployment documentation. This task did not start Preview, browser sessions, hosting, provider operations or deployment.

## Access boundary

The app starts with `GET /api/public-config` and `GET /api/session`. A complete authenticated session must contain the server user and CSRF token. Email verification must succeed before the backend accepts login. Signup, verification/resend, forgot-password and reset forms submit exact auth fields. URL tokens are consumed only through an explicit POST button and removed from the URL after success. Verification/reset neither logs in nor grants payment access.

Authenticated users next call `GET /api/access`. Until the server returns `hasAccess: true`, configured verification and an active Standard/Premium entitlement, users see only `/purchase`, account recovery or sign-out. No stores, bootstrap, configuration, analytics or dashboard navigation is loaded for unpaid users. Purchase links are exactly `https://pay.mulchcheckout.com/?plan=standard` ($150) and `?plan=premium` ($250 monthly per store). Returning from a checkout or setting URL/local-storage fields never grants access. `POST /api/access/refresh {}` carries the session CSRF token and verifies payment server-side before loading stores.

Each store must match a current active bound server entitlement, including its plan. Creation submits only `{name, shopDomain, country, entitlementId}`; the entitlement selector contains active unassigned memberships returned by the server. The browser cannot submit plan/status or reuse a bound membership. Private requests use same-origin session cookies, `no-store` and CSRF for mutations. HTTP 401/402 removes private state immediately. Access is checked again every minute and when the page becomes visible; provider uncertainty removes private state. The backend remains the authoritative guard on every private endpoint and enforces proof expiry, verified-email identity, payment evidence, ownership and Premium features.

There is no public demo route, free workspace, fabricated account, development bypass or build-before-purchase UI. All account/order fixtures are under `tests/` and excluded from the production entrypoint and bundle. The only local-storage value is optional light/dark appearance.

## Functional surface

The original Mulch navy rail, warm-white surfaces, blue functional accent and restrained green statuses preserve “Your money, when you need it”. The approved existing Mulch brand SVG is copied locally; no extra illustrations, external fonts or decorative assets are loaded. Navigation includes Home, Analytics Overview/Orders/Abandoned checkouts; Subscriptions Setup/Portal/Recovery/Subscribers; Checkout Design/Thank-you/Upsells & discounts/Buy links/Surveys/Tests; Settings General/Store & Shopify/Payments/Shipping/Integrations/AI & MCP/Billing/Stores/Setup check; official tools and searchable Help. There is responsive drawer navigation, desktop rail collapse/group collapse, keyboard focus, skip link, light/dark appearance, a store selector and server-owned plan/fee/readiness badges.

Resource managers implement GET/POST/PUT/DELETE with the exact contract kinds and config names. PUT includes the saved optimistic `version`; conflicts retain edits and offer an explicit reload of the latest server version. Forms use named controls, select fields and array editors, not JSON textareas. Shipping edits country zones and integer-cent amounts. Surveys edit answer rows; recovery edits unique increasing day rows; experiments select two different owned Mulch design IDs. Fixed discounts use USD dollar values per the backend validator; explicitly named `*Minor` amounts use whole cent strings.

The checkout block builder adds/reorders/drags optional blocks, toggles visibility, duplicates/deletes, edits branding and supported content and immediately renders desktop/mobile SAMPLE previews. Contact, delivery, shipping and payment blocks remain fixed, present and visible. Subscription-choice blocks require Premium. HTML uses an attribute-free formatting allowlist; arbitrary JavaScript, events, forms and embeds are rejected and escaped in previews. Images require safe public HTTPS raster URLs. Cart, buyer and payment presentation is clearly SAMPLE; preview has no live charge controls.

Standard is a paid plan with all common one-time features. Premium adds customer subscription rules/choices, portal and cancel flow, recovery preferences and subscription data/MRR reporting. Standard sees explicit upgrade explanations without requesting Premium resources; the backend independently enforces those permissions.

## Readiness is not production parity

Configuration saves are durable drafts, not provider activation. The activation check calls the actual server endpoint and displays `operation_not_ready` instead of marking a resource active. Shopify/payments connection, verification and payout requests display the actual server error or safe returned provider URL; neither submitted domains nor click events mark connected state. There is no merchant API-key/business-ID paste shortcut. Real operational data is server evidence only; empty paid accounts show zeros, unavailable metrics and empty lists, never fabricated revenue or customer records.

Provider-backed checkout publication, buy-link publication, product ingestion, order synchronization/refunds, one-click offers, experiment runtime, pixel delivery, customer renewals/portal/cancellation operations and recovery messages remain blocked unless their backend/provider readiness is actually implemented and verified. AI & MCP truthfully reports no verified runtime. No native Shopify checkout fallback, traffic split or alternative charge control is introduced. Forecast renewals are not spendable cash. Whop verification, payout holds/reserves and method availability still apply.

## Source organization

- `src/App.tsx`: session/access lifecycle and per-store state boundary.
- `src/lib/access.ts`, `api.ts`, `routes.ts`: tested paid guards, request transport and route registry.
- `src/lib/builder.ts`, `resourceSchemas.ts`: pure block operations, HTML safety and exact resource schemas.
- `src/components/`: shell, small UI primitives, checkout editor/sample preview, typed fields and resource CRUD.
- `src/pages/`: email auth, purchase/store binding, every dashboard destination, operational evidence and help.
- `public/manus-routes.json`: full route declaration; declarations do not grant access.
- `tests/`: internal-only Node/SSR fixtures and validation evidence. See `TEST-EVIDENCE.md`.
