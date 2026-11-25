# Authentication and paid access sources

Selected November 24, 2026: Mulch-owned email/password, not Whop sign-in. Owner clarified payment is required before any dashboard access; no free workspace/demo. Active paid seller plans only: Standard $150/Premium $250 monthly per store. Exact seller checkout URL query verified from the unchanged checkout-core.js: /?plan=standard|premium; return status is explicitly unverified.

Resend current send endpoint POST https://api.resend.com/emails uses server Bearer API key, JSON from/to/subject/html/text, optional Idempotency-Key (unique per send, 24-hour lifetime); response has id. Domain/sender must be verified before use. No real email calls made in this task. https://resend.com/docs/api-reference/emails/send-email

OWASP password storage recommends memory-hard salted hashes; Node scrypt fallback uses N=131072,r=8,p=1, with sufficient maxmem and bounded concurrent hashing. https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

OWASP password reset requires generic responses, cryptographically random sufficiently long hashed single-use expiring tokens, per-account rate controls, no automatic login, and invalidation of sessions after reset. Token link origin must come from configured APP_ORIGIN, not request Host. https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

Whop Current API dates reviewed November 24: Memberships and Payments 2026-11-23-3; Members documented 2026-11-19-2. Server-only Authorization Bearer and Api-Version-Date pins. List Memberships account_id/member_id/variant_ids parameters, data + page_info cursor pagination. Status active can include cancellation scheduled at period end; do not filter status=active because the list filter excludes those members. Membership fields account.id, variant_id, member_id, user_id, current_period_start/end, status. https://docs.whop.com/api-reference/memberships/list-memberships and https://docs.whop.com/api-reference/memberships/membership

Members list query exact email needs member:email:read in addition to member:basic:read. Must compare exact normalized member.email, seller account_id and member.user.id; fuzzy name matches are not identity proof. https://docs.whop.com/api-reference/members/list-members and https://docs.whop.com/api-reference/members/retrieve-member

Payments list accepts account_id/member_id/membership_id/variant_id and created_after, data/page_info. Need captured paid/succeeded positive payment bound to the same seller/member/membership/variant and period, not only active membership or historical spend. Whop trialing/past_due/completed grants do not satisfy Mulch's paid active monthly subscription gate. https://docs.whop.com/api-reference/payments/list-payments

Read-only entitlement verification must be configured explicitly and tested separately; source implementation here uses mocked native provider responses and isolated PostgreSQL only, not production API/account access or charges.
