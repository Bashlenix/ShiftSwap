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

Pending invite (no login yet): Jonas Braun, `jonas@shiftswap.test`, Café Lindenhof — EMPLOYEE.

Demo inbox: open /mailpit/ on the app address.

## Two-minute demo

Seeded shifts are relative to today (Europe/Berlin) and reset on every API start. Skills: Café Lindenhof has Barista, Service, Kitchen; Hotel Seeblick has Front desk.

1. Log in as Tom (manager) → Offer review → open Anna's give-away offer → see each candidate's score breakdown (Lukas and Mia) → approve Lukas.
2. Log in as Lukas → Open offers does not list the Barista open shift (he fails the daily hour limit and minimum rest).
3. Log in as Anna → Open offers → claim the Barista shift.
4. Log in as Maria (admin) → Members → Add person with a fresh email → open the demo inbox (`/mailpit/`) → open the invite link → Create account → you land in Café Lindenhof as the new member. Seeded extra: Jonas Braun (`jonas@shiftswap.test`) already has a pending invite (the seed sends no email; use Resend invite on Members to get the mail).
5. Log in as Tom → the nav shows Notifications (2 unread acceptances on Anna's give-away) → Mark all as read.
6. Log in as Maria → Members → Deactivate Mia → her future shifts show as open shifts in Schedule.
7. Log in as Anna → Availability → Weekly preferences: set a time to Preferred or Avoid. Preferences only affect ranking; they never block a shift. Lukas and Mia have seeded preferences that change the ranking Tom sees in step 1 (Lukas +40, Mia +0).
8. Swap events send email: after Tom approves Lukas in step 1, Lukas gets an email in the demo inbox (`/mailpit/`).
9. Log in as a non-admin demo account (for example Anna or Mia) → Account → Delete account. Deleting a demo account lasts only until the Codespace restarts, because the demo data is re-seeded on every API start. Maria and Sara are the only admins of their organisations, so deleting them is blocked with "You are the last admin of {organisation name}. Make another member an admin first."
