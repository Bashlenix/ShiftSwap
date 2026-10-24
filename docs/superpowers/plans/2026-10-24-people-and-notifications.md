# People, Settings and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone can create an organisation; admins and managers invite staff by email (visible in the demo inbox), add placeholders, assign skills and limits, configure policies and the skills catalogue, and deactivate members (their offers and future shifts become open shifts); everyone gets in-app notifications for swap events; managers can browse the audit log.

**Architecture:** Extends the merged NestJS + Prisma API and React SPA. New API modules `orgs`, `members`, `invites`, `skills`, `notifications`, `mail`, `audit` (list). Emails go over SMTP to Mailpit **after** the database transaction commits; in-app notifications are written **inside** the same transaction as the business change. Mailpit's web UI is served through the web app's Vite proxy at `/mailpit/`, so a Codespace needs no extra port.

**Tech Stack:** existing stack + `nodemailer` (SMTP), Mailpit `MP_WEBROOT`.

**Spec:** `docs/sdd.md` — §5 permissions, §6 FR-01..FR-06, FR-15, FR-17, FR-18, §12 screens 4/7/9/10, §17 owner-deactivated rule, §19 API, §20 invites, §23 notifications, §24 errors, §26 invite-token security, §27 privacy, §33 accessibility.

## Global Constraints

- Out of scope here (Plan 4): email for swap events (in-app only now; invite email is in scope), preference grid, CSV import/export, account deletion/anonymisation, retention purge, notification batching.
- Demo data still resets on every API start (user decision 2026-10-23).
- **Invite tokens** (SDD §20/§26): 32 random bytes, base64url in the link, stored only as SHA-256 hex; single use; expires 7 days after creation; accepting requires login and the account email must equal the invite email (case-insensitive); re-sending creates a new token and invalidates the old one.
- **Invite link base:** the web sends `appOrigin: window.location.origin` with every invite request; the API accepts it only if `isTrustedOrigin(appOrigin, env)` (existing auth-config), otherwise falls back to `http://localhost:5173`. Never build links from the `Origin`/`Host` header (the Codespaces forwarder rewrites them).
- **Email:** sent after commit via `MailService`; failures logged at `warn` with `{ kind, recipientMembershipId }` only (never the address or token); never retried. Env: `SMTP_HOST` (default `mailpit`), `SMTP_PORT` (default `1025`), `MAIL_FROM` (default `ShiftSwap <no-reply@shiftswap.test>`), `MAIL_TRANSPORT=json` in Jest so tests capture messages without SMTP.
- **Notifications** (SDD §23): written in the business transaction; recipients filtered to ACTIVE memberships **with a login**; never to the actor themselves; payload = IDs + `shiftStartAt`/`shiftEndAt` + `kind` + `role` only (no names, no free text).
- **Deactivation** (FR-15, §17; resolves the §40 open item, ruling 2026-10-24): deactivating a member (a) cancels each OPEN give-away they own (`cancelReason 'OWNER_DEACTIVATED'`, PENDING acceptances → INVALIDATED `{ code: 'OWNER_DEACTIVATED' }`), (b) unassigns every future shift (`startAt > now`) assigned to them, (c) posts each such shift as an OPEN_SHIFT offer (if `now < start − lead time`), (d) withdraws their own PENDING acceptances on other offers, (e) notifies managers. Lock order stays offer → shift → membership.
- **Last admin:** the last ACTIVE ADMIN cannot be demoted or deactivated → 409 `LAST_ADMIN`.
- New error codes added to `ERROR_CODES`: `LAST_ADMIN` 409, `ALREADY_MEMBER` 409, `INVITE_INVALID` 410, `SKILL_IN_USE` 409, `EMAIL_MISMATCH` 403.
- Policies in the UI are entered in hours (1 decimal) and stored in minutes; lead time 0–48 h (SDD §40); weekly limit 1–80 h; min rest 0–24 h; max daily 1–24 h; timezone must be a valid IANA zone.
- Everything else from Plan 2's Global Constraints still applies (tenancy via `OrgGuard`, error body format, audit in-tx with IDs/scheduling fields only, lock order, logs IDs only, WCAG 2.2 AA, Bashlenix push rules, no local Docker image builds, CI via workflow_dispatch/PR).

## Review Focus

1. **Invite link in a Codespace** — the emailed link must point at the Codespace URL the manager is using, not `https://localhost:5173` → Task 6 tests `appOrigin` handling; Task 14 E2E clicks the link from Mailpit.
2. **Deactivation racing an approval** — Tom approves Lukas while Maria deactivates Lukas: the end state is consistent (either Lukas got the shift and it's then reposted as open, or the approval fails cleanly) → Task 8 concurrency test.
3. **Accepting an invite twice / with the wrong account** — second click shows "This invite has already been used"; logged in as another email shows a clear mismatch message, never binds the wrong user → Task 7 tests + Task 13 UI.
4. **Notification flood / self-notification** — the actor never notifies themselves, placeholders never get rows, and creating an offer notifies only eligible members → Task 5 tests.
5. **Policy change with open offers** — raising the lead time recomputes `expires_at` of OPEN offers; an offer now past its new expiry answers `OFFER_EXPIRED` → Task 9 test.

---

### Task 1: Schema — invites and notifications

**Files:**
- Modify: `apps/api/prisma/schema.prisma`; create migration `*_invites_notifications`
- Test: `apps/api/test/schema-people.e2e-spec.ts`

**Interfaces:**
- Produces Prisma models (snake_case `@map`, `@db.Timestamptz(3)` on every DateTime):
  - `Invite { id uuid, organizationId, membershipId, email, tokenHash String @unique, expiresAt, acceptedAt?, revokedAt?, createdByMembershipId, createdAt }` `@@index([membershipId])` → `invites`
  - `Notification { id uuid, organizationId, recipientMembershipId, type NotificationType, payload Json, readAt?, createdAt }` `@@index([recipientMembershipId, createdAt])` → `notifications`
  - enum `NotificationType { OFFER_CREATED ACCEPTANCE_RECEIVED OFFER_APPROVED OFFER_REJECTED OFFER_EXPIRED ACCEPTANCE_INVALIDATED OPEN_SHIFT_FILLED MEMBER_DEACTIVATED }`
  - FKs RESTRICT to organizations/memberships.
- [ ] **Step 1: Failing test** — duplicate `tokenHash` rejects (P2002); notification insert + index exists (`pg_indexes` contains `notifications_recipient_membership_id_created_at_idx`); timestamps are `timestamp with time zone`.
- [ ] **Step 2–4:** RED → `prisma migrate dev --name invites_notifications` (DB on 5433) → GREEN; full API e2e still green (seed TRUNCATE covers new tables).
- [ ] **Step 5: Commit** — `feat(api): add invite and notification tables`

---

### Task 2: Shared schemas, DTOs and error codes

**Files:**
- Create: `packages/shared/src/people.ts`, `packages/shared/src/notifications.ts`
- Modify: `packages/shared/src/errors.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/people.test.ts`, `packages/shared/src/notifications.test.ts`

**Interfaces:**
- Produces:
  - `createOrgSchema = { name: string 1..80 trimmed, timezone: IANA zone (default 'Europe/Berlin') }`
  - `orgSettingsSchema = { name?, timezone?, defaultWeeklyLimitMin? int 60..4800, minRestMin? int 0..1440, maxDailyMin? int 60..1440, offerLeadTimeMin? int 0..2880 }` (at least one field)
  - `createMemberSchema = { displayName: 1..80, email?: email (lowercased) | null, accessLevel: AccessLevel default 'EMPLOYEE', skillIds: uuid[] default [], weeklyLimitMin?: int 60..4800 | null, appOrigin?: url }`
  - `updateMemberSchema = { displayName?, accessLevel?, skillIds?, weeklyLimitMin?: int | null }` (at least one)
  - `resendInviteSchema = { appOrigin?: url }`; `skillSchema = { name: 1..40 trimmed }`
  - `isValidTimeZone(tz: string): boolean` (uses `Intl.DateTimeFormat` with `timeZone`; throws → false) — used by the schemas.
  - DTOs: `OrgDto { id, name, timezone, defaultWeeklyLimitMin, minRestMin, maxDailyMin, offerLeadTimeMin }`; `MemberDto` gains `email: string | null`, `invitePending: boolean`, `status: 'ACTIVE' | 'DEACTIVATED'` (typed union); `CreateMemberResponse { member: MemberDto; inviteLink: string | null }`; `InvitePreviewDto { organizationName, email, expiresAt, state: 'VALID' | 'USED' | 'EXPIRED' | 'REVOKED' }`; `NotificationType` union (as Task 1); `NotificationDto { id, type, payload: NotificationPayload, readAt: string | null, createdAt }`; `NotificationPayload { offerId?: string; shiftId?: string; shiftStartAt?: string; shiftEndAt?: string; kind?: OfferKind; role?: 'owner' | 'candidate' | 'selected' | 'notSelected' | 'manager' | 'eligible' }`; `AuditEntryDto { id: string; action; entityType; entityId; actorName: string | null; before: unknown; after: unknown; metadata: unknown; createdAt }`.
  - `ERROR_CODES` + `LAST_ADMIN`, `ALREADY_MEMBER`, `INVITE_INVALID`, `SKILL_IN_USE`, `EMAIL_MISMATCH`.
- [ ] **Step 1: Failing tests** — `isValidTimeZone('Europe/Berlin')` true, `'Mars/Olympus'` false; `orgSettingsSchema.parse({})` fails ("Change at least one setting"); `offerLeadTimeMin: 2881` fails; `createMemberSchema` lowercases email and accepts `email: null`; new codes present.
- [ ] **Step 2–4:** RED → implement → GREEN; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(shared): add people, settings and notification schemas`

---

### Task 3: Mail service with after-commit sending, and Mailpit in the demo

**Files:**
- Create: `apps/api/src/mail/mail.service.ts`, `apps/api/src/mail/mail.module.ts`, `apps/api/src/common/after-commit.ts`
- Modify: `apps/api/package.json` (`nodemailer`, `@types/nodemailer`), `docker-compose.yml` (api `SMTP_HOST: mailpit`; mailpit `MP_WEBROOT: mailpit`), `apps/web/vite.config.ts` (proxy `/mailpit` → `MAILPIT_PROXY_TARGET`, `ws: true`, only when the env var is set), `docker-compose.yml` web env `MAILPIT_PROXY_TARGET: http://mailpit:8025`, `scripts/smoke-stack.sh` (GET `/mailpit/` → 200), `apps/web/vite.config.test.ts`, `README.md`, `DEMO_ACCOUNTS.md`
- Test: `apps/api/src/mail/mail.service.spec.ts`, `apps/api/src/common/after-commit.spec.ts`

**Interfaces:**
- Produces: `MailService.send(msg: { to: string; subject: string; text: string; html: string; kind: string; recipientMembershipId: string }): Promise<void>` — never throws; logs `warn { kind, recipientMembershipId }` on failure; `MailService.sent: Array<{ to, subject, text }>` populated only when `MAIL_TRANSPORT=json` (tests).
- Produces: `withAfterCommit<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient, after: (job: () => Promise<void>) => void) => Promise<T>): Promise<T>` — runs `fn` in `prisma.$transaction`, then (only after a successful commit) runs queued jobs sequentially, swallowing and logging job errors; a rolled-back transaction runs no jobs.
- [ ] **Step 1: Failing tests** — `withAfterCommit`: jobs run after commit in order; throwing inside `fn` runs none; a throwing job does not fail the call. `MailService` with json transport records the message; with an unreachable SMTP host resolves (no throw) and logs warn without the address. `vite.config.test`: `/mailpit` proxy present only when `MAILPIT_PROXY_TARGET` set, with `ws: true`.
- [ ] **Step 2–4:** RED → implement → GREEN. Jest e2e setup sets `MAIL_TRANSPORT=json`.
- [ ] **Step 5: Commit, push, CI** — `feat(api): add mail service and serve the demo inbox at /mailpit`; trigger CI via workflow_dispatch; `stack-smoke` must show `/mailpit/` 200.

---

### Task 4: Create an organisation (FR-01)

**Files:**
- Create: `apps/api/src/orgs/orgs.controller.ts`, `apps/api/src/orgs/orgs.service.ts`, `apps/api/src/orgs/orgs.module.ts`
- Test: `apps/api/test/orgs.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /api/v1/orgs` (SessionGuard only, `createOrgSchema`) → 201 `OrgDto`; creates the org and an ACTIVE ADMIN membership for the caller (`displayName` = user name, `email` = user email) in one transaction; audit `org.created`. `GET /api/v1/orgs/:orgId` (EMPLOYEE) → `OrgDto`.
- [ ] **Step 1: Failing tests** — create → 201; `/me` then lists it with ADMIN; invalid timezone → 400; no session → 401; GET other org → 404.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(api): let any user create an organisation`

---

### Task 5: In-app notifications — service, endpoints, and swap-event hooks

**Files:**
- Create: `apps/api/src/notifications/notifications.service.ts`, `apps/api/src/notifications/notifications.controller.ts`, `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/offers/offers.service.ts`, `apps/api/src/offers/offer-lifecycle.ts`
- Test: `apps/api/test/notifications.e2e-spec.ts`

**Interfaces:**
- Produces: `NotificationsService.notify(tx, orgId: string, recipients: string[], type: NotificationType, payload: NotificationPayload, actorMembershipId: string | null): Promise<number>` — de-duplicates recipients, drops the actor, drops memberships that aren't ACTIVE or have no login (one query), `createMany`; returns rows written.
- Endpoints (prefix `/api/v1/orgs/:orgId`): `GET /notifications?cursor&limit` (own, newest first, limit default 20 max 50, `nextCursor`), `GET /notifications/unread-count` → `{ count }`, `POST /notifications/read` `{ ids?: uuid[] }` (none → all own) → 204.
- Hooks (inside the existing transactions), recipients per SDD §23:
  - offer created → `OFFER_CREATED` to eligible members (`EligibilityLoader.load` once, eligible only, role `eligible`) + managers/admins for GIVE_AWAY (role `manager`);
  - acceptance created/reactivated → `ACCEPTANCE_RECEIVED` to managers + original owner;
  - approved → `OFFER_APPROVED` to selected (role `selected`), owner (role `owner`), non-selected candidates (role `notSelected`);
  - rejected → `OFFER_REJECTED` to owner + PENDING candidates;
  - expired (lazy + scheduler) → `OFFER_EXPIRED` to owner + managers;
  - acceptance invalidated (shift change, recheck failure) → `ACCEPTANCE_INVALIDATED` to that candidate;
  - open shift filled → `OPEN_SHIFT_FILLED` to claimant (role `selected`) + managers.
- [ ] **Step 1: Failing tests** — one per event with exact recipient sets (membership IDs) and types; actor excluded (manager approving gets none for that event); placeholder never receives; ineligible member gets no `OFFER_CREATED`; list paginates with `nextCursor`; read-all sets `readAt`; unread-count; another member's notification id in `read` is ignored (scoped), other org → 404.
- [ ] **Step 2–4:** RED → implement → GREEN; full API e2e green (existing offer tests unaffected).
- [ ] **Step 5: Commit** — `feat(api): add in-app notifications for swap events`

---

### Task 6: Members API — list, add placeholder, invite, edit, resend

**Files:**
- Create: `apps/api/src/members/members.controller.ts`, `apps/api/src/members/members.service.ts`, `apps/api/src/members/invite-token.ts`, `apps/api/src/members/invite-mail.ts`, `apps/api/src/members/members.module.ts`
- Modify: `apps/api/src/directory/directory.controller.ts` (move `GET members` into the new controller; keep `GET skills` until Task 9)
- Test: `apps/api/src/members/invite-token.spec.ts`, `apps/api/test/members.e2e-spec.ts`

**Interfaces:**
- Produces: `newInviteToken(): { token: string; tokenHash: string }` (32 bytes base64url; SHA-256 hex) and `hashInviteToken(token: string): string`; `inviteLink(appOrigin: string | undefined, env, token): string`.
- Endpoints (prefix `/api/v1/orgs/:orgId/members`, MANAGER unless noted):
  - `GET /?status=active|all` → `MemberDto[]` (sorted by name; `invitePending` = has an un-accepted, un-revoked, unexpired invite).
  - `POST /` (`createMemberSchema`) → 201 `CreateMemberResponse`. No email → placeholder (`inviteLink: null`). With email: if an ACTIVE membership in this org already has that email → 409 `ALREADY_MEMBER`; else create membership (`userId` null) + invite, email after commit (subject `You're invited to {org} on ShiftSwap`, text contains the link and "This link expires on {date}"); response `inviteLink` = the link (the manager may copy it). Creating an ADMIN requires the caller be ADMIN (else 403).
  - `PATCH /:membershipId` (`updateMemberSchema`): `accessLevel` change requires ADMIN; demoting the last ACTIVE ADMIN → 409 `LAST_ADMIN`; skills replaced atomically; all IDs org-scoped.
  - `POST /:membershipId/invite` (`resendInviteSchema`): membership must have an email and no user → revokes open invites, creates a new one, emails it → 201 `{ inviteLink }`; else 409 `INVALID_TRANSITION`.
  - Audit `member.created`, `member.updated`, `invite.created` (IDs + accessLevel/skillIds/weeklyLimitMin only; never email or token).
- [ ] **Step 1: Failing tests** — token: base64url 43 chars, hash is 64 hex, hash differs from token; placeholder create; invite create → exactly one email in `MailService.sent` to that address containing the link; `appOrigin: 'https://evil.example'` → link uses `http://localhost:5173`; trusted Codespace origin (with `ALLOW_CODESPACE_ORIGINS`) → link uses it; duplicate email → 409 `ALREADY_MEMBER`; employee → 403; manager creating ADMIN → 403; demote last admin → 409 `LAST_ADMIN`; resend → old token's hash revoked; DB never contains the raw token (scan `invites`); foreign skill id → 404.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(api): add members API with email invites and placeholders`

---

### Task 7: Invite acceptance API

**Files:**
- Create: `apps/api/src/invites/invites.controller.ts`, `apps/api/src/invites/invites.service.ts`, `apps/api/src/invites/invites.module.ts`
- Test: `apps/api/test/invites.e2e-spec.ts`

**Interfaces:**
- Produces (prefix `/api/v1/invites`, not org-scoped):
  - `GET /:token` (public; `@nestjs/throttler` 20 requests/min per client IP on this controller, IP from `x-forwarded-for` as in the auth setup) → `InvitePreviewDto` (unknown token → 404 `NOT_FOUND`).
  - `POST /:token/accept` (SessionGuard) in one tx: lock invite row; state must be VALID else 410 `INVITE_INVALID` (`details.state`); session email ≠ invite email → 403 `EMAIL_MISMATCH`; user already has a membership in the org → 409 `ALREADY_MEMBER`; set `membership.userId`, `invite.acceptedAt`; audit `invite.accepted`; → 200 `{ organizationId }`.
- [ ] **Step 1: Failing tests** — preview VALID/EXPIRED/USED/REVOKED; accept happy path → `/me` lists the org; second accept → 410 with state USED; two parallel accepts → one 200 + one 410; wrong-email session → 403 and nothing bound; expired → 410; email compare is case-insensitive; existing user (already member of another org) accepts → second membership, no duplicate user; throttling returns 429 after 20 previews/min.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(api): accept invites with single-use hashed tokens`

---

### Task 8: Deactivate and reactivate members, with offer conversion

**Files:**
- Create: `apps/api/src/members/deactivation.service.ts`
- Modify: `apps/api/src/members/members.controller.ts`
- Test: `apps/api/test/deactivation.e2e-spec.ts`

**Interfaces:**
- Consumes: Plan 2 `offer-locks.ts` (`lockOffer/lockShift/lockMembership`), `OffersService` helpers (`closePending`), `assertOfferTransition`, `NotificationsService.notify`, `AuditService`.
- Produces: `POST /api/v1/orgs/:orgId/members/:membershipId/deactivate` (MANAGER; deactivating an ADMIN requires ADMIN; last ACTIVE ADMIN → 409 `LAST_ADMIN`; self-deactivation → 409 `INVALID_TRANSITION`) → 200 `{ cancelledOffers: number; reposted: number; unassigned: number; withdrawnAcceptances: number }`; `POST …/reactivate` (MANAGER) → 200 `MemberDto` (does not reassign anything).
- Deactivation transaction, in this order (lock order offer → shift → membership): read affected IDs (their OPEN give-aways; their future assigned shifts; their PENDING acceptances); lock those offers (ascending id), then those shifts (ascending id), then the membership; apply the Global Constraints rules (a)–(e); revoke open invites; status DEACTIVATED; audit `member.deactivated` with the counts; notifications: each reposted open shift triggers the normal `OFFER_CREATED` notifications (Task 5 hook), and managers/admins get one `MEMBER_DEACTIVATED` (payload `{}`); the cancelled give-away's invalidated candidates get `ACCEPTANCE_INVALIDATED`.
- [ ] **Step 1: Failing tests** — Anna (owner of an open give-away with Lukas PENDING, plus 2 future shifts, plus a PENDING acceptance elsewhere) deactivated → give-away CANCELLED `OWNER_DEACTIVATED`, Lukas's acceptance INVALIDATED, both future shifts unassigned and each has an OPEN_SHIFT offer, her acceptance WITHDRAWN, counts exact; a shift within the lead time is unassigned but not reposted; past shifts untouched; deactivated member → their requests 404 (OrgGuard); placeholder deactivation works; last admin → 409; employee → 403; reactivate → ACTIVE, nothing reassigned. **Concurrency (Review Focus 2):** approve Lukas on an offer while deactivating Lukas in parallel ×5 → each iteration ends consistent: Lukas DEACTIVATED, holds no future shift, every affected shift either has an OPEN offer or an active assignee, never both.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit, push, CI** — `feat(api): deactivate members and repost their shifts as open shifts`

---

### Task 9: Skills catalogue and organisation settings

**Files:**
- Create: `apps/api/src/skills/skills.controller.ts`, `apps/api/src/skills/skills.module.ts`
- Modify: `apps/api/src/orgs/orgs.controller.ts`, `apps/api/src/orgs/orgs.service.ts`, `apps/api/src/directory/*` (remove — routes now live in members/skills controllers; delete the module)
- Test: `apps/api/test/skills.e2e-spec.ts`, `apps/api/test/org-settings.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/orgs/:orgId/skills` (EMPLOYEE), `POST` (ADMIN, `skillSchema`, duplicate name → 409 `VALIDATION_FAILED` with message "A skill with this name already exists"), `PATCH /:skillId` (ADMIN, rename), `DELETE /:skillId` (ADMIN; if any non-deleted shift starting in the future requires it → 409 `SKILL_IN_USE` with `details.shiftCount`; else delete, join rows cascade) → 204.
- Produces: `PATCH /api/v1/orgs/:orgId` (ADMIN, `orgSettingsSchema`) → `OrgDto`; when `offerLeadTimeMin` changes, in the same tx: `UPDATE offers o SET expires_at = s.start_at - make_interval(mins => $lead), version = version + 1 FROM shifts s WHERE o.shift_id = s.id AND o.status = 'OPEN' AND o.organization_id = $org`; audit `org.updated` (changed fields only).
- [ ] **Step 1: Failing tests** — skills CRUD + permissions; delete in use → 409 with count; delete unused → join rows gone; settings PATCH as manager → 403; invalid timezone → 400; lead time 120 → 600 moves `expires_at` of OPEN offers; an offer now past expiry → accept returns 409 `OFFER_EXPIRED` (Review Focus 5); `/me` reflects new `offerLeadTimeMin` and timezone; tenancy sweep (Plan 2 `tenancy-sweep.e2e-spec.ts`) extended with every new org-scoped route (members, skills, settings, notifications, audit list from Task 10) — route-set equality must pass.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(api): add skills catalogue and organisation settings`

---

### Task 10: Audit log list API

**Files:**
- Create: `apps/api/src/audit/audit.controller.ts`
- Modify: `apps/api/src/audit/audit.module.ts`
- Test: `apps/api/test/audit-list.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/orgs/:orgId/audit?entityType&entityId&cursor&limit` (MANAGER) → `{ items: AuditEntryDto[]; nextCursor: string | null }`, newest first, limit default 50 max 100; `actorName` = actor membership's displayName or null for system; `entityType` must be one of the known types else 400.
- [ ] **Step 1: Failing tests** — lists own org only; filters by entityType and entityId; cursor pagination stable under inserts; employee → 403; system actor → `actorName: null`; tenancy sweep row added (Task 9's sweep).
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(api): list the audit log for managers`

---

### Task 11: Web — Members screen

**Files:**
- Create: `apps/web/src/features/members/MembersPage.tsx`, `apps/web/src/features/members/MemberDialog.tsx`, `apps/web/src/features/members/InviteResult.tsx`
- Modify: `apps/web/src/router.tsx` (`/orgs/:orgId/members`), `apps/web/src/features/org/OrgLayout.tsx` (manager nav "Members")
- Test: `MembersPage.test.tsx`, `MemberDialog.test.tsx`

**Interfaces:**
- Screen (SDD §12 screen 7): table with caption "People in {org}", columns Name, Access, Skills, Weekly limit, Status (badges: "Active", "Invite pending", "No login", "Deactivated"); filter "Show deactivated" (`status=all`); "Add person" opens `MemberDialog` (Name, Email optional with hint "Leave empty for staff without email (no login)", Access level select — ADMIN option only for admins, Skills checkboxes, Weekly limit in hours optional); on success with email shows `InviteResult`: "Invite sent to {email}." + "Copy invite link" (clipboard, announces "Link copied.") + "Open demo inbox" link to `/mailpit/`; row actions: "Edit", "Resend invite" (invite pending), "Deactivate" (confirm dialog listing consequences: "Their open offers are cancelled and their future shifts become open shifts."), "Reactivate"; deactivate result notice uses counts ("Deactivated. 2 future shifts were posted as open shifts."); `LAST_ADMIN` → "An organisation needs at least one admin."; `ALREADY_MEMBER` → "This email already belongs to a member." Requests send `appOrigin: window.location.origin`.
- Extend `errorMessage` with the new codes: `LAST_ADMIN`, `ALREADY_MEMBER`, `INVITE_INVALID` ("This invite is no longer valid."), `SKILL_IN_USE` ("This skill is still required by upcoming shifts."), `EMAIL_MISMATCH` ("This invite is for a different email address.").
- [ ] **Step 1: Failing tests** — table semantics; add placeholder posts without email; add with email shows invite result and copy announces; admin-only option hidden for managers; deactivate confirm text + counts notice; error copies; employees see "Only managers can see this page."
- [ ] **Step 2–4:** RED → implement → GREEN (web tests, lint, typecheck, build).
- [ ] **Step 5: Commit** — `feat(web): add members screen with invites and deactivation`

---

### Task 12: Web — Settings, Notifications, Audit screens

**Files:**
- Create: `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/features/settings/SkillsSection.tsx`, `apps/web/src/features/notifications/NotificationsPage.tsx`, `apps/web/src/features/notifications/notification-text.ts`, `apps/web/src/features/notifications/useUnreadCount.ts`, `apps/web/src/features/audit/AuditPage.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/features/org/OrgLayout.tsx`
- Test: one `*.test.tsx`/`*.test.ts` per file above

**Interfaces:**
- Settings (ADMIN; others "Only admins can see this page."): form Name, Time zone (`<select>` of `Intl.supportedValuesOf('timeZone')`), Weekly hour limit (h), Minimum rest between shifts (h), Maximum hours per day (h), Offer closes before shift start (h); converts hours↔minutes; caption "These are company policy checks, not a legal compliance guarantee."; saves only changed fields; on success refetch `/me`. `SkillsSection`: list, add, rename inline, delete with `SKILL_IN_USE` message.
- Notifications: nav item "Notifications" with unread badge text (e.g. "Notifications (3)", polled every 60 s via `useUnreadCount`, `aria-live="polite"` on the count); page lists items newest first with text from `notificationText(n, timezone)`: `OFFER_CREATED` eligible → "New shift available: {time}." / manager → "A shift was offered: {time}."; `ACCEPTANCE_RECEIVED` → "Someone accepted the offer for {time}."; `OFFER_APPROVED` selected → "You got the shift {time}." / owner → "Your offer for {time} was approved." / notSelected → "The shift {time} went to someone else."; `OFFER_REJECTED` → "The offer for {time} was rejected."; `OFFER_EXPIRED` → "The offer for {time} expired."; `ACCEPTANCE_INVALIDATED` → "The shift {time} changed — accept again if you still want it."; `OPEN_SHIFT_FILLED` selected → "You claimed the shift {time}." / manager → "The open shift {time} was filled."; `MEMBER_DEACTIVATED` → "A member was deactivated; their shifts were reposted."; unread items marked visually AND with text "New"; "Mark all as read" button; links to My shifts / Offer review where relevant; "Load more" with cursor.
- Audit (MANAGER): table newest first, columns When, Who, Action, Item; filter by entity type; "Load more".
- [ ] **Step 1: Failing tests** — hours↔minutes conversion; only changed fields sent; time zone select labelled; notification text for every type/role combination; unread badge text + mark-all; audit filter and load more; permission messages.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(web): add settings, notifications and audit screens`

---

### Task 13: Web — sign-up, create organisation, accept invite

**Files:**
- Create: `apps/web/src/features/auth/SignUpPage.tsx`, `apps/web/src/features/orgs/CreateOrgPage.tsx`, `apps/web/src/features/invites/AcceptInvitePage.tsx`
- Modify: `apps/web/src/router.tsx` (`/signup`, `/orgs/new`, `/invites/:token` — public route that handles both states), `apps/web/src/features/auth/LoginPage.tsx` (link "Create an account"; honour `?next=` redirect, same-origin paths only), `apps/web/src/features/orgs/OrgPickerPage.tsx` ("Create organisation" link)
- Test: `SignUpPage.test.tsx`, `CreateOrgPage.test.tsx`, `AcceptInvitePage.test.tsx`, `LoginPage.test.tsx` (next redirect)

**Interfaces:**
- `/signup`: Name, Email, Password (min 8) → `authClient.signUp.email` → redirect `next` or `/orgs`.
- `/orgs/new`: Name, Time zone (default browser zone if valid, else Europe/Berlin) → `POST /api/v1/orgs` → navigate to `/orgs/:id`.
- `/invites/:token`: loads `GET /api/v1/invites/:token`; state ≠ VALID → "This invite has already been used." / "This invite has expired. Ask your manager to send a new one." / "This invite was replaced by a newer one."; VALID and signed out → heading "Join {organizationName}", text "Invited: {email}", two actions "Create account" (inline form: Name + Password, email fixed and read-only) and "I already have an account" (to `/login?next=/invites/:token`); VALID and signed in → "Join {organizationName}" button → accept → navigate to `/orgs/:id`; `EMAIL_MISMATCH` → "You're signed in as {sessionEmail}, but this invite is for {email}." + "Log out" button (Review Focus 3).
- `?next=` accepted only if it starts with `/` and not `//`.
- [ ] **Step 1: Failing tests** — signup posts and redirects; open-redirect attempt `next=//evil.example` ignored; create org navigates; invite states copy; signed-out create-account path signs up with the invite email then accepts; mismatch message + log out.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** — `feat(web): add sign-up, create organisation and invite acceptance`

---

### Task 14: Demo seed, E2E and PR

**Files:**
- Modify: `apps/api/src/seed/demo-data.ts`, `apps/api/src/seed/seed-demo.ts`, `apps/api/test/seed-demo.e2e-spec.ts`, `DEMO_ACCOUNTS.md`, `README.md`
- Create: `e2e/tests/people-flow.spec.ts`

**Interfaces:**
- Seed additions (exact): a pending invite at Café Lindenhof for `Jonas Braun` `jonas@shiftswap.test` (EMPLOYEE, skill Service) created by Maria — no email sent by the seed; seeded notifications: Tom has 2 unread `ACCEPTANCE_RECEIVED` (Lukas and Mia on Anna's L5 offer), Anna has 1 unread `OFFER_CREATED` for L3 (role `eligible`). Counts: users 6, organizations 2, memberships 9, invites 1, notifications 3 (plus Plan 2 counts unchanged).
- E2E (serial, after `swap-flow.spec.ts`, using `helpers.ts` pacing): (1) Maria → Members → "Add person" with a fresh email `newhire+{timestamp}@shiftswap.test` → invite result shown; fetch the message via Mailpit API `GET /mailpit/api/v1/search?query=to:{email}` then `GET /mailpit/api/v1/message/{ID}`; open the link from the email body → "Join Café Lindenhof" → Create account → lands in the org → Members (as Maria) shows the person "Active". (2) Tom → nav shows "Notifications (n)" with n ≥ 1 → page lists "Someone accepted the offer for …" items marked "New" → "Mark all as read" → nav shows "Notifications" without a count. (3) Maria deactivates Mia → notice mentions posted open shifts → Mia's future shifts appear under Schedule's "Unassigned" row with "Open shift". (4) axe zero serious/critical on Members, Settings, Notifications, Audit, and the invite page.
- [ ] **Step 1: Failing seed tests** — counts above; Jonas's invite row has a 64-hex `tokenHash`, `acceptedAt` null, `expiresAt` 7 days after seeding (±1 min); the seeded notifications have the exact recipients/types listed.
- [ ] **Step 2–4:** RED → implement → GREEN; update DEMO_ACCOUNTS/README demo script with the invite steps (Demo inbox at `/mailpit/`).
- [ ] **Step 5: Push, PR, CI** — `test(e2e): cover invites, notifications and deactivation`; open PR to `main` (`GH_TOKEN=$(gh auth token -u Bashlenix) gh pr create … --title "People, settings and notifications"`, English body, no attribution); iterate until `checks`, `stack-smoke`, `zero-setup` are green. Do not merge.
