# ShiftSwap

ShiftSwap is a multi-tenant B2B web app that replaces WhatsApp-style shift swapping with a validated, auditable workflow for small shift-based businesses (restaurants, cafés, hotels, retail).

## Try it

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Bashlenix/ShiftSwap?quickstart=1)

Click the badge. A browser tab with the login page opens after a few minutes on the first start (faster once the prebuild is set up). Nothing to type in the terminal.

Password for every account: `ShiftSwap-Demo-2026`

| Email | Name | Memberships |
| --- | --- | --- |
| maria@shiftswap.test | Maria Keller | Café Lindenhof — ADMIN |
| tom@shiftswap.test | Tom Becker | Café Lindenhof — MANAGER |
| anna@shiftswap.test | Anna Schmidt | Café Lindenhof — EMPLOYEE |
| lukas@shiftswap.test | Lukas Wolf | Café Lindenhof — EMPLOYEE; Hotel Seeblick — EMPLOYEE |
| mia@shiftswap.test | Mia Hoffmann | Café Lindenhof — EMPLOYEE |
| sara@shiftswap.test | Sara Yilmaz | Hotel Seeblick — ADMIN |

Demo emails land in Mailpit: Ports tab → "Mailpit (demo inbox)" (port 8025).

If no tab opened: Ports tab → ShiftSwap → globe icon.

## Run locally (developers)

```bash
docker compose up
```

Then open http://127.0.0.1:5173.

## Docs

See [docs/sdd.md](docs/sdd.md) for the full software design document.
