# Demo accounts

Password for every account: `ShiftSwap-Demo-2026`

| Email                | Name         | Memberships                                          |
| -------------------- | ------------ | ---------------------------------------------------- |
| maria@shiftswap.test | Maria Keller | Café Lindenhof — ADMIN                               |
| tom@shiftswap.test   | Tom Becker   | Café Lindenhof — MANAGER                             |
| anna@shiftswap.test  | Anna Schmidt | Café Lindenhof — EMPLOYEE                            |
| lukas@shiftswap.test | Lukas Wolf   | Café Lindenhof — EMPLOYEE; Hotel Seeblick — EMPLOYEE |
| mia@shiftswap.test   | Mia Hoffmann | Café Lindenhof — EMPLOYEE                            |
| sara@shiftswap.test  | Sara Yilmaz  | Hotel Seeblick — ADMIN                               |

Placeholder (no login, no email): Paul Weber, Café Lindenhof — EMPLOYEE.

Demo inbox (Mailpit): not exposed yet — no feature sends email yet.

## Two-minute demo

Seeded shifts are relative to today (Europe/Berlin) and reset on every API start. Skills: Café Lindenhof has Barista, Service, Kitchen; Hotel Seeblick has Front desk.

1. Log in as Tom (manager) → Offer review → open Anna's give-away offer → see each candidate's score breakdown (Lukas and Mia) → approve Lukas.
2. Log in as Lukas → Open offers does not list the Barista open shift (it would put him over the daily hour limit).
3. Log in as Anna → Open offers → claim the Barista shift.
