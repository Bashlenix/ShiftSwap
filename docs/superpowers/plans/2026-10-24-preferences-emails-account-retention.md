# Preferences, Swap Emails, Account Deletion and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining SDD "Should" features except CSV: the 7×3 preference grid feeding the ranking (FR-19), email for swap events (FR-20), self-service account deletion with anonymisation (FR-23) and the nightly retention purge (FR-24), plus the small items parked in Plan 3.

**Architecture:**
- **Preferences:** stored in a new `preferences` table. The eligibility loader reads them inside its existing members query, so it still makes 4 queries, and passes a per-candidate preference to `scoreCandidate`.
- **Swap emails:** the `notifications` table doubles as the email outbox (a list of emails waiting to be sent). A new nullable `email_dispatched_at` column marks rows still waiting.
  - A dispatcher claims pending rows with `FOR UPDATE SKIP LOCKED`, marks them, commits, then sends. Claiming before sending means each email goes out at most once and is never retried.
  - Two triggers run the dispatcher: an interceptor after each successful write request, and a 60-second scheduler for rows the expiry job writes.
- **Account deletion:** reuses `DeactivationService` per membership, then anonymises the user in one final transaction.
- **Retention:** a `RetentionService` purges by cutoff from a nightly cron.

**Tech Stack:**
- API: NestJS 11, Prisma 7 (pg adapter, raw SQL for locks), PostgreSQL 17, `@nestjs/schedule`, nodemailer → Mailpit, luxon.
- Web: React 19 + Vite, TanStack Query, Radix/shadcn, Vitest + Testing Library.
- E2E: Playwright + axe.
- Shared: Zod 4 in `packages/shared`.

**Spec:** `docs/sdd.md` (binding): §5, §6 FR-19/20/23/24, §14, §18 (ranking, preference slots), §19, §23, §27, §33, §35.

## Global Constraints

**Scope**
- Out of scope: CSV import/export (Plan 5), org deletion grace flow (Could), notification batching (SDD §38 lists it as out of scope).
- Demo data still resets on every API start.

**Preferences** (SDD §14, §18, §33)
- Weekday `0` = Monday … `6` = Sunday.
- Slots in org-local time: `MORNING` 05:00–12:00, `AFTERNOON` 12:00–17:00, `EVENING` 17:00–05:00.
- Only non-neutral rows are stored (`PREFERRED` / `AVOID`). An absent row means neutral.
- The weekday used is the shift's org-local start date.
- The preference of a shift is the worst value over the slots it touches (AVOID < neutral < PREFERRED), scored 0 / 20 / 40.
- The grid is a table of radio groups, not clickable coloured cells.

**Email** (SDD §23)
- The email types are every `NotificationType` except `MEMBER_DEACTIVATED`, which stays in-app only.
- Emails are sent only for committed notification rows. A rolled-back transaction sends nothing.
- No retry. A failure is logged at `warn` with `{ kind, recipientMembershipId }` only, never the address.
- Recipients are only ACTIVE memberships whose user exists and is not deleted.
- Templates are plain HTML plus a text alternative, with a deep link.
- The copy is the same `notificationText` the in-app list uses.

**Deep-link base**
- In priority order: the last trusted `x-app-origin` header seen, then `resolveBaseUrl(env)`, then `http://localhost:5173`.
- The header is accepted only if `isTrustedOrigin(value, process.env)`.

**Account deletion** (SDD §27, §35)
- Sessions and credential accounts are deleted.
- The user row is anonymised:
  - name `Deleted user`;
  - email `deleted-<userId>@deleted.invalid`, because `users.email` is unique and non-null;
  - `emailVerified` false, `image` null, `deletedAt` = now.
- All memberships are deactivated through the FR-15 conversion. Every membership of the user gets `displayName` `Deleted user` and `email` null.
- Invite emails of those memberships are replaced by the same tombstone.
- If the user is the last ACTIVE admin of any org → 409 `LAST_ADMIN`, `details.organizationIds`, and nothing changes.

**Retention** (SDD §27)
- 24 months: shifts by `end_at` (soft-deleted or not), with their offers, acceptances and skill rows; audit logs by `created_at`.
- 90 days: notifications by `created_at`.
- 30 days after they end: unavailability by `end_at`.
- Cutoffs are strict `<`.
- Runs nightly at 03:00 UTC.
- Only this job deletes audit rows.

**Unchanged from Plans 2–3**
- Tenancy via `OrgGuard`. Every new org route joins the tenancy sweep.
- Error body `{error:{code,message,details}}`.
- Audit rows are written in the transaction and hold IDs and scheduling fields only.
- Global lock order: invites → offers → shifts → memberships → skills.
- Logs hold IDs only.
- WCAG 2.2 AA.
- Git: commit as Bashlenix, push to `git@github-personal:Bashlenix/ShiftSwap.git`, and run gh commands with `GH_TOKEN=$(gh auth token -u Bashlenix)`. Never run `gh auth switch`.
- No local Docker image builds. CI runs via the PR or workflow_dispatch.
- English commits. No Claude/Anthropic attribution.

## Review Focus

1. **Overnight or multi-slot shift.** Sat 22:00–Sun 06:00 counts Saturday EVENING and Saturday MORNING (the weekday comes from the start date), and the worst value wins. Owner: Task 2 tests.
2. **Recipient gone before dispatch.** A notification whose recipient is deactivated or whose account is deleted before dispatch is never emailed, and its row is still marked dispatched. Owner: Task 5 test.
3. **Overlapping dispatchers.** The interceptor and the scheduler dispatch at the same time; each email is sent exactly once. Owner: Task 5 test (`Promise.all`).
4. **Last admin in one org, employee in another.** Account deletion → 409 `LAST_ADMIN`, and memberships, shifts and offers in both orgs are unchanged. Owner: Task 6 test.
5. **Exact retention boundaries.** A row exactly 24 months, 90 days or 30 days old is kept; one millisecond older is purged. Owner: Task 8 tests.

---

### Task 1: Preference storage and API

**Files:**
- Create: `packages/shared/src/preferences.ts`, `packages/shared/src/preferences.test.ts`
- Modify: `packages/shared/src/index.ts` (export it)
- Modify: `apps/api/prisma/schema.prisma`
- Create: the migration `apps/api/prisma/migrations/<ts>_preferences/migration.sql`
- Create: `apps/api/src/availability/preferences.controller.ts`
- Modify: `apps/api/src/availability/availability.module.ts`
- Test: `apps/api/test/preferences.e2e-spec.ts`, `apps/api/test/tenancy-sweep.e2e-spec.ts`

**Interfaces:**
- Produces (shared):
  - `PREFERENCE_SLOTS = ['MORNING','AFTERNOON','EVENING'] as const`
  - `PREFERENCE_VALUES = ['PREFERRED','AVOID'] as const`
  - types `PreferenceSlot`, `PreferenceValue`, `PreferenceEntry {weekday:number; slot; value}`, `PreferenceGridDto {entries: PreferenceEntry[]}`
  - `preferenceGridSchema`
- Produces (DB): Prisma model `Preference` (`preferences`) with:
  - `organizationId`, `membershipId`, `weekday Int`, `slot PreferenceSlot`, `value PreferenceValue`, `updatedAt`;
  - `@@id([membershipId, weekday, slot])`;
  - FKs `onDelete: Restrict`;
  - the SQL-only check `preferences_weekday_range CHECK (weekday BETWEEN 0 AND 6)`, with a schema comment like the existing SQL-only constraints.
- Produces (API): `GET` and `PUT /api/v1/orgs/:orgId/me/preferences`, both returning `PreferenceGridDto`. Entries are sorted by weekday, then slot in `PREFERENCE_SLOTS` order.

- [ ] **Step 1: Write the failing shared tests.** In `preferences.test.ts`:
  - `{entries: []}` and a full 21-entry grid parse;
  - a duplicate `(weekday, slot)` fails with issue path `['entries']`;
  - `weekday: 7`, `weekday: 1.5`, `value: 'NEUTRAL'` and an unknown key each fail;
  - 22 entries fail.
- [ ] **Step 2: Implement `preferenceGridSchema`.** Use `z.object({ entries: z.array(entry).max(21) }).strict()` and a `superRefine` for duplicates. Match the style of `people.ts`. Run `npm test -w packages/shared` → PASS.
- [ ] **Step 3: Add the model, enums and migration.** Create the migration with the same command and database Plan 3 Task 1 used (`docs/superpowers/plans/2026-10-24-people-and-notifications.md`). Add the CHECK by hand to `migration.sql`.
- [ ] **Step 4: Write the failing e2e tests** in `preferences.e2e-spec.ts`:
  - a new member's GET returns `{entries: []}`;
  - PUT of 3 entries → 200, and GET returns them sorted;
  - a second PUT with 1 entry replaces all three;
  - an invalid body → 400 `VALIDATION_FAILED`;
  - member A's grid is not visible to member B in the same org;
  - after the PUT, one audit row exists with `action 'preferences.updated'`, `entityType 'membership'`, `entityId` = the caller's membership, and `before`/`after` = `{entries}`.
- [ ] **Step 5: Implement `PreferencesController`** at `orgs/:orgId/me/preferences`. Guards: `SessionGuard`, `OrgGuard`, any access level. PUT does `deleteMany` + `createMany` + audit in one transaction. Register it in `AvailabilityModule`.
- [ ] **Step 6: Add both routes to the tenancy sweep** with org-B parameters. Run `npm run test:e2e -w apps/api -- preferences tenancy-sweep` → PASS.
- [ ] **Step 7: Commit:** `feat: store weekly preferences per member`

### Task 2: Preference in the ranking, seeded demo preferences

**Files:**
- Create: `apps/api/src/matching/preference.ts`, `apps/api/src/matching/preference.spec.ts`
- Modify: `apps/api/src/matching/eligibility-loader.ts`, `apps/api/src/offers/offers.service.ts` (in `rank()`, stop hard-coding `'NEUTRAL'`)
- Modify: `apps/api/src/seed/demo-data.ts`, `apps/api/src/seed/seed-demo.ts`, `apps/api/src/seed/demo-data.spec.ts`
- Test: `apps/api/test/eligibility-loader.e2e-spec.ts`, `apps/api/test/seed-demo.e2e-spec.ts`

**Interfaces:**
- Consumes: `PreferenceEntry` and `PreferenceSlot` (Task 1), and `Preference` from `matching/ranking.ts`.
- Produces:
  - `slotOf(localHour: number): PreferenceSlot`
  - `touchedSlots(shift: Interval, tz: string): PreferenceSlot[]`: distinct slots, in the order first touched.
  - `preferenceForShift(entries: readonly PreferenceEntry[], shift: Interval, tz: string): Preference`
  - `LoadedCandidate.preference: Preference`
  - `DEMO_PREFERENCES: { member: string; org: DemoOrgKey; slot: PreferenceSlot; value: PreferenceValue; weekdays: number[] }[]`

- [ ] **Step 1: Write the failing unit tests** in `preference.spec.ts`. All times are Europe/Berlin; the dates are a Wednesday and a Saturday in November 2026. Each case is `{ shift, entries } → expected result`:

  | Shift | Entries | Expected |
  |---|---|---|
  | 18:00–23:00 Wed | Wed EVENING PREFERRED | `'PREFERRED'` |
  | 10:00–14:00 | — | `touchedSlots` = `['MORNING','AFTERNOON']` |
  | 10:00–14:00 | MORNING PREFERRED, AFTERNOON AVOID | `'AVOID'` |
  | 12:00–17:00 | — | `touchedSlots` = `['AFTERNOON']` (half-open interval) |
  | Sat 22:00–Sun 06:00 | — | `touchedSlots` = `['EVENING','MORNING']` |
  | Sat 22:00–Sun 06:00 | Sat MORNING AVOID | `'AVOID'` |
  | Sat 22:00–Sun 06:00 | Sun MORNING AVOID only | `'NEUTRAL'` |
  | any shift | none | `'NEUTRAL'` |
  | 04:00–05:00 | — | `touchedSlots` = `['EVENING']` |

- [ ] **Step 2: Implement `preference.ts`** with luxon:
  - Walk from the local start time to the end, jumping to the next boundary (05:00, 12:00 or 17:00) each step.
  - The weekday is `local(start).weekday - 1`.
  - Run `npx jest src/matching/preference.spec.ts` → PASS.
- [ ] **Step 3: Write the failing loader test.** A member with `PREFERRED` on the target shift's weekday EVENING gets `preference: 'PREFERRED'`. One without rows gets `'NEUTRAL'`. Keep the existing "at most 4 queries" assertion.
- [ ] **Step 4: Implement the loader change.** Add a correlated subquery to the members raw query:

  ```sql
  COALESCE((SELECT json_agg(json_build_object('weekday', p.weekday, 'slot', p.slot, 'value', p.value))
            FROM preferences p WHERE p.membership_id = m.id), '[]') AS "preferences"
  ```

  Then set `preference: preferenceForShift(m.preferences, shift, org.timezone)`. In `rank()`, use `entry.preference`. Update the "4 queries" comments only if their wording changes.
- [ ] **Step 5: Seed demo preferences.**
  - `DEMO_PREFERENCES`:
    - Lukas, lindenhof, EVENING PREFERRED, weekdays 0–6;
    - Mia, lindenhof, EVENING AVOID, weekdays 0–6.
  - That gives 14 rows. The seed writes them after memberships.
  - Seed test: the preferences count is 14.
  - Seed test: GET the seeded L5 give-away's detail as Tom. Lukas has `score.breakdown.preference` 40 and Mia has 0.
  - Update `demo-data.spec.ts` if it checks the exported shapes.
- [ ] **Step 6: Run** `npm run test -w apps/api && npm run test:e2e -w apps/api -- eligibility-loader seed-demo offers` → PASS.
- [ ] **Step 7: Commit:** `feat: rank candidates by their weekly preferences`

### Task 3: Preference grid on the Availability page

**Files:**
- Create: `apps/web/src/features/availability/PreferenceGrid.tsx`, `apps/web/src/features/availability/PreferenceGrid.test.tsx`
- Modify: `apps/web/src/features/availability/AvailabilityPage.tsx` (render the grid under the unavailability section)

**Interfaces:**
- Consumes: `GET`/`PUT .../me/preferences` and the shared types (Task 1), plus the existing `api` helpers and `errorMessage`.

**Copy:**
- Section heading: "Weekly preferences".
- Help text: "Preferences only affect ranking. To block a time, add unavailability above."
- Column headers: "Morning (05–12)", "Afternoon (12–17)", "Evening (17–05)".
- Row headers: "Monday" … "Sunday".
- Radio labels: "Preferred", "Neutral", "Avoid".
- Button: "Save preferences".
- Success text: "Preferences saved."

- [ ] **Step 1: Write the failing component tests:**
  - 21 radio groups, each with an accessible name such as "Monday morning" (from a `fieldset` + legend, visually hidden), and 63 radios in total.
  - The initial selection comes from the GET. Absent entries show "Neutral".
  - "Save preferences" is disabled until something changes.
  - Changing Wednesday evening to Preferred and Monday morning to Avoid, then saving, sends `PUT {entries:[{weekday:0,slot:'MORNING',value:'AVOID'},{weekday:2,slot:'EVENING',value:'PREFERRED'}]}`. Neutral cells are never sent.
  - Success shows "Preferences saved." in a `role="status"` region, and the button disables again (the baseline moves to the server response).
  - On a server error, the `errorMessage` text appears in an `aria-live` alert and the choices are kept.
  - A double click on Save sends one PUT (ref guard).
- [ ] **Step 2: Implement `PreferenceGrid`.**
  - A `<table>` with `<caption>`, `th scope="col"` and `th scope="row"`.
  - In each cell, the three radios are stacked vertically so the table fits 320 px without horizontal scrolling.
  - Native radio inputs, with targets of at least 44 px (an employee screen).
  - Use a TanStack Query query and mutation. Invalidate the query on success.
- [ ] **Step 3: Run** `npm test -w apps/web` → PASS, and `npm run lint -w apps/web` → clean.
- [ ] **Step 4: Commit:** `feat(web): weekly preference grid on the availability page`

### Task 4: Shared notification copy and the email builder

**Files:**
- Create: `packages/shared/src/format.ts` (move `formatShiftTime` here from `apps/web/src/lib/format.ts`; the web file re-exports it from shared so its importers stay unchanged)
- Create: `packages/shared/src/notification-text.ts` (move `notificationText` here; the web's `notification-text.ts` becomes a re-export, or its importers switch to shared)
- Move the tests: `apps/web/src/features/notifications/notification-text.test.ts` → `packages/shared/src/notification-text.test.ts`, and the `formatShiftTime` cases into `packages/shared/src/format.test.ts`
- Create: `apps/api/src/mail/escape-html.ts` (moved out of `members/invite-mail.ts`, which then imports it)
- Create: `apps/api/src/notifications/notification-mail.ts`, `apps/api/src/notifications/notification-mail.spec.ts`
- Modify: `packages/shared/src/notifications.ts`, `packages/shared/src/index.ts`

**Interfaces:**
- Produces (shared):
  - `formatShiftTime(startAt: string, endAt: string, timezone: string): string`, unchanged.
  - `notificationText(n: Pick<NotificationDto,'type'|'payload'>, timezone: string): string`. Only the parameter type widens; the behaviour is unchanged.
  - `notificationPath(orgId: string, n: Pick<NotificationDto,'type'|'payload'>): string`.
  - `EMAIL_NOTIFICATION_TYPES: readonly NotificationType[]`: every type except `'MEMBER_DEACTIVATED'`.
- Produces (api): `buildNotificationMail(args: { to: string; orgName: string; timeZone: string; orgId: string; baseUrl: string; type: NotificationType; payload: NotificationPayload; recipientMembershipId: string }): MailMessage`.

`notificationPath` rules, first match wins:
1. `role === 'manager'` → `/orgs/{orgId}/review/{offerId}`, or `/orgs/{orgId}/review` when there is no `offerId`.
2. `OFFER_CREATED` or `ACCEPTANCE_INVALIDATED` → `/orgs/{orgId}/offers`.
3. `OFFER_APPROVED`, `OFFER_REJECTED`, `OFFER_EXPIRED`, `ACCEPTANCE_RECEIVED`, `OPEN_SHIFT_FILLED` → `/orgs/{orgId}/me/shifts`.
4. Anything else → `/orgs/{orgId}/notifications`.

**Email format:**
- **Subject:** `"{orgName}: {text without the trailing period}"`.
- **Text body:** `{text}`, a blank line, `Open ShiftSwap: {link}`, a blank line, `You get this email because you are a member of {orgName} on ShiftSwap.`
- **HTML:** the same three paragraphs, with the link as an `<a>` labelled "Open ShiftSwap" and every interpolated value escaped.
- **Other fields:** `kind` = the notification type; the link is `baseUrl + notificationPath(...)`.

- [ ] **Step 1: Move the code.** Move the functions and their tests unchanged. Run `npm test -w packages/shared -w apps/web` → PASS, with the same cases as before.
- [ ] **Step 2: Write the failing tests** for `notificationPath` (one per rule above) and `EMAIL_NOTIFICATION_TYPES` (its length is 7 and it lacks `MEMBER_DEACTIVATED`) in `notifications.test.ts`. Then implement them → PASS.
- [ ] **Step 3: Write the failing `notification-mail.spec.ts`:**
  - OFFER_APPROVED, role `selected`, Europe/Berlin, shift `2026-11-06T17:00Z`–`22:00Z`: the subject is `Café Lindenhof: You got the shift Fri 6 Nov, 18:00–23:00`, and the text contains `Open ShiftSwap: http://localhost:5173/orgs/o1/me/shifts`.
  - An `orgName` of `<b>X</b>` is escaped in the HTML.
  - `kind` is `'OFFER_APPROVED'`.
- [ ] **Step 4: Implement `buildNotificationMail`** and move `escapeHtml`. Run `npx jest src/notifications src/members` → PASS.
- [ ] **Step 5: Commit:** `refactor: share notification copy and build notification emails`

### Task 5: Email outbox dispatch for swap events

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`Notification.emailDispatchedAt DateTime? @map("email_dispatched_at") @db.Timestamptz(3)`)
- Create: the migration `<ts>_notification_email_outbox`. It adds the column, backfills `UPDATE notifications SET email_dispatched_at = created_at`, and creates the SQL-only partial index `notifications_email_pending_idx ON notifications (created_at, id) WHERE email_dispatched_at IS NULL`, documented by a schema comment.
- Modify: `apps/api/src/notifications/notifications.service.ts` (in `write`, set `emailDispatchedAt` to `null` for email types and to `now` for the rest)
- Create: `apps/api/src/notifications/notification-mailer.ts` (`NotificationMailer`)
- Create: `apps/api/src/notifications/app-origin.ts` (`AppOriginRegistry`)
- Create: `apps/api/src/notifications/mail-dispatch.interceptor.ts`, `apps/api/src/notifications/notification-mail.scheduler.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts` (import `MailModule`; provide and export the above)
- Modify: `apps/api/src/app.module.ts` (`APP_INTERCEPTOR` only when `NODE_ENV !== 'test'`, the same gate as `ScheduleModule`)
- Modify: `apps/web/src/lib/api.ts` (every request sends `x-app-origin: window.location.origin`), plus `apps/web/src/lib/api.test.ts`
- Modify: `apps/api/src/seed/seed-demo.ts` (seeded notifications get `emailDispatchedAt: new Date()`, so no mail goes out on start)
- Test: `apps/api/test/notification-email.e2e-spec.ts`, `apps/api/src/notifications/app-origin.spec.ts`, `apps/api/src/notifications/mail-dispatch.interceptor.spec.ts`

**Interfaces:**
- Consumes: `buildNotificationMail` and `EMAIL_NOTIFICATION_TYPES` (Task 4), `MailService`, `isTrustedOrigin` and `resolveBaseUrl` (`config/auth-config.ts`).
- Produces:
  - `NotificationMailer.dispatchPending(limit = 100): Promise<number>`, which returns the number of emails handed to `MailService.send`.
  - `AppOriginRegistry.remember(origin: string | undefined): void` and `AppOriginRegistry.baseUrl(): string`.
  - `NOTIFICATION_MAIL_INTERVAL_MS = 60_000`.

`dispatchPending` algorithm:
1. Claim in one transaction:

   ```sql
   SELECT id FROM notifications WHERE email_dispatched_at IS NULL
   ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED
   ```

   then `UPDATE ... SET email_dispatched_at = now() WHERE id = ANY($ids)`, then commit.
2. Load the claimed rows with:
   - recipient membership `{status, user {email, deletedAt}}`;
   - organization `{name, timezone}`.
3. Skip, without sending, a recipient that is not ACTIVE, has no user, or has a deleted user.
4. Build each email with `buildNotificationMail(...)`, using `baseUrl: registry.baseUrl()`.
5. Send the emails one after another with `MailService.send`, which never throws.

- [ ] **Step 1: Write the failing e2e tests.** Jest already sets `MAIL_TRANSPORT=json`; read `MailService.sent` from the testing module.
  - **Give-away flow:** create → accept by two candidates → approve one.
    - `dispatchPending()` sends one email per committed notification row of an email type.
    - The approval emails go to the selected candidate, the owner and the not-selected candidate, with the subjects from `notificationText`.
    - A second `dispatchPending()` returns 0.
  - **Deactivation:** deactivate a member. The `MEMBER_DEACTIVATED` rows are created with `emailDispatchedAt` set and are never emailed.
  - **Recipient deactivated:** a pending row whose recipient was deactivated before dispatch → no email, and the row is still marked dispatched.
  - **Concurrent dispatch:** `Promise.all([dispatchPending(), dispatchPending()])` → the sum equals the pending row count, and no recipient/subject pair repeats.
  - **Expiry:** `expireDue` rows are emailed by `dispatchPending()`.
- [ ] **Step 2: Add the column and migration**, then implement the `write` change and `NotificationMailer`. Run `npm run test:e2e -w apps/api -- notification-email notifications` → PASS.
- [ ] **Step 3: Write the failing unit tests:**
  - **Registry:**
    - It ignores `https://evil.example`.
    - It remembers `http://localhost:5173`.
    - With `ALLOW_CODESPACE_ORIGINS=true`, it remembers a `*-5173.app.github.dev` origin.
    - `baseUrl()` falls back to `resolveBaseUrl` and then to `http://localhost:5173`.
  - **Interceptor:**
    - It calls `remember` with the header value.
    - It calls `dispatchPending` once after a successful POST.
    - It does not call `dispatchPending` for a GET or for a failed POST.
    - The response does not wait for `dispatchPending`: it is a `void` call whose rejections are logged by error name only.
- [ ] **Step 4: Implement the registry, interceptor and scheduler.** The scheduler is `@Interval(NOTIFICATION_MAIL_INTERVAL_MS)`, guarded with try/catch and logging like `ExpiryScheduler`. Register them all. Add the web header and its `api.test.ts` assertion. Seed notifications are marked dispatched.
- [ ] **Step 5: Run** `npm test --workspaces && npm run test:e2e -w apps/api` → PASS, and lint + typecheck → clean.
- [ ] **Step 6: Commit:** `feat: email swap notifications through a notifications outbox`

### Task 6: Account deletion API

**Files:**
- Create: `packages/shared/src/account.ts` (`deleteAccountSchema = z.object({ confirm: z.literal('DELETE') }).strict()`, type `DeleteAccountInput`) and export it.
- Create: `apps/api/src/tenancy/org-context.ts` with `toOrgContext(m: Membership & { organization: Organization }): OrgContext`, extracted from `OrgGuard`, which now uses it.
- Modify: `apps/api/src/members/deactivation.service.ts`. The signature becomes `deactivate(org, membershipId, opts?: { selfDeletion?: boolean })`. When `selfDeletion` is set, it skips the admin-permission check and the self check. `LAST_ADMIN` stays enforced under the lock.
- Create: `apps/api/src/account/account.service.ts`, `apps/api/src/account/account.module.ts`
- Modify: `apps/api/src/me/me.controller.ts` (`@Delete() @HttpCode(204)`), `apps/api/src/app.module.ts`
- Test: `apps/api/test/account-deletion.e2e-spec.ts`, `apps/api/src/members/deactivation.service.spec.ts`

**Interfaces:**
- Consumes: `DeactivationService.deactivate` and `AuditService.record`.
- Produces:
  - `AccountService.deleteAccount(userId: string): Promise<void>`.
  - `DELETE /api/v1/me` with body `{confirm:'DELETE'}`, returning 204.
  - Error `LAST_ADMIN` with `details: { organizationIds: string[] }`.

`deleteAccount` steps:
1. Load the user's ACTIVE memberships with their organizations.
2. For every ADMIN membership, count the other ACTIVE admins. Collect the orgs where that count is 0. If there are any, throw `LAST_ADMIN` with `{organizationIds}` sorted.
3. For each ACTIVE membership, ordered by `organizationId`, call `deactivation.deactivate(toOrgContext(m), m.id, { selfDeletion: true })`. Each call is its own transaction.
4. Run one final transaction (with an audit row for each org):
   - Anonymise the user row as described in Global Constraints.
   - `session.deleteMany({userId})` and `account.deleteMany({userId})`.
   - Set every membership of the user to `displayName 'Deleted user'`, `email null`.
   - Set `invite.email` to the tombstone for those memberships.
   - Write one audit row per membership: `action 'member.anonymised'`, `entityType 'membership'`, actor = that membership, no `before`/`after`.
5. If the request is repeated after a partial failure, it completes. Memberships that are already deactivated are skipped.

- [ ] **Step 1: Write the failing e2e tests:**
  - **Happy path:** Lukas is an EMPLOYEE in two orgs, with an OPEN give-away that has a PENDING acceptance and a future shift. The DELETE returns 204, and then:
    - the user's name is `Deleted user`, the email is the tombstone and `deletedAt` is set;
    - the session and account counts are 0;
    - the same cookie on `GET /api/v1/me` → 401;
    - both memberships are `DEACTIVATED` with `displayName 'Deleted user'` and `email null`;
    - the give-away is `CANCELLED` with `cancelReason 'OWNER_DEACTIVATED'`, and an `OPEN_SHIFT` offer exists for the shift;
    - the audit rows from before still exist.
  - **Sign-up afterwards:** signing up again with the old email succeeds and creates a new user id.
  - **Last admin in one org (Review Focus 4):** the sole admin of org A who is also an employee in org B gets 409 `LAST_ADMIN` with `details.organizationIds = [A]`. Both memberships are still ACTIVE, the user is unchanged, and the sessions still exist.
  - **Another admin exists:** an admin whose org has a second active admin → 204.
  - **Validation:** the body `{}` or `{confirm:'delete'}` → 400. No session → 401.
- [ ] **Step 2: Write the failing unit test** in `deactivation.service.spec.ts`: deactivating yourself is rejected without `selfDeletion` and allowed with it.
- [ ] **Step 3: Implement** `toOrgContext`, the `selfDeletion` option, `AccountService` and the controller route. Check the tenancy sweep: `/me` is not an org route, so add it to the sweep's non-org list if the route-set check requires that.
- [ ] **Step 4: Run** `npm run test:e2e -w apps/api -- account-deletion deactivation tenancy-sweep && npm run test -w apps/api` → PASS.
- [ ] **Step 5: Commit:** `feat: delete own account with anonymisation`

### Task 7: Account page and delete flow in the web app

**Files:**
- Create: `apps/web/src/features/account/AccountPage.tsx`, `apps/web/src/features/account/AccountPage.test.tsx`
- Modify: `apps/web/src/router.tsx` (`/account` under `RequireAuth`)
- Modify: `apps/web/src/features/org/OrgLayout.tsx` and `apps/web/src/features/orgs/OrgPickerPage.tsx` (an "Account" link next to "Log out")
- Modify: `apps/web/src/features/auth/LoginPage.tsx` (render `location.state.notice` in a `role="status"` region), plus its test

**Interfaces:**
- Consumes: `DELETE /api/v1/me` (Task 6), `useMe`, `errorMessage` and `ApiError`.

**Copy:**
- Heading: "Your account".
- Details: the user's name and email.
- Section "Delete account" with the text: "Deleting your account removes your login, name and email from ShiftSwap. Your future shifts in every organisation are unassigned and offered to your coworkers. This cannot be undone."
- Button: "Delete account…".
- Dialog (Radix AlertDialog):
  - Title: "Delete your account?"
  - Input label: "Type DELETE to confirm"
  - Buttons: "Cancel" and "Delete my account" (disabled until the input equals `DELETE`).
- On success: clear the query cache and navigate to `/login` with state `{ notice: 'Your account was deleted.' }`.
- On `LAST_ADMIN`: "You are the last admin of {org names joined with ', '}. Make another member an admin first." The names come from `useMe` memberships matched to `details.organizationIds`.

- [ ] **Step 1: Write the failing tests:**
  - The confirm button is disabled for `delete` and enabled for `DELETE`.
  - Success calls `DELETE /api/v1/me` with `{confirm:'DELETE'}`, then navigates with the notice.
  - The LoginPage shows the notice.
  - The `LAST_ADMIN` copy names the org.
  - A double click sends one request.
  - Focus returns to "Delete account…" after Cancel.
- [ ] **Step 2: Implement** the page, the route and the links. Run `npm test -w apps/web` → PASS; lint → clean.
- [ ] **Step 3: Commit:** `feat(web): account page with account deletion`

### Task 8: Retention purge

**Files:**
- Create: `apps/api/src/retention/retention.service.ts`, `apps/api/src/retention/retention.scheduler.ts`, `apps/api/src/retention/retention.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/retention.e2e-spec.ts`, `apps/api/src/retention/retention.scheduler.spec.ts`

**Interfaces:**
- Produces:
  - `RetentionService.purge(now: Date): Promise<RetentionCounts>`
  - `RetentionCounts = { shifts: number; offers: number; acceptances: number; auditLogs: number; notifications: number; unavailabilities: number }`
  - `RETENTION_CRON = '0 3 * * *'`, run with `{ timeZone: 'UTC' }`.

Cutoffs are computed with luxon in UTC:
- shifts and audit: `minus({ months: 24 })`;
- notifications: `minus({ days: 90 })`;
- unavailability: `minus({ days: 30 })`.

Shifts are deleted in batches of 500 ids, each batch in its own transaction, in this order: the batch's acceptances (via its offers), then the offers, then the shifts (`shift_skills` cascade). Audit logs are deleted in batches of 5,000 ids. Notifications and unavailability are deleted with a single `deleteMany` each.

- [ ] **Step 1: Write the failing e2e tests.** Use a fixed `now`, with rows inserted directly through Prisma.

  | Data | Purged | Kept |
  |---|---|---|
  | Shift (with offer, acceptance and skills) | ended `cutoff − 1 ms`; also a soft-deleted one ended `cutoff − 1 ms` | ended exactly at `cutoff` |
  | Audit row | created `cutoff − 1 ms` | created at `cutoff` |
  | Notification | 90 days + 1 ms old | exactly 90 days old |
  | Unavailability | ended 30 days + 1 ms ago | ended exactly 30 days ago |

  Also assert:
  - the returned counts match;
  - a second `purge(now)` returns all zeros;
  - rows in other orgs are judged by the same cutoffs (the purge is global).
- [ ] **Step 2: Implement `RetentionService`.** Add a comment that this is the only code allowed to delete audit rows (SDD §26).
- [ ] **Step 3: Write the failing unit test** for the scheduler: `tick()` calls `purge` and logs the counts. A thrown error is logged by name and not rethrown. Then implement it with `@Cron(RETENTION_CRON, { timeZone: 'UTC' })`.
- [ ] **Step 4: Run** `npm run test:e2e -w apps/api -- retention && npm run test -w apps/api` → PASS.
- [ ] **Step 5: Commit:** `feat: nightly retention purge`

### Task 9: Plan 3 leftovers

Each item is small; group the commits by area. Where each one comes from: `.superpowers/sdd/2026-10-24-people-and-notifications/progress.md`. That directory is deleted when the plan finishes, so the items are spelled out here.

**Files:** `scripts/smoke-stack.sh`; `apps/api/src/members/members.service.ts` and `members.controller.ts`; `apps/web/src/features/members/InviteDialog.tsx` and `MembersPage.tsx`; `apps/web/src/features/notifications/useUnreadCount.ts`; `apps/web/src/features/settings/SkillsSection.tsx`. Tests sit next to each file and in `apps/api/test/members.e2e-spec.ts`.

1. **Smoke check positive control.** `smoke-stack.sh` also asserts that the api logs contain `/api/v1/invites/:token`. Without that, the "no token in the logs" check could pass even when nothing was logged.
2. **Audit the email set on resend.** `resendInvite` with a new email writes an audit row `member.updated` with `after: { fields: ['email'] }`. It contains no address.
3. **Member PATCH no-op.** A `PATCH /members/:id` that changes nothing writes no audit row.
4. **Status filter validation.** `GET /members?status=foo` → 400 `VALIDATION_FAILED`. Allowed values: `active`, `deactivated`, `all`, or omitted.
5. **Stale invite dialog.** `InviteDialog` closes itself when the refreshed member now has an email or a login.
6. **Unread badge on failed poll.** `useUnreadCount` keeps the last known count when a poll fails, instead of showing 0.
7. **Focus after skill changes.** In `SkillsSection`, focus moves to the renamed skill's row button after a rename, and to the "Add skill" input after a delete.

- [ ] **Step 1: Write a failing test for each item.** Item 1's test is the script itself, checked in CI.
- [ ] **Step 2: Implement** the items, then run `npm test --workspaces && npm run test:e2e -w apps/api -- members` → PASS.
- [ ] **Step 3: Commit,** one per area: `fix(api): ...`, `fix(web): ...`, `test(scripts): ...`.

### Task 10: E2E, docs and PR

**Files:**
- Modify: `e2e/tests/swap-flow.spec.ts`. After Tom approves Lukas, poll Mailpit with `GET /mailpit/api/v1/search?query=to:lukas@shiftswap.test` until a message with the subject containing `You got the shift` appears (`toPass`, 20 s timeout). Open `/mailpit/api/v1/message/{ID}` and assert the text contains `/me/shifts`.
- Create: `e2e/tests/preferences.spec.ts` (`chromium` project):
  - Anna sets Wednesday evening to Preferred and saves.
  - "Preferences saved." appears.
  - After a reload, the radio is still checked.
  - axe finds 0 serious/critical violations on the Availability page.
- Create: `e2e/tests/account-flow.spec.ts` (`chromium` project), using unique emails `del-<timestamp>@example.test`:
  - **Case A:** sign up → the org picker loads → Account → delete → `/login` shows "Your account was deleted." → logging in with the old credentials fails. axe runs on the Account page.
  - **Case B:** sign up → create an org → Account → delete → the `LAST_ADMIN` message names the new org.
- Modify: `README.md`, `DEMO_ACCOUNTS.md`:
  - Lukas and Mia have seeded preferences that change the L5 ranking (Lukas +40, Mia +0).
  - Swap events send email, visible at `/mailpit/`.
  - Deleting a demo account lasts only until the Codespace restarts.
- [ ] **Step 1: Write the specs and docs.** Run lint for e2e if one is configured. E2E runs in CI only.
- [ ] **Step 2: Commit:** `test(e2e): cover preferences, swap emails and account deletion`
- [ ] **Step 3: Push and open the PR.**
  - Push: `git push -u origin feature/bashi-24.10.2026-preferences-emails-retention`.
  - Create the PR: `GH_TOKEN=$(gh auth token -u Bashlenix) gh pr create --base main --title "Preferences, swap emails, account deletion and retention" --body-file <file>`.
  - The body is English, with no attribution.
  - Watch CI until `checks`, `stack-smoke` and `zero-setup` are green. Do not merge.

After the merge, the controller updates SDD §23's "Email dispatch" rule (and re-exports `docs/sdd.md`) to describe the outbox. The guarantees are the same as the spec's per-request list, but the mechanism differs.
