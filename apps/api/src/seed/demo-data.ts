import { DateTime } from 'luxon';
import type { PreferenceSlot, PreferenceValue } from '@shiftswap/shared';
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

/** Pending invite: a roster entry with an email but no login yet. The seed sends no email. */
export const DEMO_INVITES: {
  org: DemoOrgKey;
  email: string;
  displayName: string;
  accessLevel: AccessLevel;
  skills: string[];
  createdBy: string;
}[] = [
  {
    org: 'lindenhof',
    email: 'jonas@shiftswap.test',
    displayName: 'Jonas Braun',
    accessLevel: 'EMPLOYEE',
    skills: ['Service'],
    createdBy: 'maria@shiftswap.test',
  },
];

export const DEMO_SKILLS: { org: DemoOrgKey; name: string }[] = [
  { org: 'lindenhof', name: 'Barista' },
  { org: 'lindenhof', name: 'Service' },
  { org: 'lindenhof', name: 'Kitchen' },
  { org: 'seeblick', name: 'Front desk' },
];

/** Keyed by email (login accounts) or placeholder name; skills are scoped per org. */
export const DEMO_MEMBER_SKILLS: { member: string; org: DemoOrgKey; skills: string[] }[] = [
  { member: 'maria@shiftswap.test', org: 'lindenhof', skills: ['Barista', 'Service', 'Kitchen'] },
  { member: 'tom@shiftswap.test', org: 'lindenhof', skills: ['Barista', 'Service', 'Kitchen'] },
  { member: 'anna@shiftswap.test', org: 'lindenhof', skills: ['Barista', 'Service'] },
  { member: 'lukas@shiftswap.test', org: 'lindenhof', skills: ['Barista', 'Service'] },
  { member: 'lukas@shiftswap.test', org: 'seeblick', skills: ['Front desk'] },
  { member: 'mia@shiftswap.test', org: 'lindenhof', skills: ['Service'] },
  { member: 'Paul Weber', org: 'lindenhof', skills: ['Kitchen'] },
  { member: 'sara@shiftswap.test', org: 'seeblick', skills: ['Front desk'] },
];

/** Keyed by email; one row per weekday (0 = Monday). Only non-neutral values are stored. */
export const DEMO_PREFERENCES: {
  member: string;
  org: DemoOrgKey;
  slot: PreferenceSlot;
  value: PreferenceValue;
  weekdays: number[];
}[] = [
  {
    member: 'lukas@shiftswap.test',
    org: 'lindenhof',
    slot: 'EVENING',
    value: 'PREFERRED',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    member: 'mia@shiftswap.test',
    org: 'lindenhof',
    slot: 'EVENING',
    value: 'AVOID',
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  },
];

export interface DemoShift {
  key: string;
  org: DemoOrgKey;
  dayOffset: number;
  start: string;
  end: string;
  skills: string[];
  /** Email, placeholder name, or null for unassigned. */
  assignee: string | null;
}

/** Times are org-local (Europe/Berlin); dayOffset 0 = today. End <= start means next day. */
export const DEMO_SHIFTS: DemoShift[] = [
  {
    key: 'L1',
    org: 'lindenhof',
    dayOffset: 1,
    start: '07:00',
    end: '13:00',
    skills: ['Barista'],
    assignee: 'anna@shiftswap.test',
  },
  {
    key: 'L2',
    org: 'lindenhof',
    dayOffset: 1,
    start: '13:00',
    end: '19:00',
    skills: ['Service'],
    assignee: 'mia@shiftswap.test',
  },
  {
    key: 'L3',
    org: 'lindenhof',
    dayOffset: 2,
    start: '07:00',
    end: '13:00',
    skills: ['Barista'],
    assignee: null,
  },
  {
    key: 'L4',
    org: 'lindenhof',
    dayOffset: 2,
    start: '17:00',
    end: '23:00',
    skills: ['Service'],
    assignee: 'lukas@shiftswap.test',
  },
  {
    key: 'L5',
    org: 'lindenhof',
    dayOffset: 3,
    start: '18:00',
    end: '23:00',
    skills: ['Service'],
    assignee: 'anna@shiftswap.test',
  },
  {
    key: 'L6',
    org: 'lindenhof',
    dayOffset: 4,
    start: '07:00',
    end: '15:00',
    skills: ['Kitchen'],
    assignee: 'Paul Weber',
  },
  {
    key: 'L7',
    org: 'lindenhof',
    dayOffset: 5,
    start: '10:00',
    end: '16:00',
    skills: ['Barista', 'Service'],
    assignee: 'tom@shiftswap.test',
  },
  {
    key: 'L8',
    org: 'lindenhof',
    dayOffset: 6,
    start: '22:00',
    end: '06:00',
    skills: ['Service'],
    assignee: 'mia@shiftswap.test',
  },
  {
    key: 'S1',
    org: 'seeblick',
    dayOffset: 3,
    start: '08:00',
    end: '14:00',
    skills: ['Front desk'],
    assignee: 'lukas@shiftswap.test',
  },
  {
    key: 'S2',
    org: 'seeblick',
    dayOffset: 4,
    start: '14:00',
    end: '22:00',
    skills: ['Front desk'],
    assignee: 'sara@shiftswap.test',
  },
];

export const DEMO_OFFER_LEAD_MIN = 120;

export interface DemoOffer {
  shift: string;
  kind: 'GIVE_AWAY' | 'OPEN_SHIFT';
  createdBy: string;
  originalOwner: string | null;
  /** Emails in acceptance order (earliest first). */
  acceptances: string[];
}

export const DEMO_OFFERS: DemoOffer[] = [
  {
    shift: 'L5',
    kind: 'GIVE_AWAY',
    createdBy: 'anna@shiftswap.test',
    originalOwner: 'anna@shiftswap.test',
    acceptances: ['lukas@shiftswap.test', 'mia@shiftswap.test'],
  },
  {
    shift: 'L3',
    kind: 'OPEN_SHIFT',
    createdBy: 'tom@shiftswap.test',
    originalOwner: null,
    acceptances: [],
  },
];

export interface DemoNotification {
  recipient: string;
  type: 'ACCEPTANCE_RECEIVED' | 'OFFER_CREATED';
  /** Key of the shift whose offer the notification is about. */
  shift: string;
  role: 'owner' | 'manager' | 'eligible';
}

/** Unread in-app notifications, as if the seeded offers had just been created and accepted. */
export const DEMO_NOTIFICATIONS: DemoNotification[] = [
  { recipient: 'tom@shiftswap.test', type: 'ACCEPTANCE_RECEIVED', shift: 'L5', role: 'manager' },
  { recipient: 'tom@shiftswap.test', type: 'ACCEPTANCE_RECEIVED', shift: 'L5', role: 'manager' },
  { recipient: 'anna@shiftswap.test', type: 'OFFER_CREATED', shift: 'L3', role: 'eligible' },
];

/** Org-local wall time (`today` + dayOffset days at HH:mm) as a UTC instant. */
export function demoInstant(today: DateTime, dayOffset: number, hhmm: string, tz: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  const day = today.setZone(tz).startOf('day').plus({ days: dayOffset });
  return day.set({ hour, minute }).toJSDate();
}

export function demoShiftWindow(
  today: DateTime,
  shift: Pick<DemoShift, 'dayOffset' | 'start' | 'end'>,
  tz: string,
): { startAt: Date; endAt: Date } {
  const startAt = demoInstant(today, shift.dayOffset, shift.start, tz);
  let endAt = demoInstant(today, shift.dayOffset, shift.end, tz);
  if (endAt.getTime() <= startAt.getTime())
    endAt = demoInstant(today, shift.dayOffset + 1, shift.end, tz);
  return { startAt, endAt };
}
