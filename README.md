# ShiftSwap

ShiftSwap is a multi-tenant B2B web app that replaces WhatsApp-style shift swapping with a validated, auditable workflow for small shift-based businesses (restaurants, cafés, hotels, retail).

## Try it

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Bashlenix/ShiftSwap?quickstart=1)

Click the badge. A browser tab with the login page opens after about 5 minutes on the first start; much faster once the repository's Codespaces prebuild is enabled. Nothing to type in the terminal.

Password for every account: `ShiftSwap-Demo-2026`

| Email                | Name         | Memberships                                          |
| -------------------- | ------------ | ---------------------------------------------------- |
| maria@shiftswap.test | Maria Keller | Café Lindenhof — ADMIN                               |
| tom@shiftswap.test   | Tom Becker   | Café Lindenhof — MANAGER                             |
| anna@shiftswap.test  | Anna Schmidt | Café Lindenhof — EMPLOYEE                            |
| lukas@shiftswap.test | Lukas Wolf   | Café Lindenhof — EMPLOYEE; Hotel Seeblick — EMPLOYEE |
| mia@shiftswap.test   | Mia Hoffmann | Café Lindenhof — EMPLOYEE                            |
| sara@shiftswap.test  | Sara Yilmaz  | Hotel Seeblick — ADMIN                               |

### Screens

- **My shifts**: your next 14 days; offer a shift as a give-away.
- **Open offers**: accept a give-away or claim an open shift you are allowed to take.
- **Availability**: times you can't work (hard block).
- **Schedule** (managers): the week's roster.
- **Offer review** (managers): candidates with score breakdown; approve one.

### Two-minute demo

Seeded shifts are relative to today (Europe/Berlin) and reset on every API start. Skills: Café Lindenhof has Barista, Service, Kitchen; Hotel Seeblick has Front desk.

1. Log in as Tom (manager) → Offer review → open Anna's give-away offer → see each candidate's score breakdown (Lukas and Mia) → approve Lukas.
2. Log in as Lukas → Open offers does not list the Barista open shift (he fails the daily hour limit and minimum rest).
3. Log in as Anna → Open offers → claim the Barista shift.
4. Log in as Maria (admin) → Members → Add person with a fresh email → open the demo inbox (`/mailpit/`) → open the invite link → Create account → you land in Café Lindenhof as the new member. Seeded extra: Jonas Braun (`jonas@shiftswap.test`) already has a pending invite (the seed sends no email; use Resend invite on Members to get the mail).
5. Log in as Tom → the nav shows Notifications (2 unread acceptances on Anna's give-away) → Mark all as read.
6. Log in as Maria → Members → Deactivate Mia → her future shifts show as open shifts in Schedule.
7. Log in as Anna → Availability → Weekly preferences: set a time to Preferred or Avoid. Preferences only affect ranking; they never block a shift. Lukas and Mia have seeded preferences that change the ranking Tom sees in step 1 (Lukas +40, Mia +0).
8. Swap events send email: after Tom approves Lukas in step 1, Lukas gets an email in the demo inbox (`/mailpit/`).
9. Log in as any demo account → Account → Delete account. Deleting a demo account lasts only until the Codespace restarts, because the demo data is re-seeded on every API start.

Demo inbox: open `/mailpit/` on the app address (the same address as the app, for example `<app address>/mailpit/`).

If no tab opened: Ports tab → ShiftSwap (port 5173) → globe icon.

If something goes wrong in the Codespace, the terminal can show the server logs: `docker compose logs api` (or `web`, `db`). From your own machine: `gh codespace logs` or `gh codespace ssh`.

Restarting or resuming the Codespace resets the demo data and logs you out. That is on purpose: every start gives a clean demo.

## Run locally (developers)

```bash
docker compose up
```

Then open http://127.0.0.1:5173.

If a local Postgres already uses port 5432, publish the database on another port:

```bash
DB_PORT=5433 docker compose up
```

### Run the tests

```bash
docker compose up -d --wait db
npm ci
npm test
npm run test:e2e -w @shiftswap/api
```

With `DB_PORT=5433`, also set `DATABASE_URL=postgresql://shiftswap:shiftswap@localhost:5433/shiftswap` for the last command (it creates and uses a separate `shiftswap_test` database).

## Docs

See [docs/sdd.md](docs/sdd.md) for the full software design document.
