# ShiftSwap

ShiftSwap is a multi-tenant B2B web app that replaces WhatsApp-style shift swapping with a validated, auditable workflow for small shift-based businesses (restaurants, cafés, hotels, retail).

## Try it

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Bashlenix/ShiftSwap?quickstart=1)

Click the badge. A browser tab with the login page opens after a few minutes on the first start (faster once the prebuild is set up). Nothing to type in the terminal.

Password for every account: `ShiftSwap-Demo-2026`

| Email                | Name         | Memberships                                          |
| -------------------- | ------------ | ---------------------------------------------------- |
| maria@shiftswap.test | Maria Keller | Café Lindenhof — ADMIN                               |
| tom@shiftswap.test   | Tom Becker   | Café Lindenhof — MANAGER                             |
| anna@shiftswap.test  | Anna Schmidt | Café Lindenhof — EMPLOYEE                            |
| lukas@shiftswap.test | Lukas Wolf   | Café Lindenhof — EMPLOYEE; Hotel Seeblick — EMPLOYEE |
| mia@shiftswap.test   | Mia Hoffmann | Café Lindenhof — EMPLOYEE                            |
| sara@shiftswap.test  | Sara Yilmaz  | Hotel Seeblick — ADMIN                               |

Demo emails land in Mailpit: Ports tab → "Mailpit (demo inbox)" (port 8025).

If no tab opened: Ports tab → ShiftSwap → globe icon.

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
