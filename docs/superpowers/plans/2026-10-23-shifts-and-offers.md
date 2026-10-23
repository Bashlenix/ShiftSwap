# Shifts and Offers (Core Swap Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers schedule shifts; employees give away shifts or claim open shifts; eligibility is enforced by explainable hard rules, candidates are ranked with a visible score breakdown, managers approve, and every change is audited — end to end in the UI on the seeded demo.

**Architecture:** Extends the merged skeleton (NestJS modular monolith + Prisma 7 + Postgres, React SPA). New pure `matching` module (eligibility, ranking, time math — no DB) is called by a DB-backed loader. Offer transitions run in Prisma interactive transactions with `SELECT … FOR UPDATE` in the fixed lock order offer → shift → candidate membership; human edits use optimistic `version` checks. All org-owned routes live under `/api/v1/orgs/:orgId/…` behind one `OrgGuard`.

**Tech Stack:** existing stack + `luxon` (API timezone math), `@nestjs/schedule` (expiry job), Zod schemas shared from `@shiftswap/shared`.

**Spec:** `docs/sdd.md` — §5 permissions, §6 FR-05..FR-14/FR-16/FR-18/FR-25, §12 screens 1/2/3/5/6, §14 schema, §17 state machine, §18 matching, §19 API, §21 tenancy, §24 errors, §25 concurrency, §32 tests, §33 accessibility. Ticked decisions in §40 apply (slot boundaries are Plan 3; daily limit = minutes of shifts *starting* on the org-local date; manager assignments return non-blocking warnings; soft-delete shifts; lead time default 120 min).

## Global Constraints

- Out of scope here (Plan 3): notifications (in-app + email), preference grid (ranking uses preference = NEUTRAL → 20 points for everyone), member/invite/skills/settings management UI, deactivation + offer conversion (FR-15), CSV, audit-log UI, account deletion, retention.
- Demo data keeps **resetting on every API start** (user decision 2026-10-23); seeded dates are relative to "today" in `Europe/Berlin`.
- Timestamps stored UTC (`timestamptz`); org timezone (`organizations.timezone`, IANA) used for day/week boundaries; durations in minutes. Week = Monday 00:00 – Sunday 24:00 org-local. Overnight shifts count toward the day and week in which they **start**.
- Hard rules and defaults (SDD §18): `NOT_ACTIVE`, `IS_OWNER`, `MISSING_SKILL`, `OVERLAP`, `UNAVAILABLE`, `MIN_REST` (org `min_rest_min`, 660), `DAILY_LIMIT` (org `max_daily_min`, 600), `WEEKLY_LIMIT` (member `weekly_limit_min` ?? org `default_weekly_limit_min`, 2400). All hard blocks. Copy "company policy, not legal compliance" wherever rules are explained in UI.
- Ranking (SDD §18): total = P + H + S; P: PREFERRED 40 / NEUTRAL 20 / AVOID 0; H = round(40 × (1 − weeklyMinutesAfter ÷ weeklyLimit)) clamped 0..40; S = max(0, 20 − 5 × shifts taken via ShiftSwap in the last 30 days); ties → earliest acceptance. Weights are constants.
- Offer `expires_at` = shift `start_at` − org `offer_lead_time_min`. Lazy expiry on every offer write + scheduler every 5 minutes (disabled when `NODE_ENV=test`).
- Error body `{ "error": { "code", "message", "details"? } }`; codes and statuses exactly SDD §24: `VALIDATION_FAILED` 400, `NOT_FOUND` 404 (also wrong org), `FORBIDDEN` 403, `VERSION_CONFLICT` 409, `INVALID_TRANSITION` 409, `OFFER_ALREADY_FILLED` 409, `OFFER_EXPIRED` 409, `OFFER_ALREADY_OPEN` 409, `INELIGIBLE` 422 (`details.failedRules`), `SELF_APPROVAL_FORBIDDEN` 403.
- Every state change writes an `audit_logs` row in the same transaction (IDs + scheduling fields only, no names/emails).
- Lock order offer → shift → membership, always. Isolation stays READ COMMITTED. Prisma has no `FOR UPDATE`: use `tx.$queryRaw` inside `prisma.$transaction(async (tx) => …)`.
- Logs: IDs only. Accessibility: WCAG 2.2 AA on new screens (labels, text errors, `aria-live`, status badges with text, schedule = `<table>` with headers, keyboard-operable dialogs via Radix).
- Workflow: branch `feature/bashi-23.10.2026-shifts-and-offers`; commits English, no attribution; push only via the Bashlenix setup (`git@github-personal:…`, `GH_TOKEN=$(gh auth token -u Bashlenix)`), never `gh auth switch`. Local Docker image builds are impossible on the dev Mac (TLS interception) — container checks run in CI; API e2e locally with `DB_PORT=5433 docker compose up -d --wait db`.
- Runtime image: `apps/api` now imports `@shiftswap/shared` at runtime — the API Docker runtime stage must contain `packages/shared/dist` and its `node_modules` link (verified by CI `stack-smoke`).

## Review Focus

1. **DST and overnight shifts** — a shift 22:00–06:00 across the last-Sunday-of-October switch must count 9 h (not 8) toward the week it starts in and must overlap-check correctly → tests in Task 3.
2. **Double booking under concurrency** — Lukas selected for two overlapping offers approved at the same moment must end with only one assignment → test in Task 10.
3. **Stale manager screen** — approving with an old `version` or after the candidate became ineligible must fail with a clear reason, never silently assign → tests in Task 10, UI handling in Task 14.
4. **Cross-tenant IDs** — an Anna-session request with a Seeblick offer/shift ID must return 404 on every new endpoint, including nested IDs in bodies (`shiftId`, `acceptanceId`) → Task 11.
5. **Offer near shift start** — creating, accepting or approving within the lead time must answer `OFFER_EXPIRED`, and the scheduler must not double-expire an offer a manager is approving → tests in Tasks 9 and 10.

---

### Task 1: Schema and migration for skills, shifts, unavailability, offers, acceptances, audit

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_shifts_offers/migration.sql` (generated, then hand-edited)
- Test: `apps/api/test/schema-constraints.e2e-spec.ts`

**Interfaces:**
- Produces Prisma models (all `@@map` snake_case, `organizationId` on every org-owned model):
  - `Skill { id uuid, organizationId, name }` `@@unique([organizationId, name])` → `skills`
  - `MembershipSkill { membershipId, skillId }` `@@id([membershipId, skillId])` → `membership_skills`
  - `Shift { id uuid, organizationId, startAt, endAt, assignedMembershipId?, location?, notes?, externalId?, source String @default("MANUAL"), version Int @default(1), deletedAt?, createdAt, updatedAt }` `@@index([organizationId, startAt])`, `@@index([assignedMembershipId, startAt])`, `@@unique([organizationId, externalId])` → `shifts`
  - `ShiftSkill { shiftId, skillId }` `@@id` → `shift_skills`
  - `Unavailability { id, organizationId, membershipId, startAt, endAt, createdAt }` `@@index([membershipId, startAt])` → `unavailabilities`
  - `Offer { id, organizationId, shiftId, kind OfferKind, status OfferStatus @default(OPEN), originalOwnerMembershipId?, createdByMembershipId, expiresAt, selectedAcceptanceId?, resolvedByMembershipId?, resolvedAt?, cancelReason?, version Int @default(1), createdAt, updatedAt }` `@@index([organizationId, status])` → `offers`
  - `Acceptance { id, organizationId, offerId, membershipId, status AcceptanceStatus, invalidatedReason Json?, createdAt, updatedAt }` `@@unique([offerId, membershipId])` → `acceptances`
  - `AuditLog { id BigInt @id @default(autoincrement()), organizationId, actorMembershipId?, action, entityType, entityId, before Json?, after Json?, metadata Json?, createdAt }` `@@index([organizationId, createdAt])` → `audit_logs`
  - Enums `OfferKind { GIVE_AWAY OPEN_SHIFT }`, `OfferStatus { OPEN APPROVED REJECTED FILLED CANCELLED EXPIRED }`, `AcceptanceStatus { PENDING SELECTED NOT_SELECTED WITHDRAWN INVALIDATED }`.
  - FKs to `organizations`/`memberships`/`shifts`/`skills` with `ON DELETE RESTRICT` except join tables (`CASCADE`).

- [ ] **Step 1: Write the failing test** `schema-constraints.e2e-spec.ts` (uses Prisma directly, one org + 2 memberships created in `beforeAll`):
  - inserting a shift with `endAt <= startAt` rejects (message contains `shifts_end_after_start`);
  - two `OPEN` offers on the same shift reject (`offers_one_open_per_shift`); an `OPEN` + a `CANCELLED` offer on the same shift succeed;
  - two acceptances for the same `(offerId, membershipId)` reject;
  - an unavailability with `endAt <= startAt` rejects (`unavailabilities_end_after_start`).
- [ ] **Step 2: Run** `npm run test:e2e -w @shiftswap/api -- schema-constraints` → FAIL (models missing).
- [ ] **Step 3: Implement** — edit schema, `npx prisma migrate dev --name shifts_offers -w @shiftswap/api` (DB on 5433), then append to the generated SQL:

```sql
ALTER TABLE shifts ADD CONSTRAINT shifts_end_after_start CHECK (end_at > start_at);
ALTER TABLE unavailabilities ADD CONSTRAINT unavailabilities_end_after_start CHECK (end_at > start_at);
CREATE UNIQUE INDEX offers_one_open_per_shift ON offers (shift_id) WHERE status = 'OPEN';
```
- [ ] **Step 4: Run** the spec + full `npm run test:e2e -w @shiftswap/api` (seed reset test must still pass — TRUNCATE covers new tables) → PASS.
- [ ] **Step 5: Commit** — `feat(api): add schema for skills, shifts, unavailability, offers and audit log`

---

### Task 2: Shared request schemas and response types

**Files:**
- Create: `packages/shared/src/shifts.ts`, `packages/shared/src/offers.ts`, `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/package.json` (add dependency `"@shiftswap/shared": "*"`), `apps/api/Dockerfile` (runtime keeps `packages/shared/dist` + workspace link)
- Test: `packages/shared/src/shifts.test.ts`, `packages/shared/src/offers.test.ts`

**Interfaces:**
- Produces (Zod 4, exported with inferred types):
  - `createShiftSchema = { startAt: ISO datetime string, endAt: ISO datetime string, requiredSkillIds: uuid[] (default []), assignedMembershipId: uuid | null, location?: string ≤ 120, notes?: string ≤ 500 }` refined: `endAt > startAt` (message `End must be after start`), duration ≤ 16 h (message `A shift can be at most 16 hours`).
  - `updateShiftSchema = createShiftSchema.partial() & { version: int ≥ 1 }` with the same refinements when both times present.
  - `createUnavailabilitySchema = { startAt, endAt }` refined `endAt > startAt`.
  - `createOfferSchema = { shiftId: uuid, kind: 'GIVE_AWAY' | 'OPEN_SHIFT' }`; `approveOfferSchema = { acceptanceId: uuid, version: int ≥ 1 }`; `versionSchema = { version: int ≥ 1 }`.
  - `ERROR_CODES` const tuple of the §24 codes plus `UNAUTHENTICATED` (401) and `INTERNAL` (500), and `type ErrorCode`; `type RuleCode` = the 8 rule codes; `RULE_LABELS: Record<RuleCode, string>` = `NOT_ACTIVE: 'Not an active member'`, `IS_OWNER: 'Already assigned to this shift'`, `MISSING_SKILL: 'Missing a required skill'`, `OVERLAP: 'Overlaps another shift'`, `UNAVAILABLE: 'Marked as unavailable'`, `MIN_REST: 'Less than the minimum rest between shifts'`, `DAILY_LIMIT: 'Over the daily hour limit'`, `WEEKLY_LIMIT: 'Over the weekly hour limit'`.
  - Response types: `ShiftDto { id, startAt, endAt, requiredSkillIds, assignedMembershipId, location, notes, version, openOfferId: string | null }`; `ShiftWriteResponse { shift: ShiftDto; warnings: RuleCode[] }`; `OfferSummaryDto { id, kind, status, expiresAt, version, shift: ShiftDto, originalOwnerMembershipId, myAcceptanceStatus: AcceptanceStatus | null, pendingCount: number }`; `RankedAcceptanceDto { id, membershipId, displayName, status, createdAt, score: { total, breakdown: { preference, headroom, swapLoad } } | null, recheck: { eligible: boolean; failedRules: RuleCode[] } }`; `OfferDetailDto = OfferSummaryDto & { acceptances: RankedAcceptanceDto[] }`; `MemberDto { id, displayName, accessLevel, status, hasLogin, skillIds, weeklyLimitMin }`; `SkillDto { id, name }`.
- [ ] **Step 1: Failing tests** — valid shift passes; end before start → issue path `['endAt']` message `End must be after start`; 17 h → `A shift can be at most 16 hours`; overnight 22:00→06:00 next day passes; `createOfferSchema` rejects `kind: 'TRADE'`; `RULE_LABELS` has exactly the 8 keys.
- [ ] **Step 2: Run** `npm test -w @shiftswap/shared` → FAIL.
- [ ] **Step 3: Implement**; build shared; add API dependency; `npm install` updates the lockfile.
- [ ] **Step 4: Run** shared tests, `npm run typecheck`, `npm run build -w @shiftswap/api` → PASS.
- [ ] **Step 5: Commit** — `feat(shared): add shift, offer and error schemas`

---

### Task 3: Pure time math and eligibility rules

**Files:**
- Create: `apps/api/src/matching/time.ts`, `apps/api/src/matching/eligibility.ts`, `apps/api/src/matching/types.ts`
- Modify: `apps/api/package.json` (`luxon`, `@types/luxon`)
- Test: `apps/api/src/matching/time.spec.ts`, `apps/api/src/matching/eligibility.spec.ts`

**Interfaces:**
- Produces (`types.ts`): `Interval { startAt: Date; endAt: Date }`; `ScheduledShift extends Interval { id: string }`; `OrgPolicy { timezone: string; defaultWeeklyLimitMin: number; minRestMin: number; maxDailyMin: number }`; `Candidate { id: string; status: 'ACTIVE' | 'DEACTIVATED'; hasLogin: boolean; skillIds: string[]; weeklyLimitMin: number | null }`; `TargetShift extends Interval { id: string; requiredSkillIds: string[]; assignedMembershipId: string | null }`; `EligibilityContext { org: OrgPolicy; candidate: Candidate; candidateShifts: ScheduledShift[]; unavailability: Interval[] }`; `EligibilityResult { eligible: boolean; failedRules: RuleCode[] }` (RuleCode from shared).
- Produces (`time.ts`): `durationMin(i: Interval): number`; `overlaps(a: Interval, b: Interval): boolean` (half-open `[start, end)`); `localDateKey(at: Date, tz: string): string` (`YYYY-MM-DD`); `weekKey(at: Date, tz: string): string` (ISO week of the org-local date, e.g. `2026-W44`); `weekWindow(at: Date, tz: string): Interval` (Monday 00:00 → next Monday 00:00 org-local, as UTC instants).
- Produces (`eligibility.ts`): `checkEligibility(ctx: EligibilityContext, shift: TargetShift): EligibilityResult` — evaluates all rules in the order of the RuleCode list, returns every failure. `candidateShifts` may contain the target shift; ignore any entry with `id === shift.id`. Weekly/daily sums include the target shift. `MIN_REST`: gap from the end of any earlier candidate shift to target start, and from target end to the start of any later one, must be ≥ `minRestMin` (overlaps are reported only as `OVERLAP`).

- [ ] **Step 1: Failing tests** (use `Europe/Berlin`, policy 660/600/2400, helper `at('2026-11-06T18:00')` = Berlin local):
  - `time.spec`: `durationMin` of 22:00→06:00 across 2026-10-25 (DST end) = 540; `localDateKey` of 2026-11-01 23:30 Berlin = `2026-11-01`; `weekKey` of Sunday 2026-11-01 23:30 = `2026-W44` and Monday 2026-11-02 00:00 = `2026-W45`; `weekWindow` start is Monday 00:00 Berlin.
  - `eligibility.spec`, base: active candidate with login and skill S, no other shifts, target Fri 18:00–23:00 requiring S → `{ eligible: true, failedRules: [] }`. Then one test per rule (each produces exactly that code): deactivated → `NOT_ACTIVE`; `hasLogin: false` → `NOT_ACTIVE`; candidate is assignee → `IS_OWNER`; lacks S → `MISSING_SKILL`; other shift 20:00–22:00 → `OVERLAP`; unavailability 17:00–19:00 → `UNAVAILABLE`; earlier shift ending 08:00 same day → `MIN_REST` (10 h gap); a later shift starting next day 09:00 → `MIN_REST`; same-day shift 05:00–07:00 + target 18:00–23:00 with policy `maxDailyMin: 360` → `DAILY_LIMIT` only (gap 11 h satisfies rest); weekly limit 600 with existing 8 h shift earlier in the week → `WEEKLY_LIMIT`; member `weeklyLimitMin: null` uses org default.
  - Overnight: target Sun 22:00–Mon 06:00 counts toward the Sunday's week (existing 36 h Mon–Sat that week + 8 h → `WEEKLY_LIMIT` with 2400; existing 36 h in the *next* week → eligible).
  - Multiple failures returned together (deactivated + missing skill → both).
  - Target shift present in `candidateShifts` with same id → not an `OVERLAP` with itself.
- [ ] **Step 2: Run** `npm test -w @shiftswap/api -- matching` → FAIL.
- [ ] **Step 3: Implement** with Luxon (`DateTime.fromJSDate(d, { zone })`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(api): add eligibility rules and timezone-aware time helpers`

---

### Task 4: Ranking and offer state machine

**Files:**
- Create: `apps/api/src/matching/ranking.ts`, `apps/api/src/offers/offer-state.ts`
- Test: `apps/api/src/matching/ranking.spec.ts`, `apps/api/src/offers/offer-state.spec.ts`

**Interfaces:**
- Produces: `type Preference = 'PREFERRED' | 'NEUTRAL' | 'AVOID'`; `scoreCandidate(input: { preference: Preference; weeklyMinutesAfter: number; weeklyLimitMin: number; swapsLast30Days: number }): { total: number; breakdown: { preference: number; headroom: number; swapLoad: number } }`; `rankByScore<T extends { createdAt: Date; score: { total: number } | null }>(items: T[]): T[]` (score desc, null scores last, tie → earlier `createdAt`).
- Produces: `class InvalidTransitionError extends Error { readonly code = 'INVALID_TRANSITION' }` (Task 5's filter maps it to 409); `assertOfferTransition(kind: OfferKind, from: OfferStatus, to: OfferStatus): void` throwing it, and `assertAcceptanceTransition(from: AcceptanceStatus, to: AcceptanceStatus): void`. Allowed: offer OPEN→APPROVED|REJECTED (GIVE_AWAY only), OPEN→FILLED (OPEN_SHIFT only), OPEN→CANCELLED|EXPIRED (both); acceptance PENDING→SELECTED|NOT_SELECTED|WITHDRAWN|INVALIDATED, WITHDRAWN→PENDING, INVALIDATED→PENDING; creation states: offer OPEN, acceptance PENDING (give-away) or SELECTED (claim).
- [ ] **Step 1: Failing tests**:
  - `scoreCandidate({ preference: 'NEUTRAL', weeklyMinutesAfter: 720, weeklyLimitMin: 2400, swapsLast30Days: 1 })` → `{ total: 63, breakdown: { preference: 20, headroom: 28, swapLoad: 15 } }`; PREFERRED → 40, AVOID → 0; headroom clamps at 0 when after > limit and 40 when 0; swapLoad 5 swaps → 0.
  - `rankByScore`: higher total first; equal totals → earlier createdAt first; null score last.
  - state machine: table-driven — every allowed pair passes; every other pair of the enums throws with `code === 'INVALID_TRANSITION'`; GIVE_AWAY OPEN→FILLED throws; OPEN_SHIFT OPEN→APPROVED throws.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add candidate ranking and offer state machine`

---

### Task 5: API foundations — errors, validation, tenancy guard, audit, directory endpoints

**Files:**
- Create: `apps/api/src/common/domain-error.ts`, `apps/api/src/common/error.filter.ts`, `apps/api/src/common/zod-body.pipe.ts`, `apps/api/src/tenancy/org.guard.ts`, `apps/api/src/tenancy/min-access.decorator.ts`, `apps/api/src/tenancy/org-context.decorator.ts`, `apps/api/src/tenancy/tenancy.module.ts`, `apps/api/src/audit/audit.service.ts`, `apps/api/src/audit/audit.module.ts`, `apps/api/src/directory/directory.controller.ts`, `apps/api/src/directory/directory.module.ts`, `apps/api/test/helpers/test-app.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.factory.ts` (register filter), `apps/api/src/me/me.controller.ts`
- Test: `apps/api/src/common/error.filter.spec.ts`, `apps/api/test/tenancy.e2e-spec.ts`

**Interfaces:**
- Produces: `class DomainError extends Error { constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) }` with status from a `STATUS_BY_CODE` map (§24); global `ErrorFilter` rendering `{ error: { code, message, details? } }` for `DomainError`, `InvalidTransitionError`, Nest `HttpException` (404 → `NOT_FOUND`, 403 → `FORBIDDEN`, 401 → keeps 401 code `UNAUTHENTICATED`), Prisma unique-violation `P2002` on `offers_one_open_per_shift` → `OFFER_ALREADY_OPEN`; unknown errors → 500 `INTERNAL` without leaking messages.
- Produces: `ZodBody(schema)` pipe → 400 `VALIDATION_FAILED` with `details.issues: { path, message }[]`.
- Produces: `OrgGuard` (requires `SessionGuard` first) reading `:orgId`, loading the ACTIVE membership of the session user → else `DomainError('NOT_FOUND')`; checks `@MinAccess('EMPLOYEE'|'MANAGER'|'ADMIN')` metadata (default EMPLOYEE) → else `FORBIDDEN`; sets `req.org: OrgContext = { orgId, membershipId, accessLevel, timezone, policy: OrgPolicy, leadTimeMin }`. `@Org()` param decorator returns it.
- Produces: `AuditService.record(tx: Prisma.TransactionClient, entry: { orgId: string; actorMembershipId: string | null; action: string; entityType: 'shift' | 'offer' | 'acceptance' | 'unavailability'; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }): Promise<void>`.
- Produces endpoints: `GET /api/v1/orgs/:orgId/members` (MANAGER) → `MemberDto[]` sorted by displayName, ACTIVE only; `GET /api/v1/orgs/:orgId/skills` (EMPLOYEE) → `SkillDto[]` sorted by name. `GET /api/v1/me` memberships gain `membershipId` and `organizationTimezone`.
- Produces test helper (`test/helpers/test-app.ts`): `createTestApp(): Promise<{ app; prisma; auth }>`; `makeOrg(prisma, opts?): Promise<{ orgId }>`; `makeMember(ctx, orgId, { accessLevel, name?, skillNames?, withLogin? = true }): Promise<{ membershipId; userId?; cookie? }>` — users via `auth.api.signUpEmail`, cookie via `auth.api.signInEmail({ body, returnHeaders: true })` (server-side, not rate-limited); `api(app, cookie)` supertest wrapper presetting `Origin: http://localhost:5173`.
- [ ] **Step 1: Failing tests** — `error.filter.spec`: DomainError('INELIGIBLE', …, { failedRules: ['OVERLAP'] }) → 422 body shape; P2002 on the partial index → 409 `OFFER_ALREADY_OPEN`; generic Error → 500 `{ error: { code: 'INTERNAL', message: 'Internal server error' } }`. `tenancy.e2e-spec`: member of org A → `GET /orgs/A/skills` 200; `GET /orgs/B/skills` 404 `NOT_FOUND`; non-uuid orgId 404; employee → `GET /orgs/A/members` 403 `FORBIDDEN`; manager → 200 with `hasLogin` false for a placeholder; deactivated membership → 404; no session → 401; `/me` includes `membershipId` + `organizationTimezone`.
- [ ] **Step 2–4: Run → FAIL, implement, run** (`npm test -w @shiftswap/api`, `npm run test:e2e -w @shiftswap/api`) **→ PASS.**
- [ ] **Step 5: Commit** — `feat(api): add tenancy guard, error format, audit service and directory endpoints`

---

### Task 6: Shifts API

**Files:**
- Create: `apps/api/src/shifts/shifts.controller.ts`, `apps/api/src/shifts/shifts.service.ts`, `apps/api/src/shifts/shift-mapper.ts`, `apps/api/src/shifts/shifts.module.ts`
- Test: `apps/api/test/shifts.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 5 guard/filter/pipe/audit; Task 3 `checkEligibility`; Task 8's loader is NOT available yet — compute assignment warnings with a private loader query in this service (single query for the assignee) and refactor to `EligibilityLoader` in Task 8.
- Produces endpoints (prefix `/api/v1/orgs/:orgId`):
  - `GET /shifts?from=ISO&to=ISO[&mine=true]` — `from`/`to` required, span ≤ 35 days else 400; EMPLOYEE may only use `mine=true` (else 403); MANAGER sees all; excludes soft-deleted; sorted by `startAt` → `ShiftDto[]` (with `openOfferId`).
  - `POST /shifts` (MANAGER, `createShiftSchema`) → 201 `ShiftWriteResponse`; skill/assignee IDs must belong to the org (else 404); `warnings` = `checkEligibility` failures for the assignee excluding `IS_OWNER` (non-blocking).
  - `PATCH /shifts/:shiftId` (MANAGER, `updateShiftSchema`) → 200 `ShiftWriteResponse`; `UPDATE … WHERE id AND version` else 409 `VERSION_CONFLICT`; `version` increments.
  - `DELETE /shifts/:shiftId?version=N` (MANAGER) → 204; soft delete (`deletedAt`), version check.
  - Produces `ShiftsService.findInOrg(orgId, shiftId)` (404 when deleted/other org) and the hook points `onShiftChanged` / `onShiftDeleted` left as no-ops to be filled in Task 10.
- Audit actions: `shift.created`, `shift.updated` (before/after of `startAt,endAt,assignedMembershipId,requiredSkillIds`), `shift.deleted`.
- [ ] **Step 1: Failing tests** — create with overnight times → 201; employee create → 403; range without `mine` as employee → 403; `mine=true` returns only own; 36-day range → 400; PATCH with stale version → 409 `VERSION_CONFLICT`; PATCH by two parallel requests with the same version → exactly one 200 + one 409; DELETE then GET range excludes it; assigning a member lacking the skill → 201 with `warnings: ['MISSING_SKILL']`; skill ID from another org → 404; audit row written per write (count + action names).
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add shifts API with optimistic locking and assignment warnings`

---

### Task 7: Unavailability API

**Files:**
- Create: `apps/api/src/availability/unavailability.controller.ts`, `apps/api/src/availability/availability.module.ts`
- Test: `apps/api/test/unavailability.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /api/v1/orgs/:orgId/me/unavailability` → `{ id, startAt, endAt }[]` (own, ending in the future, sorted); `POST` (`createUnavailabilitySchema`) → 201; `DELETE /me/unavailability/:id` → 204 (own only, else 404). Audit `unavailability.created` / `.deleted`. No reason field (SDD §27).
- [ ] **Step 1: Failing tests** — create/list/delete own; deleting someone else's id → 404; end before start → 400; past entries not listed.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add unavailability API`

---

### Task 8: Eligibility loader (one batched query set)

**Files:**
- Create: `apps/api/src/matching/eligibility-loader.ts`, `apps/api/src/matching/matching.module.ts`
- Modify: `apps/api/src/shifts/shifts.service.ts` (use the loader for warnings)
- Test: `apps/api/test/eligibility-loader.e2e-spec.ts`

**Interfaces:**
- Produces: `EligibilityLoader.load(db: PrismaClient | Prisma.TransactionClient, org: OrgContext, shift: TargetShift, membershipIds?: string[]): Promise<Map<string, { ctx: EligibilityContext; swapsLast30Days: number; weeklyMinutes: number }>>` — when `membershipIds` omitted, all ACTIVE memberships of the org. Exactly 4 queries regardless of member count: memberships+skills; non-deleted assigned shifts of those members within `[weekWindow.start − 1 day, weekWindow.end + 1 day)`; unavailability overlapping that window; count of `SELECTED` acceptances per member with `updatedAt ≥ now − 30 days`. `weeklyMinutes` = minutes of the member's shifts starting in the target's week, excluding the target.
- Produces: `EligibilityLoader.toTargetShift(row): TargetShift`.
- [ ] **Step 1: Failing tests** — seeded org with 30 members → `load` issues ≤ 4 queries (count via Prisma `$on('query')` or a query-counting extension) and completes < 200 ms; returns NOT_ACTIVE for placeholder via `checkEligibility`; shift two weeks away does not count toward weekly minutes; deleted shifts ignored.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add batched eligibility loader`

---

### Task 9: Offers API — create, list, detail, accept, withdraw, claim, cancel, lazy expiry

**Files:**
- Create: `apps/api/src/offers/offers.controller.ts`, `apps/api/src/offers/offers.service.ts`, `apps/api/src/offers/offer-locks.ts`, `apps/api/src/offers/offer-views.ts`, `apps/api/src/offers/offers.module.ts`
- Test: `apps/api/test/offers.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces `offer-locks.ts`: `lockOffer(tx, orgId, offerId)`, `lockShift(tx, orgId, shiftId)`, `lockMembership(tx, orgId, membershipId)` — each `SELECT … FOR UPDATE` scoped by `organization_id`, 404 if missing. Callers must lock in order offer → shift → membership.
- Produces `OffersService.expireIfDue(orgId, offerId, now): Promise<boolean>` — own transaction; OPEN and `now ≥ expiresAt` → EXPIRED, PENDING acceptances → NOT_SELECTED, audit `offer.expired`. Every write below calls it first and throws `OFFER_EXPIRED` if it returns true.
- Produces endpoints (prefix `/api/v1/orgs/:orgId/offers`):
  - `POST /` (`createOfferSchema`): GIVE_AWAY — caller must be the shift's assignee (else 403), shift not deleted, `now < start − lead` (else 409 `OFFER_EXPIRED`); OPEN_SHIFT — MANAGER only, shift unassigned (else 409 `INVALID_TRANSITION`). Second open offer → 409 `OFFER_ALREADY_OPEN`. 201 `OfferSummaryDto`. Audit `offer.created`.
  - `GET /?scope=eligible|mine|review` — `eligible`: OPEN offers (both kinds) where the caller is not the assignee and `checkEligibility` passes now; `mine`: offers where caller is original owner or has an acceptance, created in the last 30 days; `review` (MANAGER): OPEN GIVE_AWAY offers with `pendingCount`. Sorted by shift start.
  - `GET /:offerId` — MANAGER: `OfferDetailDto` with acceptances ranked by `rankByScore` (score null + `recheck.eligible=false` for ineligible ones; preference = NEUTRAL); involved employee: summary + own acceptance only; others 404.
  - `POST /:offerId/acceptances` (GIVE_AWAY only, else 409 `INVALID_TRANSITION`): tx lock offer → shift → caller membership; check eligibility (fail → 422 `INELIGIBLE` with `failedRules`); upsert on `(offerId, membershipId)`: none → PENDING 201; PENDING → 200 same row (idempotent retry); WITHDRAWN/INVALIDATED → PENDING 200. Audit `acceptance.created`/`acceptance.reactivated`.
  - `DELETE /:offerId/acceptances/me` — PENDING → WITHDRAWN, 204; none → 404.
  - `POST /:offerId/claim` (OPEN_SHIFT only): tx lock offer (status must be OPEN else 409 `OFFER_ALREADY_FILLED`) → shift → caller; eligibility (422); assign shift, `version`++, offer FILLED + `selectedAcceptanceId`, acceptance row SELECTED; 200 `OfferSummaryDto`. Audit `offer.filled`.
  - `POST /:offerId/cancel` (`versionSchema`): GIVE_AWAY by original owner (`cancelReason 'WITHDRAWN'`) or MANAGER (`'MANAGER'`); OPEN_SHIFT by MANAGER; version check; PENDING → NOT_SELECTED. Audit `offer.cancelled`.
- [ ] **Step 1: Failing tests** (fixture: org Berlin, manager Tom, employees Anna/Lukas/Mia with skill Service, shift for Anna in 3 days 18:00–23:00):
  - Anna creates give-away → 201; Lukas creates give-away on Anna's shift → 403; second offer → 409 `OFFER_ALREADY_OPEN`; offer on shift starting in 60 min → 409 `OFFER_EXPIRED`.
  - Lukas `scope=eligible` sees it, Anna does not; Lukas accepts → 201 PENDING; repeat → 200 same id; withdraw → 204; accept again → 200 PENDING.
  - Lukas with an overlapping shift accepts → 422 `INELIGIBLE` `details.failedRules` contains `OVERLAP`.
  - Manager detail lists acceptances with `score.breakdown.preference === 20` and ranking order by total.
  - Open shift: employee posting → 403; manager posts → 201; **two parallel claims** (`Promise.all`) by Lukas and Mia → exactly one 200, one 409 `OFFER_ALREADY_FILLED`; shift assigned to the winner; exactly one SELECTED acceptance.
  - Offer whose `expiresAt` is set in the past (update row directly) → accept → 409 `OFFER_EXPIRED` and the offer is now EXPIRED.
  - Cancel by Anna → CANCELLED with reason WITHDRAWN; stale version → 409 `VERSION_CONFLICT`.
  - Audit rows exist for each transition.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add offers API for give-aways, open shifts and acceptances`

---

### Task 10: Approve/reject, shift-change side effects, expiry scheduler, concurrency suite

**Files:**
- Create: `apps/api/src/offers/offer-lifecycle.ts`, `apps/api/src/offers/expiry.scheduler.ts`
- Modify: `apps/api/src/offers/offers.controller.ts`, `apps/api/src/offers/offers.service.ts`, `apps/api/src/shifts/shifts.service.ts`, `apps/api/src/app.module.ts` (`ScheduleModule.forRoot()` unless `NODE_ENV === 'test'`), `apps/api/package.json` (`@nestjs/schedule`)
- Test: `apps/api/test/offers-approval.e2e-spec.ts`, `apps/api/test/concurrency.e2e-spec.ts`, `apps/api/src/offers/expiry.scheduler.spec.ts`

**Interfaces:**
- Produces endpoints: `POST /api/v1/orgs/:orgId/offers/:offerId/approve` (MANAGER, `approveOfferSchema`) and `/reject` (MANAGER, `versionSchema`).
  - Approve tx: lazy expiry; lock offer (OPEN, GIVE_AWAY, `version` match else 409 `VERSION_CONFLICT`) → lock shift → lock candidate membership; acceptance must be PENDING on this offer (else 409 `INVALID_TRANSITION`); self-approval: approver is the original owner → allowed only if the org has exactly one ACTIVE MANAGER/ADMIN membership, else 403 `SELF_APPROVAL_FORBIDDEN`, audit `metadata.selfApproved = true`; re-check eligibility (target shift's assignee is still the owner, so `IS_OWNER` does not apply to the candidate); fail → acceptance INVALIDATED with `invalidatedReason = { code: 'RECHECK_FAILED', failedRules }`, **commit**, respond 422 `INELIGIBLE`; pass → shift `assignedMembershipId = candidate`, `version`++; offer APPROVED + `selectedAcceptanceId` + `resolvedBy/At`, `version`++; acceptance SELECTED; other PENDING → NOT_SELECTED; audit `offer.approved`. 200 `OfferDetailDto`.
  - Reject: offer REJECTED, PENDING → NOT_SELECTED; owner keeps the shift; audit `offer.rejected`.
- Produces `OfferLifecycle.onShiftChanged(tx, orgId, shiftId, change: { timesOrSkillsChanged: boolean; assigneeChanged: boolean; newStartAt: Date })` and `onShiftDeleted(tx, orgId, shiftId)`; ShiftsService calls them inside its write transaction:
  - times/skills changed → PENDING acceptances INVALIDATED `{ code: 'SHIFT_CHANGED' }`, offer `expiresAt` recomputed; offer stays OPEN.
  - assignee changed while an offer is OPEN → offer CANCELLED `cancelReason 'SHIFT_REASSIGNED'`, PENDING → NOT_SELECTED.
  - deleted → offer CANCELLED `'SHIFT_DELETED'`, PENDING → NOT_SELECTED.
  - notes/location only → nothing.
- Produces `ExpiryScheduler` (`@Interval(5 * 60 * 1000)`) calling `OffersService.expireDue(now)` = `UPDATE offers SET status='EXPIRED' … WHERE status='OPEN' AND expires_at <= now RETURNING id` + PENDING→NOT_SELECTED + audit per offer; returns the count; logs `{ expired: n }` only.
- [ ] **Step 1: Failing tests**:
  - Approve happy path (Tom approves Lukas): shift now Lukas's; Mia's acceptance NOT_SELECTED; Anna's `scope=mine` shows APPROVED.
  - Stale version → 409; approve non-pending acceptance → 409 `INVALID_TRANSITION`; employee approve → 403.
  - Candidate gained an overlapping shift after accepting → approve → 422, acceptance INVALIDATED with `RECHECK_FAILED`, shift still Anna's.
  - Self-approval: Tom offers his own shift, second manager exists → 403 `SELF_APPROVAL_FORBIDDEN`; with Tom as the only manager/admin → 200 and audit metadata `selfApproved: true`.
  - Reject → REJECTED, shift stays Anna's.
  - Shift side effects: PATCH time → acceptances INVALIDATED `SHIFT_CHANGED`, offer OPEN, `expiresAt` moved; PATCH notes only → untouched; PATCH assignee → offer CANCELLED `SHIFT_REASSIGNED`; DELETE → CANCELLED `SHIFT_DELETED`.
  - `concurrency.e2e-spec`: (a) two managers approve different candidates of one offer in parallel → one 200, one 409, exactly one SELECTED; (b) **Lukas accepted on two overlapping give-aways; both approved in parallel → one 200, the other 422 `INELIGIBLE` (`OVERLAP`); Lukas assigned to exactly one** (Review Focus 2); (c) `expireDue` racing an approve on the same offer → final state is exactly one of APPROVED or EXPIRED, never both side effects.
  - `expiry.scheduler.spec` (unit, mocked service): interval handler calls `expireDue` once per tick and swallows/logs errors.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(api): add approval, shift side effects and offer expiry`

---

### Task 11: Tenancy and permission sweep for all new endpoints

**Files:**
- Test: `apps/api/test/tenancy-sweep.e2e-spec.ts`

**Interfaces:**
- Consumes all endpoints from Tasks 5–10.
- [ ] **Step 1: Write the sweep** — fixture: org A (manager + employee), org B (manager + employee + shift + open offer + acceptance). Table-driven list of every org-scoped route with method, path template, body builder. Assertions: org-A manager calling every route with org B's `orgId` → 404; org-A manager calling org-A routes with **org B entity IDs** in path or body (`shiftId`, `offerId`, `acceptanceId`, `requiredSkillIds`, `assignedMembershipId`) → 404; org-A employee on every MANAGER route → 403; no cookie → 401. The route list must equal the controllers' registered routes (enumerate via Nest's `HttpAdapter` router or a hard-coded list plus a test that compares it against `app.getHttpAdapter().getInstance()._router` paths under `/api/v1/orgs`), so new routes can't skip the sweep.
- [ ] **Step 2: Run** → any failure is a real bug: fix it in the owning service (one commit per fix, `fix(api): …`).
- [ ] **Step 3: Run** full API e2e → PASS.
- [ ] **Step 4: Commit** — `test(api): add cross-tenant and permission sweep`

---

### Task 12: Demo seed — skills, a week of shifts, one give-away, one open shift

**Files:**
- Modify: `apps/api/src/seed/demo-data.ts`, `apps/api/src/seed/seed-demo.ts`, `DEMO_ACCOUNTS.md`, `README.md`
- Test: `apps/api/test/seed-demo.e2e-spec.ts`, `apps/api/src/seed/demo-data.spec.ts`

**Interfaces:**
- Produces `DEMO_SKILLS`, `DEMO_MEMBER_SKILLS`, `DEMO_SHIFTS` (relative: `{ key, org, dayOffset, start 'HH:mm', end 'HH:mm', skills, assignee: email | placeholder name | null }`), `DEMO_OFFERS`, and `demoInstant(today: DateTime, dayOffset, 'HH:mm', tz): Date` (end ≤ start → next day). `seedDemo` return type gains `skills, shifts, offers, acceptances` counts.
- Exact data (org-local `Europe/Berlin`, `d0` = today):
  - Skills — Café Lindenhof: Barista, Service, Kitchen; Hotel Seeblick: Front desk.
  - Member skills — Maria: Barista, Service, Kitchen; Tom: Barista, Service, Kitchen; Anna: Barista, Service; Lukas: Barista, Service (+ Front desk at Seeblick); Mia: Service; Paul Weber: Kitchen; Sara: Front desk.
  - Shifts — Lindenhof: L1 d1 07:00–13:00 Barista Anna; L2 d1 13:00–19:00 Service Mia; L3 d2 07:00–13:00 Barista *unassigned*; L4 d2 17:00–23:00 Service Lukas; L5 d3 18:00–23:00 Service Anna; L6 d4 07:00–15:00 Kitchen Paul Weber; L7 d5 10:00–16:00 Barista+Service Tom; L8 d6 22:00–06:00 Service Mia. Seeblick: S1 d3 08:00–14:00 Front desk Lukas; S2 d4 14:00–22:00 Front desk Sara.
  - Offers — GIVE_AWAY on L5 by Anna (OPEN) with acceptances Lukas PENDING (created first) and Mia PENDING; OPEN_SHIFT on L3 by Tom (OPEN). `expiresAt` = start − 120 min.
  - Counts: users 6, organizations 2, memberships 8, skills 4, shifts 10, offers 2, acceptances 2.
- [ ] **Step 1: Failing tests** — counts above; seeding twice → same counts; through the real loader: Lukas is NOT eligible for L3 with `DAILY_LIMIT` (6 h + L4 6 h = 12 h > 10 h), Anna IS eligible for L3, Lukas and Mia ARE eligible for L5; every seeded shift starts after the seeding time; `demoInstant` handles a DST day.
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.** Update DEMO_ACCOUNTS.md/README "Try it" with a 2-minute demo script: (1) log in as Tom → Offer review → open Anna's offer → see each candidate's score breakdown → approve Lukas; (2) log in as Lukas → Open offers does not list the Barista open shift (it would put him over the daily hour limit); (3) log in as Anna → Open offers → claim the Barista shift.
- [ ] **Step 5: Commit** — `feat(api): seed demo shifts, skills and offers`

---

### Task 13: Web — org layout, API client, My Shifts, Open Offers, Availability

**Files:**
- Create: `apps/web/src/features/org/OrgLayout.tsx`, `apps/web/src/features/org/useOrg.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/error-messages.ts`, `apps/web/src/components/StatusBadge.tsx`, `apps/web/src/features/shifts/MyShiftsPage.tsx`, `apps/web/src/features/offers/OpenOffersPage.tsx`, `apps/web/src/features/availability/AvailabilityPage.tsx`, shadcn `dialog`/`select`/`table` components as needed
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/router.tsx`, `apps/web/src/features/orgs/OrgPickerPage.tsx`
- Test: `*.test.tsx` next to each page, `apps/web/src/lib/format.test.ts`, `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Produces `apiSend<T>(method: 'POST'|'PATCH'|'DELETE', path: string, body?: unknown): Promise<T>`; `ApiError` gains `code?: ErrorCode` and `details?: Record<string, unknown>` parsed from the error body.
- Produces `errorMessage(err: unknown): string` — `INELIGIBLE` → "You can't take this shift: " + `RULE_LABELS` joined by ", "; `OFFER_ALREADY_FILLED` → "Someone else claimed this shift first."; `OFFER_EXPIRED` → "This offer has expired."; `VERSION_CONFLICT` → "This was changed by someone else. The page has been refreshed."; `OFFER_ALREADY_OPEN` → "This shift is already offered."; `SELF_APPROVAL_FORBIDDEN` → "Another manager has to approve your own shift."; default → "Something went wrong. Please try again."
- Produces `formatShiftTime(startAt, endAt, timezone): string` e.g. `Fri 6 Nov, 18:00–23:00` and `Sun 8 Nov, 22:00–06:00 (+1)` using `Intl.DateTimeFormat('en-GB', { timeZone })`.
- Routes (all under `RequireAuth` → `OrgLayout` which loads `/api/v1/me`, picks the membership for `:orgId`, 404 page if not a member): `/orgs/:orgId` → redirect `me/shifts`; `/orgs/:orgId/me/shifts`; `/orgs/:orgId/offers`; `/orgs/:orgId/me/availability`; manager-only nav items added in Task 14. Nav: "My shifts", "Open offers", "Availability", org name + "Switch organisation" link, "Log out".
- Screens (SDD §12):
  - My Shifts: next 14 days `GET /shifts?mine=true`; each row: time, skills, location, offer status badge; "Offer this shift" button (hidden when an offer is open or start − 2 h passed) → confirm dialog → `POST /offers`; "Withdraw offer" for own OPEN give-away → `POST /offers/:id/cancel`. Section "My offers" from `scope=mine` with status badges (text, not colour only).
  - Open Offers: `scope=eligible`; give-away rows → "Accept" / "Withdraw acceptance" (based on `myAcceptanceStatus`); open-shift rows → "Claim". Errors shown via `errorMessage` in an `role="alert"` region; success via `aria-live="polite"`. After every mutation invalidate `['offers']` and `['shifts']` queries.
  - Availability: list + form (start/end `datetime-local`, labels "From"/"Until") → POST; delete per row; caption "Unavailable times are hard blocks: you won't be offered shifts that overlap them."
- [ ] **Step 1: Failing tests** — `api.test`: error body parsed into `code`/`details`; `format.test`: overnight `(+1)`, Berlin DST; MyShiftsPage: renders shifts, "Offer this shift" posts `{ shiftId, kind: 'GIVE_AWAY' }`; OpenOffersPage: Accept posts to acceptances; 422 shows "You can't take this shift: Overlaps another shift"; 409 filled shows "Someone else claimed this shift first."; Claim button for open shifts; AvailabilityPage: labelled inputs, end-before-start shows "End must be after start"; OrgLayout: non-member org id shows "Organisation not found".
- [ ] **Step 2–4: Run → FAIL, implement, run** (`npm test -w @shiftswap/web`, typecheck, lint, build) **→ PASS.**
- [ ] **Step 5: Commit** — `feat(web): add org layout, my shifts, open offers and availability`

---

### Task 14: Web — Schedule grid and Offer Review (manager)

**Files:**
- Create: `apps/web/src/features/schedule/SchedulePage.tsx`, `apps/web/src/features/schedule/ShiftDialog.tsx`, `apps/web/src/features/schedule/week.ts`, `apps/web/src/features/review/OfferReviewPage.tsx`, `apps/web/src/features/review/OfferReviewDetail.tsx`
- Modify: `apps/web/src/router.tsx`, `apps/web/src/features/org/OrgLayout.tsx` (manager nav "Schedule", "Offer review")
- Test: `SchedulePage.test.tsx`, `ShiftDialog.test.tsx`, `OfferReviewPage.test.tsx`, `week.test.ts`

**Interfaces:**
- Produces `weekParam(date, tz): string` (`2026-W45`) and `weekRange(param, tz): { from: Date; to: Date; days: string[] }` (`week.ts`).
- Routes: `/orgs/:orgId/schedule?week=YYYY-Www` and `/orgs/:orgId/review[/:offerId]`; employees hitting them see "Only managers can see this page." (the API also returns 403).
- Schedule: `<table>` with `<caption>` "Week of …", column headers = 7 days, row headers = members (`GET /members`) plus an "Unassigned" row; each cell lists shift buttons (`time · skills`, badge "Offered" / "Open shift"); "Previous week"/"Next week" links update `?week=`; "New shift" opens `ShiftDialog`. No drag-and-drop.
- `ShiftDialog` (Radix dialog, focus trapped and restored): fields Date, Start, End (end ≤ start means next day, hint text "Ends next day"), Skills (checkbox group), Assignee (select incl. "Unassigned"), Location, Notes; create → `POST /shifts`; edit → `PATCH` with `version`; "Delete shift" → `DELETE`; after save shows returned `warnings` as a non-blocking notice "Saved. Heads-up: " + labels + " (company policy check)"; for unassigned shifts a "Post as open shift" checkbox on create → after `POST /shifts` call `POST /offers { kind: 'OPEN_SHIFT' }`. `VERSION_CONFLICT` → message + refetch.
- Offer Review: list (`scope=review`) with shift time, owner, pending count; detail (`GET /offers/:id`): acceptances ordered as returned, each showing name, "Score 83 — Preference +20 · Headroom +28 · Swap load +15", and "Not eligible now: …" when `recheck.eligible` is false (Approve disabled for those); buttons "Approve {name}" → `POST approve { acceptanceId, version }`, "Reject offer" → `POST reject { version }`; on 422/409 show `errorMessage` and refetch (Review Focus 3).
- [ ] **Step 1: Failing tests** — `week.test`: Sunday 23:30 Berlin belongs to the Monday-start week; SchedulePage renders a table with 7 column headers and member row headers, shift in the right cell, overnight shift in its start day; ShiftDialog: labels present, end ≤ start shows "Ends next day", submit posts ISO instants for the org timezone, warnings rendered; OfferReview: breakdown text exact, ineligible acceptance has disabled Approve with reason, approve posts `{ acceptanceId, version }`, 409 shows "This was changed by someone else. The page has been refreshed."
- [ ] **Step 2–4: Run → FAIL, implement, run → PASS.**
- [ ] **Step 5: Commit** — `feat(web): add schedule grid and offer review`

---

### Task 15: End-to-end demo flows in CI

**Files:**
- Create: `e2e/tests/swap-flow.spec.ts`
- Modify: `e2e/tests/login.spec.ts` (shared sign-in helper extracted to `e2e/tests/helpers.ts`, keeping the rate-limit pacing), `README.md` (screens list)

**Interfaces:**
- Consumes seeded demo data (Task 12) on the CI stack; tests run serially after `login.spec.ts`.
- [ ] **Step 1: Write the E2E tests**:
  - "Tom approves Lukas for Anna's give-away": log in as tom → Offer review → open the Anna offer → both Lukas and Mia listed with "Score" text → click "Approve Lukas Wolf" → status "Approved"; log in as lukas → My shifts contains the d3 18:00–23:00 shift.
  - "Lukas is not offered the Barista open shift" (daily limit; runs before the claim test): log in as lukas → Open offers does not list it.
  - "Anna claims the open Barista shift": log in as anna → Open offers → "Claim" on the Barista open shift → success text; My shifts shows it.
  - axe: zero serious/critical on My shifts, Open offers, Schedule, Offer review.
- [ ] **Step 2: Push** the branch, open a PR to `main` (`GH_TOKEN=$(gh auth token -u Bashlenix) gh pr create --repo Bashlenix/ShiftSwap …`, English body, no attribution), and iterate until `checks`, `stack-smoke` and `zero-setup` are green.
- [ ] **Step 3: Commit** — `test(e2e): cover give-away approval and open-shift claim`
