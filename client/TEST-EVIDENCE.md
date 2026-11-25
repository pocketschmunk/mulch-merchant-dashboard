# Client test evidence

## Environment and commands

Checks were executed in the existing isolated sandbox from `merchant-app/client`, against the parent-installed pnpm 11.25.0 workspace. Runtime Node 22.23.4; pinned React 19.3.1, Vite 8.3.8 and TypeScript 7.0.2. The package declaration was ready before the parent installed the root lockfile. No client package dependencies were added or repinned.

Actual terminal output is retained in `tests/check-output.txt`. Commands:

```sh
pnpm test
pnpm typecheck
pnpm build
```

The final suite contains **77 passing tests**, zero failures/skips. TypeScript reports no errors. Vite creates `dist/index.html`, a local brand asset, the route manifest, and hashed CSS/JS assets. The production entrypoint imports no test fixtures.

## Coverage

- Logged-out/missing-CSRF sessions fail closed; authentication alone does not grant dashboard access.
- Unpaid, missing-provider-proof, canceled/expired/trialing/past-due/completed/unverified entitlements cannot open dashboard access.
- Access loading does not request stores, bootstrap, analytics or resources until the server returns verified active paid proof.
- Payment verification refresh uses POST and CSRF before loading owned stores; store records are filtered to exact active bound entitlement/plan matches.
- Creator options include only active unassigned server memberships, not browser plan fields or previously bound memberships.
- Same-origin API transport, no-store, exact CSRF headers, logout CSRF, structured 402 errors, non-JSON responses and network failures.
- Full navigation destination wiring and SSR render coverage; all four Standard-locked Premium destinations show explicit upgrade explanations without rendering configuration editors.
- All exact-contract resource field forms render as controls/array editors rather than JSON placeholders.
- Builder add/reorder/toggle/duplicate/delete, immutable required core blocks, Premium subscription-choice gates, supported-field serialization, safe URLs, HTML script/attribute escaping and formatting-only content.
- Exact integer-cent display beyond floating-point safe ranges and core configuration validation.
- Clearly marked mobile/desktop SAMPLE previews with disabled charge presentation.
- All five email auth screens render without automatically consuming link tokens.
- Route-manifest/source synchronization and absence of fixture/development bypass routes or local-storage access grants.

## Corrected during validation

The first compiler check found a missing Vite CSS declaration; adding `src/vite-env.d.ts` resolved it. The initial SSR test transform required an explicit React import in the **test file**; the production automatic JSX runtime was already correct. The final clean run supersedes these early checks. Input bounds and fixed-discount units were aligned with the concurrently completed backend validator, without changing server or contract source.

## Not claimed or performed

No browser/Preview/server listener was started. No Shopify/Whop provider request, real email, checkout/charge, database write, hosting action, Git operation or deployment was performed by this client subtask. Node tests use mock transport and SSR fixtures under `tests/` only. No browser-interaction or real account/provider end-to-end result is claimed.

Live provider-backed checkout, connected payments, product ingestion, Shopify paid-order synchronization/refunds, upsell orchestration, pixel delivery, design-test activation, customer subscription/portal/recovery operations and AI/MCP remain subject to actual backend adapters and readiness/owner activation. Missing evidence is shown as blocked/unavailable instead of fabricated connection/order/revenue success. Backend integration and security tests are owned by the parent/backend agents.
