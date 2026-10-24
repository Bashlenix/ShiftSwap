import type { AccessLevel, MemberDto } from '@shiftswap/shared';

export type MemberSortKey = 'name' | 'access' | 'skills' | 'weeklyLimit' | 'status';
export type SortDir = 'asc' | 'desc';

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

const ACCESS_RANK: Record<AccessLevel, number> = { EMPLOYEE: 0, MANAGER: 1, ADMIN: 2 };

/** Display status of a member; the order here is the status sort order. */
export const MEMBER_STATUSES = ['Active', 'Invite pending', 'No login', 'Deactivated'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export function memberStatus(m: MemberDto): MemberStatus {
  if (m.status === 'DEACTIVATED') return 'Deactivated';
  if (m.invitePending) return 'Invite pending';
  if (!m.hasLogin) return 'No login';
  return 'Active';
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

export function filterMembers(
  members: MemberDto[],
  query: string,
  skillName: (id: string) => string,
): MemberDto[] {
  const q = fold(query.trim());
  if (q === '') return members;
  return members.filter((m) =>
    [m.displayName, m.email ?? '', ACCESS_LABEL[m.accessLevel], ...m.skillIds.map(skillName)].some(
      (field) => fold(field).includes(q),
    ),
  );
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function sortMembers(
  members: MemberDto[],
  key: MemberSortKey,
  dir: SortDir,
  skillName: (id: string) => string,
): MemberDto[] {
  const sign = dir === 'asc' ? 1 : -1;
  const skillText = (m: MemberDto) => m.skillIds.map(skillName).sort(byText).join(', ');
  const primary = (a: MemberDto, b: MemberDto): number => {
    switch (key) {
      case 'name':
        return byText(a.displayName, b.displayName);
      case 'access':
        return ACCESS_RANK[a.accessLevel] - ACCESS_RANK[b.accessLevel];
      case 'skills':
        return a.skillIds.length - b.skillIds.length || byText(skillText(a), skillText(b));
      case 'status':
        return MEMBER_STATUSES.indexOf(memberStatus(a)) - MEMBER_STATUSES.indexOf(memberStatus(b));
      default:
        return 0;
    }
  };
  const tieBreak = (a: MemberDto, b: MemberDto) =>
    byText(a.displayName, b.displayName) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...members].sort((a, b) => {
    if (key === 'weeklyLimit') {
      // null (org default) is always last, whatever the direction.
      if (a.weeklyLimitMin === null && b.weeklyLimitMin !== null) return 1;
      if (a.weeklyLimitMin !== null && b.weeklyLimitMin === null) return -1;
      const d = (a.weeklyLimitMin ?? 0) - (b.weeklyLimitMin ?? 0);
      return sign * d || tieBreak(a, b);
    }
    return sign * primary(a, b) || tieBreak(a, b);
  });
}
