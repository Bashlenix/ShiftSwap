import type { AccessLevel } from '../generated/prisma/client';

export const DEMO_PASSWORD = 'ShiftSwap-Demo-2026';

export type DemoOrgKey = 'lindenhof' | 'seeblick';

export const DEMO_ORGS: { key: DemoOrgKey; name: string }[] = [
  { key: 'lindenhof', name: 'Café Lindenhof' },
  { key: 'seeblick', name: 'Hotel Seeblick' },
];

export const DEMO_ACCOUNTS: {
  email: string;
  name: string;
  memberships: { org: DemoOrgKey; accessLevel: AccessLevel }[];
}[] = [
  {
    email: 'maria@shiftswap.test',
    name: 'Maria Keller',
    memberships: [{ org: 'lindenhof', accessLevel: 'ADMIN' }],
  },
  {
    email: 'tom@shiftswap.test',
    name: 'Tom Becker',
    memberships: [{ org: 'lindenhof', accessLevel: 'MANAGER' }],
  },
  {
    email: 'anna@shiftswap.test',
    name: 'Anna Schmidt',
    memberships: [{ org: 'lindenhof', accessLevel: 'EMPLOYEE' }],
  },
  {
    email: 'lukas@shiftswap.test',
    name: 'Lukas Wolf',
    memberships: [
      { org: 'lindenhof', accessLevel: 'EMPLOYEE' },
      { org: 'seeblick', accessLevel: 'EMPLOYEE' },
    ],
  },
  {
    email: 'mia@shiftswap.test',
    name: 'Mia Hoffmann',
    memberships: [{ org: 'lindenhof', accessLevel: 'EMPLOYEE' }],
  },
  {
    email: 'sara@shiftswap.test',
    name: 'Sara Yilmaz',
    memberships: [{ org: 'seeblick', accessLevel: 'ADMIN' }],
  },
];

/** Staff without a login or email: exist only as a name on the roster. */
export const DEMO_PLACEHOLDERS: { name: string; org: DemoOrgKey; accessLevel: AccessLevel }[] = [
  { name: 'Paul Weber', org: 'lindenhof', accessLevel: 'EMPLOYEE' },
];
