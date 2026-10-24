import { describe, expect, it } from 'vitest';
import type { MemberDto } from '@shiftswap/shared';
import { filterMembers, sortMembers } from './member-table';

const m = (id: string, name: string, extra: Partial<MemberDto> = {}): MemberDto => ({
  id,
  displayName: name,
  accessLevel: 'EMPLOYEE',
  email: `${id}@example.com`,
  status: 'ACTIVE',
  hasLogin: true,
  invitePending: false,
  skillIds: [],
  weeklyLimitMin: null,
  ...extra,
});

const skillName = (id: string) => ({ s1: 'Barista', s2: 'Kitchen' })[id] ?? id;
const ids = (list: MemberDto[]) => list.map((x) => x.id);

describe('filterMembers', () => {
  const people = [
    m('a', 'José Álvarez', { email: 'jose@cafe.de' }),
    m('b', 'Anna Beck', { skillIds: ['s1'], accessLevel: 'MANAGER' }),
    m('c', 'Tom', { email: null, skillIds: ['s2'], accessLevel: 'ADMIN' }),
  ];

  it('matches everyone for an empty or blank query', () => {
    expect(filterMembers(people, '', skillName)).toHaveLength(3);
    expect(filterMembers(people, '   ', skillName)).toHaveLength(3);
  });

  it('ignores case and accents in both directions', () => {
    expect(ids(filterMembers(people, 'jose', skillName))).toEqual(['a']);
    expect(ids(filterMembers(people, 'ÁLVAREZ', skillName))).toEqual(['a']);
    expect(ids(filterMembers([m('x', 'Jose')], 'josé', skillName))).toEqual(['x']);
  });

  it('trims the query', () => {
    expect(ids(filterMembers(people, '  anna ', skillName))).toEqual(['b']);
  });

  it('matches email, skill names and the access label', () => {
    expect(ids(filterMembers(people, 'cafe.de', skillName))).toEqual(['a']);
    expect(ids(filterMembers(people, 'barista', skillName))).toEqual(['b']);
    expect(ids(filterMembers(people, 'kitchen', skillName))).toEqual(['c']);
    expect(ids(filterMembers(people, 'manager', skillName))).toEqual(['b']);
    expect(ids(filterMembers(people, 'admin', skillName))).toEqual(['c']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterMembers(people, 'zzz', skillName)).toEqual([]);
  });
});

describe('sortMembers', () => {
  it('sorts by name ignoring case and accents', () => {
    const list = [m('1', 'zoe'), m('2', 'Álvaro'), m('3', 'Bea')];
    expect(ids(sortMembers(list, 'name', 'asc', skillName))).toEqual(['2', '3', '1']);
    expect(ids(sortMembers(list, 'name', 'desc', skillName))).toEqual(['1', '3', '2']);
  });

  it('sorts access Employee < Manager < Admin', () => {
    const list = [
      m('1', 'A', { accessLevel: 'ADMIN' }),
      m('2', 'B', { accessLevel: 'EMPLOYEE' }),
      m('3', 'C', { accessLevel: 'MANAGER' }),
    ];
    expect(ids(sortMembers(list, 'access', 'asc', skillName))).toEqual(['2', '3', '1']);
    expect(ids(sortMembers(list, 'access', 'desc', skillName))).toEqual(['1', '3', '2']);
  });

  it('sorts skills by count, then by skill names', () => {
    const list = [
      m('1', 'A', { skillIds: ['s1', 's2'] }),
      m('2', 'B', { skillIds: ['s2'] }),
      m('3', 'C', { skillIds: ['s1'] }),
      m('4', 'D', { skillIds: [] }),
    ];
    expect(ids(sortMembers(list, 'skills', 'asc', skillName))).toEqual(['4', '3', '2', '1']);
  });

  it('puts null weekly limits last in both directions', () => {
    const list = [
      m('1', 'A', { weeklyLimitMin: null }),
      m('2', 'B', { weeklyLimitMin: 2400 }),
      m('3', 'C', { weeklyLimitMin: 600 }),
    ];
    expect(ids(sortMembers(list, 'weeklyLimit', 'asc', skillName))).toEqual(['3', '2', '1']);
    expect(ids(sortMembers(list, 'weeklyLimit', 'desc', skillName))).toEqual(['2', '3', '1']);
  });

  it('sorts status Active < Invited < No login < Deactivated', () => {
    const list = [
      m('1', 'A', { status: 'DEACTIVATED' }),
      m('2', 'B', { hasLogin: false }),
      m('3', 'C', { hasLogin: false, invitePending: true }),
      m('4', 'D'),
    ];
    expect(ids(sortMembers(list, 'status', 'asc', skillName))).toEqual(['4', '3', '2', '1']);
    expect(ids(sortMembers(list, 'status', 'desc', skillName))).toEqual(['1', '2', '3', '4']);
  });

  it('breaks ties by name, then id, and keeps that order in desc', () => {
    const list = [
      m('3', 'Same', { weeklyLimitMin: 600 }),
      m('1', 'Same', { weeklyLimitMin: 600 }),
      m('2', 'Abe', { weeklyLimitMin: 600 }),
    ];
    expect(ids(sortMembers(list, 'weeklyLimit', 'asc', skillName))).toEqual(['2', '1', '3']);
    expect(ids(sortMembers(list, 'weeklyLimit', 'desc', skillName))).toEqual(['2', '1', '3']);
  });

  it('does not mutate its input', () => {
    const list = [m('2', 'B'), m('1', 'A')];
    sortMembers(list, 'name', 'asc', skillName);
    expect(ids(list)).toEqual(['2', '1']);
  });
});
