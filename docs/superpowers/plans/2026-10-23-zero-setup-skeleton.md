# Zero-Setup Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public GitHub repo `Bashlenix/ShiftSwap` where opening a Codespace on `main` starts Postgres, API and web automatically, seeds demo accounts, opens the login page, and lets a demo user log in and see their organisations — with CI proving this on every PR.

**Architecture:** npm-workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`). NestJS API with Prisma + Postgres and Better Auth mounted at `/api/auth/*`; React + Vite SPA served by `vite preview`, proxying `/api` to the API (same origin, cookie auth). Docker Compose runs `db`, `mailpit`, `api`, `web`; a Dev Container adds a `workspace` service and auto-opens port 5173. No shift/offer features yet — this plan only proves the zero-setup path end to end.

**Tech Stack:** Node 22, TypeScript, NestJS 11 (Express 5), Prisma, PostgreSQL 17, Better Auth (email + password, Prisma adapter), React + Vite, React Router, TanStack Query, React Hook Form + Zod, Tailwind, Jest + Supertest (api), Vitest + Testing Library (web, shared), Playwright + @axe-core/playwright, Docker Compose, Dev Containers, GitHub Actions.

**Spec:** `docs/sdd.md` (exported from https://claude.ai/artifact/DqV97ySyFoivozWMZkcs5N). Relevant sections: §10, §11, §13, §14, §20, §28, §29, §30, §31, §33, §40 (ticked decisions).

## Global Constraints

- Repo: `Bashlenix/ShiftSwap`, **public**, created with `GH_TOKEN=$(gh auth token -u Bashlenix) gh repo create …` — never switch the globally active `gh` account. Remote: `git@github-personal:Bashlenix/ShiftSwap.git`.
- Repo-local git identity: `user.name Bashlenix`, `user.email 186148304+Bashlenix@users.noreply.github.com`. No `Co-authored-by` or any Claude/Anthropic attribution in commits or PR bodies. Commit messages in English.
- Only Task 1's bootstrap commit goes on `main`. Everything else on branch `chore/bashi-23.10.2026-repo-scaffold`, merged via PR.
- Before every commit that touches code: run `/mattpocock-skills:code-review` on the change and act on findings (user's global rule).
- Node 22 everywhere (`node:22-bookworm-slim` images, `engines.node: ">=22 <23"`, `.nvmrc` = `22`). npm workspaces, lockfile committed. Install current stable versions of all libraries; never `latest` tags in Dockerfiles.
- Zero-setup rule (NFR-11/13): no step the professor performs may require a terminal, a secret, or config. No external service required to run; Sentry not wired in this plan.
- Ports: web `5173` (published, auto-open), mailpit UI `8025` (published), API `3000` (internal only), Postgres `5432` (published for local tests only).
- API routes: `/api/auth/*` (Better Auth), `/api/v1/*` (ShiftSwap), `/health/live` and `/health/ready` (no prefix).
- DB naming: snake_case tables/columns via Prisma `@@map`/`@map`; table names from SDD §14 (`users`, `organizations`, `memberships`).
- Demo data (SDD §40, accepted): two orgs, shared demo password, one multi-org user, one placeholder; dates relative to today when shifts arrive in later plans; **reseed on every API start** when `SEED_ON_START=true`.
- Logs: `nestjs-pino`, JSON, IDs only — never log emails, names or request bodies.
- Accessibility: every input has a visible `<label>`; errors as text, announced via `aria-live`; axe zero serious/critical on `/login`.

## Review Focus

1. **Codespace forwarded URL** (`https://<name>-5173.app.github.dev`): Vite's host check and Better Auth's origin check both reject unknown hosts by default → login must work there. `CODESPACE_NAME` may **not** reach the `api` container (Compose runs on the Codespace host VM), so the origin check must not depend on it. Pinned by `isCodespaceOrigin` tests (Task 4), `allowedHosts` (Task 6), and the real-Codespace acceptance check (Task 9 Step 6).
2. **Codespace restart**: API restarts must not fail or duplicate data when the DB already has demo rows → `seedDemo` run twice yields identical counts (Task 5).
3. **Auth secret across restarts**: secret generated once and reused; a new secret on every start would silently log everyone out → `ensureAuthSecret` tests (Task 5).
4. **DB not ready / unreachable**: `/health/ready` must return 503, not crash, so Compose ordering works → health test with failing DB (Task 3).
5. **Email case and wrong password**: `Anna@ShiftSwap.test` must log in like `anna@shiftswap.test`; wrong password gives one generic message without revealing whether the email exists → shared schema test (Task 2) and login component test (Task 6).

---

### Task 1: Repository bootstrap on GitHub

**Files:**
- Create: `.gitignore`, `README.md` (stub), `docs/sdd.md` (already exported), `docs/superpowers/plans/2026-10-23-zero-setup-skeleton.md` (this file)

**Interfaces:**
- Produces: public repo `Bashlenix/ShiftSwap` with `main` containing the bootstrap commit; local branch `chore/bashi-23.10.2026-repo-scaffold` tracking origin.

- [ ] **Step 1: Write `.gitignore`**

Entries: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*` (but `!.env.example`), `.venv/`, `playwright-report/`, `test-results/`, `.DS_Store`, `*.log`.

- [ ] **Step 2: Write `README.md` stub** — title, one-sentence pitch from SDD §1, link to `docs/sdd.md`. (Full README in Task 8.)

- [ ] **Step 3: Init repo with local identity**

```bash
cd /Users/bashi/Documents/GitHub/Bashi/ShiftSwap
git init -b main
git config user.name "Bashlenix"
git config user.email "186148304+Bashlenix@users.noreply.github.com"
git add .gitignore README.md docs/
git commit -m "chore: bootstrap repository with SDD and implementation plan"
```

- [ ] **Step 4: Create public repo and push**

```bash
GH_TOKEN=$(gh auth token -u Bashlenix) gh repo create Bashlenix/ShiftSwap --public \
  --description "Shift-swapping SaaS for small shift-based businesses (university project)"
git remote add origin git@github-personal:Bashlenix/ShiftSwap.git
git push -u origin main
```

- [ ] **Step 5: Verify**

Run: `GH_TOKEN=$(gh auth token -u Bashlenix) gh repo view Bashlenix/ShiftSwap --json visibility,defaultBranchRef --jq '.visibility+" "+.defaultBranchRef.name'`
Expected: `PUBLIC main`. Run `gh auth status` — active account is still `Mhd-Bashi`.

- [ ] **Step 6: Create working branch**

```bash
git switch -c chore/bashi-23.10.2026-repo-scaffold
git push -u origin chore/bashi-23.10.2026-repo-scaffold
```

---

### Task 2: Monorepo tooling and shared package

**Files:**
- Create: `package.json` (root), `.nvmrc`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.editorconfig`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/auth.ts`
- Test: `packages/shared/src/auth.test.ts`

**Interfaces:**
- Produces: `@shiftswap/shared` exporting `loginSchema` (Zod) and `type LoginInput = { email: string; password: string }`.
- Produces root scripts: `lint`, `typecheck`, `test` (runs every workspace's `test`), `format`.

- [ ] **Step 1: Root `package.json`** — `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, `"engines": {"node": ">=22 <23"}`, scripts `lint` (`eslint .`), `typecheck` (`npm run typecheck --workspaces --if-present`), `test` (`npm run test --workspaces --if-present`). Dev deps: `typescript`, `eslint`, `typescript-eslint`, `prettier`, `eslint-config-prettier`.

- [ ] **Step 2: Write the failing test** `packages/shared/src/auth.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth';

describe('loginSchema', () => {
  it('trims and lowercases the email', () => {
    expect(loginSchema.parse({ email: '  Anna@ShiftSwap.test ', password: 'ShiftSwap-Demo-2026' }))
      .toEqual({ email: 'anna@shiftswap.test', password: 'ShiftSwap-Demo-2026' });
  });
  it('rejects an invalid email with message "Enter a valid email address"', () => {
    const r = loginSchema.safeParse({ email: 'anna', password: 'ShiftSwap-Demo-2026' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['email'], message: 'Enter a valid email address' });
  });
  it('rejects an empty password with message "Enter your password"', () => {
    const r = loginSchema.safeParse({ email: 'anna@shiftswap.test', password: '' });
    expect(r.error!.issues[0]).toMatchObject({ path: ['password'], message: 'Enter your password' });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npm test -w @shiftswap/shared` → FAIL (`./auth` not found).

- [ ] **Step 4: Implement `loginSchema` in `packages/shared/src/auth.ts`** — `z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') })`; re-export from `index.ts`. Package builds to `dist/` with `tsc`; `main`/`types` point at `dist`, plus `"exports"` with a `"development"`-free plain mapping.

- [ ] **Step 5: Run tests, lint, typecheck** — `npm test -w @shiftswap/shared && npm run lint && npm run typecheck` → all PASS.

- [ ] **Step 6: Code review + commit**

```bash
git add package.json package-lock.json .nvmrc tsconfig.base.json eslint.config.mjs .prettierrc .editorconfig packages/shared
git commit -m "chore: set up npm workspaces, tooling and shared login schema"
```

---

### Task 3: API skeleton with Prisma schema and health endpoints

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/nest-cli.json`, `apps/api/jest.config.ts`
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<timestamp>_init/migration.sql`
- Create: `apps/api/src/main.ts`, `apps/api/src/app.factory.ts`, `apps/api/src/app.module.ts`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/prisma/prisma.module.ts`, `apps/api/src/health/health.controller.ts`
- Create: `docker-compose.yml` (only `db` service in this task), `.env.example`
- Test: `apps/api/test/health.e2e-spec.ts`, `apps/api/test/setup-db.ts`

**Interfaces:**
- Produces: `createApp(options?: { prisma?: PrismaClient }): Promise<INestApplication>` in `app.factory.ts` — single wiring point used by `main.ts` and every test.
- Produces: `PrismaService extends PrismaClient` (global module).
- Produces Prisma models: `User` (`users`), `Session`, `Account`, `Verification` (Better Auth shape), `Organization` (`organizations`), `Membership` (`memberships`), enums `AccessLevel { EMPLOYEE MANAGER ADMIN }`, `MembershipStatus { ACTIVE DEACTIVATED }`.

- [ ] **Step 1: Write `schema.prisma`**

- `User`: `id String @id`, `email String @unique`, `name String`, `emailVerified Boolean @default(false)`, `image String?`, `createdAt`, `updatedAt`, `deletedAt DateTime?`; relations to sessions, accounts, memberships. `@@map("users")`.
- `Session`, `Account`, `Verification`: exactly the fields Better Auth's Prisma schema generator emits (`npx @better-auth/cli generate` against a stub config, then copy), mapped to `sessions`, `accounts`, `verifications`.
- `Organization`: `id String @id @default(uuid())`, `name`, `timezone String @default("Europe/Berlin")`, `defaultWeeklyLimitMin Int @default(2400)`, `minRestMin Int @default(660)`, `maxDailyMin Int @default(600)`, `offerLeadTimeMin Int @default(120)`, `createdAt`. `@@map("organizations")`.
- `Membership`: `id String @id @default(uuid())`, `organizationId`, `userId String?`, `displayName`, `email String?`, `accessLevel AccessLevel`, `status MembershipStatus @default(ACTIVE)`, `weeklyLimitMin Int?`, `externalId String?`, `source String @default("MANUAL")`, `createdAt`, `updatedAt`; `@@unique([organizationId, userId])`, `@@unique([organizationId, externalId])`. `@@map("memberships")`.
- All columns `@map` to snake_case.

- [ ] **Step 2: Compose `db` service + migration**

`docker-compose.yml`: `db` = `postgres:17-alpine`, env `POSTGRES_USER=shiftswap POSTGRES_PASSWORD=shiftswap POSTGRES_DB=shiftswap`, port `5432:5432`, named volume, healthcheck `pg_isready -U shiftswap`. `.env.example`: `DATABASE_URL=postgresql://shiftswap:shiftswap@localhost:5432/shiftswap`.
Run `docker compose up -d --wait db && npx prisma migrate dev --name init -w apps/api`, then append to the generated `migration.sql`:

```sql
CREATE UNIQUE INDEX memberships_org_email_lower_key ON memberships (organization_id, lower(email)) WHERE email IS NOT NULL;
```

- [ ] **Step 3: Write the failing test** `apps/api/test/health.e2e-spec.ts`

```ts
it('GET /health/live → 200 {status:"ok"}', ...)
it('GET /health/ready → 200 {status:"ok"} when DB reachable', ...)
it('GET /health/ready → 503 {status:"unavailable"} when DB query throws', async () => {
  // createApp({ prisma: stub whose $queryRaw rejects })
});
```

`test/setup-db.ts` (Jest `globalSetup`): points `DATABASE_URL` at database `shiftswap_test` and runs `prisma migrate reset --force --skip-seed`.

- [ ] **Step 4: Run to verify it fails** — `npm run test:e2e -w apps/api` → FAIL (`createApp` not found).

- [ ] **Step 5: Implement**

- `createApp`: `NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true })`, `app.useLogger(app.get(Logger))` (nestjs-pino, redact `req.headers.cookie`, `req.headers.authorization`), `app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] })`, re-enable JSON body parsing for non-auth routes (`app.use(json())`), `app.enableShutdownHooks()`. Optional `prisma` override replaces `PrismaService` provider.
- `HealthController`: `live()` returns `{ status: 'ok' }`; `ready()` runs `` this.prisma.$queryRaw`SELECT 1` `` and returns `{ status: 'ok' }`, else throws `ServiceUnavailableException({ status: 'unavailable' })`.
- `main.ts`: `createApp()` then `listen(Number(process.env.PORT ?? 3000), '0.0.0.0')`.

- [ ] **Step 6: Run tests** — `npm run test:e2e -w apps/api` → PASS (3 tests). `npm run lint && npm run typecheck` → PASS.

- [ ] **Step 7: Code review + commit** — `feat(api): add NestJS skeleton, Prisma schema and health endpoints`

---

### Task 4: Better Auth integration and `GET /api/v1/me`

**Files:**
- Create: `apps/api/src/config/auth-config.ts`, `apps/api/src/auth/auth.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/session.guard.ts`, `apps/api/src/auth/current-user.decorator.ts`, `apps/api/src/me/me.controller.ts`
- Modify: `apps/api/src/app.factory.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/config/auth-config.spec.ts`, `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `createApp`, `PrismaService` (Task 3).
- Produces:
  - `resolveBaseUrl(env: NodeJS.ProcessEnv): string | undefined` (undefined → Better Auth infers from the request)
  - `resolveTrustedOrigins(env: NodeJS.ProcessEnv): string[]`
  - `isCodespaceOrigin(origin: string, env: NodeJS.ProcessEnv): boolean` — true only when `ALLOW_CODESPACE_ORIGINS === 'true'` and origin matches `^https://[a-z0-9-]+-5173\.app\.github\.dev$`
  - `useSecureCookies(env: NodeJS.ProcessEnv): boolean`
  - `createAuth(prisma: PrismaClient, env?: NodeJS.ProcessEnv)` → Better Auth instance; `type Auth = ReturnType<typeof createAuth>`; DI token `AUTH`.
  - `SessionGuard` (sets `req.user: AuthUser = { id: string; email: string; name: string }`), `@CurrentUser()` decorator.
  - `GET /api/v1/me` → `{ user: AuthUser; memberships: { organizationId: string; organizationName: string; accessLevel: 'EMPLOYEE'|'MANAGER'|'ADMIN' }[] }` (ACTIVE memberships only, sorted by organization name).

- [ ] **Step 1: Write failing unit tests** `auth-config.spec.ts`

```ts
const cs = { CODESPACE_NAME: 'bashlenix-abc123', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' };
expect(resolveBaseUrl({})).toBeUndefined();
const demo = { ALLOW_CODESPACE_ORIGINS: 'true' };
expect(isCodespaceOrigin('https://bashlenix-abc123-5173.app.github.dev', demo)).toBe(true);
expect(isCodespaceOrigin('https://bashlenix-abc123-5173.app.github.dev', {})).toBe(false);
expect(isCodespaceOrigin('https://bashlenix-abc123-3000.app.github.dev', demo)).toBe(false);
expect(isCodespaceOrigin('https://evil.app.github.dev.example.com', demo)).toBe(false);
expect(isCodespaceOrigin('http://bashlenix-abc123-5173.app.github.dev', demo)).toBe(false);
expect(resolveBaseUrl(cs)).toBe('https://bashlenix-abc123-5173.app.github.dev');
expect(resolveTrustedOrigins({})).toEqual(['http://localhost:5173']);
expect(resolveTrustedOrigins(cs)).toEqual(['http://localhost:5173', 'https://bashlenix-abc123-5173.app.github.dev']);
expect(resolveTrustedOrigins({ TRUSTED_ORIGINS: 'http://web:5173, http://127.0.0.1:5173' }))
  .toEqual(['http://localhost:5173', 'http://web:5173', 'http://127.0.0.1:5173']);
expect(useSecureCookies({})).toBe(false);
expect(useSecureCookies(cs)).toBe(true);
```

- [ ] **Step 2: Write failing e2e tests** `auth.e2e-spec.ts` (all requests send `Origin: http://localhost:5173`)

- sign-up `POST /api/auth/sign-up/email {name,email,password}` → 200; then `POST /api/auth/sign-in/email` → 200 with `set-cookie` containing the session cookie.
- `GET /api/v1/me` with that cookie → 200, `user.email` = signed-up email, `memberships` = `[]`.
- After inserting an `Organization` + ACTIVE `Membership` for the user, `/me` returns it with `organizationName` and `accessLevel`; a DEACTIVATED membership is excluded.
- `GET /api/v1/me` without cookie → 401.
- sign-in with wrong password → 401.
- sign-in with `Origin: https://evil.example` → 403.

- [ ] **Step 3: Run to verify failures** — `npm test -w apps/api && npm run test:e2e -w apps/api` → FAIL.

- [ ] **Step 4: Implement**

- `createAuth`: `betterAuth({ database: prismaAdapter(prisma, { provider: 'postgresql' }), basePath: '/api/auth', baseURL: resolveBaseUrl(env), secret: env.BETTER_AUTH_SECRET, trustedOrigins: (request) => [...resolveTrustedOrigins(env), ...(isCodespaceOrigin(request.headers.get('origin') ?? '', env) ? [request.headers.get('origin')!] : [])], emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8 }, session: { expiresIn: 60 * 60 * 24 * 7 }, advanced: { useSecureCookies: useSecureCookies(env) } })`. Better Auth's built-in rate limiting stays on (SDD §26).
- Before writing `createAuth`, check the installed Better Auth types: if `trustedOrigins` does not accept a function of the request, use its wildcard string form `https://*-5173.app.github.dev` (only when `ALLOW_CODESPACE_ORIGINS === 'true'`) and adapt the `isCodespaceOrigin` tests to the pattern list instead. Record which form was used in the commit message.
- In `createApp`, register the handler on the raw Express instance **before** `app.use(json())`: `expressApp.all('/api/auth/*splat', toNodeHandler(auth))` (Express 5 wildcard syntax). `expressApp.set('trust proxy', 1)`.
- `SessionGuard`: `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`; null → `UnauthorizedException`.
- `MeController` (`@UseGuards(SessionGuard)`): query memberships with `organization` included.

- [ ] **Step 5: Run tests** → PASS. `npm run lint && npm run typecheck` → PASS.

- [ ] **Step 6: Code review + commit** — `feat(api): add Better Auth email/password login and /me endpoint`

---

### Task 5: Demo seed, auth-secret bootstrap and start script

**Files:**
- Create: `apps/api/prisma/seed/demo-data.ts`, `apps/api/prisma/seed/seed-demo.ts`, `apps/api/src/bootstrap/ensure-auth-secret.ts`, `apps/api/src/bootstrap/start.ts`, `DEMO_ACCOUNTS.md`
- Test: `apps/api/test/seed-demo.e2e-spec.ts`, `apps/api/src/bootstrap/ensure-auth-secret.spec.ts`, `apps/api/test/demo-accounts-doc.spec.ts`

**Interfaces:**
- Consumes: `createAuth`, `Auth` (Task 4).
- Produces:
  - `DEMO_PASSWORD = 'ShiftSwap-Demo-2026'`, `DEMO_ORGS`, `DEMO_ACCOUNTS: { email: string; name: string; memberships: { org: 'lindenhof' | 'seeblick'; accessLevel: AccessLevel }[] }[]`, `DEMO_PLACEHOLDERS`.
  - `seedDemo(prisma: PrismaClient, auth: Auth): Promise<{ users: number; organizations: number; memberships: number }>` — **resets** demo tables then recreates (reseed-on-start decision).
  - `ensureAuthSecret(secretFilePath: string, env: NodeJS.ProcessEnv): string`.
  - `start.ts`: compiled to `dist/bootstrap/start.js`; the API container's command.

Demo data (exact values):

| Email | Name | Memberships |
| --- | --- | --- |
| maria@shiftswap.test | Maria Keller | Café Lindenhof — ADMIN |
| tom@shiftswap.test | Tom Becker | Café Lindenhof — MANAGER |
| anna@shiftswap.test | Anna Schmidt | Café Lindenhof — EMPLOYEE |
| lukas@shiftswap.test | Lukas Wolf | Café Lindenhof — EMPLOYEE; Hotel Seeblick — EMPLOYEE |
| mia@shiftswap.test | Mia Hoffmann | Café Lindenhof — EMPLOYEE |
| sara@shiftswap.test | Sara Yilmaz | Hotel Seeblick — ADMIN |

Placeholder (no login, no email): `Paul Weber`, Café Lindenhof — EMPLOYEE. Password for all: `ShiftSwap-Demo-2026`.

- [ ] **Step 1: Write failing tests**

`seed-demo.e2e-spec.ts`:
```ts
expect(await seedDemo(prisma, auth)).toEqual({ users: 6, organizations: 2, memberships: 8 });
expect(await seedDemo(prisma, auth)).toEqual({ users: 6, organizations: 2, memberships: 8 }); // idempotent
// lukas has 2 ACTIVE memberships; Paul Weber membership has userId null and email null
// POST /api/auth/sign-in/email with Anna@ShiftSwap.test (mixed case, lowercased by client) + DEMO_PASSWORD → 200
```
`ensure-auth-secret.spec.ts` (temp dir):
```ts
expect(ensureAuthSecret(file, { BETTER_AUTH_SECRET: 'from-env' })).toBe('from-env'); // file not created
const a = ensureAuthSecret(file, {}); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
expect(ensureAuthSecret(file, {})).toBe(a); // reused, not regenerated
```
`demo-accounts-doc.spec.ts`: every `DEMO_ACCOUNTS[i].email` and `DEMO_PASSWORD` appear in `DEMO_ACCOUNTS.md`.

- [ ] **Step 2: Run to verify failures** → FAIL.

- [ ] **Step 3: Implement**

- `seedDemo`: inside one flow — delete `memberships`, `organizations`, `sessions`, `accounts`, `verifications`, `users`; create users via `auth.api.signUpEmail({ body: { email, password: DEMO_PASSWORD, name } })` (library hashing, never hand-hashed); create orgs and memberships; return counts from the DB.
- `ensureAuthSecret`: env var wins; else read `BETTER_AUTH_SECRET=` line from file; else `randomBytes(32).toString('base64url')`, write file with mode `0o600`, return.
- `start.ts`: `process.env.BETTER_AUTH_SECRET = ensureAuthSecret(process.env.AUTH_SECRET_FILE ?? '/data/auth-secret.env', process.env)` → `execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' })` → if `SEED_ON_START === 'true'` run `seedDemo` and log counts (no PII) → `import('../main')`. Any failure exits non-zero so Compose restarts it.
- `DEMO_ACCOUNTS.md`: the table above, the password, and "Mailpit inbox: port 8025 (Ports tab)".

- [ ] **Step 4: Run tests** → PASS. Lint + typecheck PASS.

- [ ] **Step 5: Code review + commit** — `feat(api): seed demo accounts and bootstrap auth secret on start`

---

### Task 6: Web skeleton — login and organisation picker

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tailwind` config, `apps/web/src/main.tsx`, `apps/web/src/router.tsx`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/src/features/orgs/OrgPickerPage.tsx`, `apps/web/src/features/orgs/useMe.ts`, `apps/web/src/components/RequireAuth.tsx`
- Test: `apps/web/src/features/auth/LoginPage.test.tsx`, `apps/web/src/features/orgs/OrgPickerPage.test.tsx`, `apps/web/vite.config.test.ts`

**Interfaces:**
- Consumes: `loginSchema` (Task 2); `GET /api/v1/me` shape (Task 4).
- Produces: routes `/login`, `/orgs` (protected), `/` → redirect to `/orgs`; `authClient` from `createAuthClient({ baseURL: window.location.origin })` (`better-auth/react`); `apiFetch<T>(path: string): Promise<T>` (credentials `include`, throws `ApiError { status: number }`); `viteServerOptions(env)` exported from `vite.config.ts` for testing.

- [ ] **Step 1: Write failing tests**

`LoginPage.test.tsx` (mock `authClient.signIn.email`):
- Inputs found by label `Email` and `Password`; button `Log in`.
- Submit empty → text `Enter a valid email address` visible, input has `aria-invalid="true"` and `aria-describedby` pointing at the message.
- signIn resolves `{ error: { status: 401 } }` → `role="alert"` with `Email or password is incorrect.`
- signIn success → navigates to `/orgs`.

`OrgPickerPage.test.tsx` (mock `apiFetch`): heading `Choose an organisation`; one link per membership showing org name and access level (`Café Lindenhof · Employee`); empty memberships → `You are not a member of any organisation yet.`

`vite.config.test.ts`: `viteServerOptions({ API_PROXY_TARGET: 'http://api:3000' })` → `proxy['/api'].target === 'http://api:3000'`; default target `http://localhost:3000`; `allowedHosts` contains `.app.github.dev` and `localhost`; same object applied to `server` and `preview`.

- [ ] **Step 2: Run to verify failures** — `npm test -w apps/web` → FAIL.

- [ ] **Step 3: Implement** — React Router data router; TanStack Query `QueryClient` (refetchOnWindowFocus true); `RequireAuth` uses `authClient.useSession()` and redirects to `/login`; `LoginPage` uses React Hook Form + `zodResolver(loginSchema)`, error region `aria-live="polite"`; shadcn/ui `Button`, `Input`, `Label`, `Card`. Vite `server` and `preview` both: `host: '0.0.0.0'`, `port: 5173`, `strictPort: true`, `allowedHosts`, `proxy: { '/api': { target, changeOrigin: false } }` (keep the browser's Origin header for Better Auth's origin check).

- [ ] **Step 4: Run tests** → PASS. `npm run build -w apps/web` succeeds. Lint + typecheck PASS.

- [ ] **Step 5: Code review + commit** — `feat(web): add login page and organisation picker`

---

### Task 7: Containers — full Compose stack

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.dockerignore`
- Modify: `docker-compose.yml` (add `mailpit`, `api`, `web`)

**Interfaces:**
- Consumes: `start.ts` (Task 5), Vite preview config (Task 6).
- Produces: `docker compose up -d --wait` → web on `http://localhost:5173`, Mailpit on `http://localhost:8025`, seeded demo data.

- [ ] **Step 1: Dockerfiles** (build context = repo root)
  - API: stage `deps` (`npm ci --workspaces --include-workspace-root`), stage `build` (`prisma generate`, build shared + api), stage `runtime` (`node:22-bookworm-slim`, `openssl` installed for Prisma, non-root `node` user, copies `dist`, `prisma/`, production `node_modules` — `prisma` CLI must be a regular `dependency` of `apps/api` because `start.ts` runs `prisma migrate deploy` at runtime; `CMD ["node", "dist/bootstrap/start.js"]`).
  - Web: build stage runs `npm run build -w apps/web`; runtime keeps `node_modules` needed by `vite preview`; `CMD ["npx", "vite", "preview"]` from `apps/web`.
- [ ] **Step 2: Compose services**
  - `mailpit`: `axllent/mailpit:<current pinned tag>`, ports `8025:8025`.
  - `api`: build `apps/api/Dockerfile`; env `DATABASE_URL=postgresql://shiftswap:shiftswap@db:5432/shiftswap`, `SEED_ON_START=true`, `ALLOW_CODESPACE_ORIGINS=true`, `AUTH_SECRET_FILE=/data/auth-secret.env`, `TRUSTED_ORIGINS=http://127.0.0.1:5173`, pass-through `CODESPACE_NAME`, `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`; volume `api-data:/data`; `depends_on: db: condition: service_healthy`; `restart: unless-stopped`; healthcheck `node -e "fetch('http://localhost:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, `start_period: 60s`.
  - `web`: build `apps/web/Dockerfile`; env `API_PROXY_TARGET=http://api:3000`; ports `5173:5173`; `depends_on: api: condition: service_healthy`; `restart: unless-stopped`.
- [ ] **Step 3: Verify the stack**

```bash
docker compose down -v && docker compose up -d --build --wait
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/login        # 200
curl -s -c /tmp/c -H 'Origin: http://localhost:5173' -H 'Content-Type: application/json' \
  -d '{"email":"anna@shiftswap.test","password":"ShiftSwap-Demo-2026"}' \
  http://localhost:5173/api/auth/sign-in/email -o /dev/null -w '%{http_code}\n'  # 200
curl -s -b /tmp/c http://localhost:5173/api/v1/me | grep -c 'Café Lindenhof'      # 1
docker compose restart api && docker compose up -d --wait && curl … sign-in again # 200 (restart-safe)
```

- [ ] **Step 4: Code review + commit** — `build: containerise api and web and run full stack with Compose`

---

### Task 8: Dev Container for zero-setup Codespaces + README

**Files:**
- Create: `.devcontainer/devcontainer.json`, `.devcontainer/docker-compose.devcontainer.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `docker-compose.yml` (Task 7).
- Produces: opening a Codespace (or `devcontainer up`) starts all services and auto-opens port 5173.

- [ ] **Step 1: `docker-compose.devcontainer.yml`** — adds `workspace` service: `mcr.microsoft.com/devcontainers/typescript-node:22`, `volumes: ['..:/workspaces/ShiftSwap:cached']`, `command: sleep infinity`.

- [ ] **Step 2: `devcontainer.json`**

```jsonc
{
  "name": "ShiftSwap",
  "dockerComposeFile": ["../docker-compose.yml", "docker-compose.devcontainer.yml"],
  "service": "workspace",
  "workspaceFolder": "/workspaces/ShiftSwap",
  "runServices": ["db", "mailpit", "api", "web", "workspace"],
  "forwardPorts": [5173, 8025],
  "portsAttributes": {
    "5173": { "label": "ShiftSwap", "onAutoForward": "openBrowser" },
    "8025": { "label": "Mailpit (demo inbox)", "onAutoForward": "silent" },
    "5432": { "onAutoForward": "ignore" }
  },
  "onCreateCommand": "npm ci",
  "customizations": { "codespaces": { "openFiles": ["DEMO_ACCOUNTS.md"] } }
}
```

No `postStartCommand`: services start themselves via Compose. `CODESPACE_NAME` and `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` reach `api` via the Compose pass-through from Task 7.

- [ ] **Step 3: Verify locally with the Dev Containers CLI**

```bash
docker compose down -v
npx @devcontainers/cli up --workspace-folder .
npx wait-on -t 180000 http-get://localhost:5173/login && echo READY
```
Expected: `READY`, and sign-in curl from Task 7 Step 3 returns 200.

- [ ] **Step 4: README** — sections: what ShiftSwap is (2 lines); **Try it** with badge `[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Bashlenix/ShiftSwap?quickstart=1)` and "a browser tab with the login page opens after about a minute; nothing to type in the terminal"; demo accounts table + password (same as `DEMO_ACCOUNTS.md`); Mailpit via the Ports tab; "If no tab opened: Ports tab → ShiftSwap → globe icon"; local fallback `docker compose up` for developers; link to `docs/sdd.md`.

- [ ] **Step 5: Code review + commit** — `build: add dev container for zero-setup Codespaces and README`

---

### Task 9: CI with zero-setup check and E2E login test, then PR

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tests/login.spec.ts`

**Interfaces:**
- Consumes: full stack (Tasks 7–8), demo accounts (Task 5).
- Produces: required checks `checks` and `zero-setup` on every PR and push to `main`.

- [ ] **Step 1: Write E2E tests** `e2e/tests/login.spec.ts` (`baseURL` `http://localhost:5173`)

```ts
test('Anna logs in with the README credentials and sees her organisation', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('anna@shiftswap.test');
  await page.getByLabel('Password').fill('ShiftSwap-Demo-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Café Lindenhof/ })).toBeVisible();
});
test('Lukas sees both organisations', …expects Café Lindenhof and Hotel Seeblick);
test('wrong password shows a generic error', …expects alert "Email or password is incorrect.");
test('login page has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/login');
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact!))).toEqual([]);
});
```

- [ ] **Step 2: Run against the local stack** — `docker compose up -d --wait && npx playwright test -c e2e` → 4 PASS.

- [ ] **Step 3: `ci.yml`** (triggers: `pull_request`, `push` to `main`)
  - Job `checks`: checkout, `actions/setup-node` with `.nvmrc` + npm cache, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e -w apps/api` with `services.postgres` (`postgres:17-alpine`, same credentials, health options), `npm audit --audit-level=critical`, `gitleaks/gitleaks-action`.
  - Job `zero-setup` (needs `checks`): `npx @devcontainers/cli up --workspace-folder .`, `npx wait-on -t 300000 http-get://localhost:5173/login`, `npx playwright install --with-deps chromium`, `npx playwright test -c e2e`, upload `playwright-report` on failure, print `docker compose logs api web` on failure.
  - `dependabot.yml`: weekly for `npm` (root) and `github-actions`.

- [ ] **Step 4: Push and open PR** (body in English, no Claude attribution)

```bash
git push
GH_TOKEN=$(gh auth token -u Bashlenix) gh pr create --repo Bashlenix/ShiftSwap \
  --base main --head chore/bashi-23.10.2026-repo-scaffold \
  --title "Zero-setup skeleton: Codespaces, auth, demo seed, CI"
GH_TOKEN=$(gh auth token -u Bashlenix) gh pr checks --repo Bashlenix/ShiftSwap --watch
```
Expected: `checks` and `zero-setup` both pass.

- [ ] **Step 5: Owner-only manual settings** (repo owner in the browser, once — not the professor)
  - Settings → Codespaces → Set up prebuild: branch `main`, trigger "On push", region Europe West.
  - Settings → Branches → protect `main`: require PR, require checks `checks` and `zero-setup`.

- [ ] **Step 6: Acceptance — real Codespace** after merge: open the README badge in a private browser session logged in as a second account (or Bashlenix), measure time to login page (target ≤ 90 s with prebuild, SDD §40), log in as `anna@shiftswap.test`, confirm Mailpit opens from the Ports tab. Record the measured time in the PR or README.
