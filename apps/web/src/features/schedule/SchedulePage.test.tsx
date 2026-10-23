import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGER_ORG, renderWithOrg, TEST_ORG } from '../../test-utils';
import { SchedulePage } from './SchedulePage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const members = [
  {
    id: 'm1',
    displayName: 'Anna Beck',
    accessLevel: 'EMPLOYEE',
    status: 'ACTIVE',
    hasLogin: true,
    skillIds: ['sk1'],
    weeklyLimitMin: null,
  },
  {
    id: 'm2',
    displayName: 'Lukas Wolf',
    accessLevel: 'EMPLOYEE',
    status: 'ACTIVE',
    hasLogin: true,
    skillIds: [],
    weeklyLimitMin: null,
  },
];

const shift = (id: string, startAt: string, endAt: string, extra: object = {}) => ({
  id,
  startAt,
  endAt,
  requiredSkillIds: ['sk1'],
  assignedMembershipId: 'm1',
  location: null,
  notes: null,
  version: 1,
  openOfferId: null,
  ...extra,
});

function setup(shifts: unknown[]) {
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/members')) return Promise.resolve(members);
    if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
    if (path.includes('/shifts')) return Promise.resolve(shifts);
    return Promise.reject(new Error('unexpected ' + path));
  });
}

describe('SchedulePage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('tells employees it is managers only and calls no API', () => {
    renderWithOrg(<SchedulePage />, TEST_ORG, '/schedule?week=2026-W45');
    expect(screen.getByText('Only managers can see this page.')).toBeVisible();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders 7 day columns, member rows plus Unassigned, and a caption', async () => {
    setup([]);
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    const table = await screen.findByRole('table');
    expect(await within(table).findByRole('rowheader', { name: 'Anna Beck' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Lukas Wolf' })).toBeVisible();
    expect(within(table).getByRole('rowheader', { name: 'Unassigned' })).toBeVisible();
    // 7 days + the member column header
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
    expect(within(table).getByText(/^Week of /)).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/v1/orgs/org-1/shifts?from=${encodeURIComponent('2026-11-01T23:00:00.000Z')}&to=${encodeURIComponent('2026-11-08T23:00:00.000Z')}`,
    );
  });

  it('puts a shift in its row and day cell, and an overnight shift in its start day', async () => {
    setup([
      // Tue 3 Nov 09:00-13:00 Berlin
      shift('s1', '2026-11-03T08:00:00Z', '2026-11-03T12:00:00Z'),
      // Sat 7 Nov 22:00 -> Sun 8 Nov 06:00 Berlin, offered, unassigned
      shift('s2', '2026-11-07T21:00:00Z', '2026-11-08T05:00:00Z', {
        assignedMembershipId: null,
        openOfferId: 'o1',
      }),
    ]);
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    const table = await screen.findByRole('table');
    const anna = (await within(table).findByRole('rowheader', { name: 'Anna Beck' })).closest(
      'tr',
    )!;
    const annaCells = within(anna).getAllByRole('cell');
    expect(
      within(annaCells[1]).getByRole('button', { name: /09:00–13:00 · Barista/ }),
    ).toBeVisible();
    const un = within(table).getByRole('rowheader', { name: 'Unassigned' }).closest('tr')!;
    const unCells = within(un).getAllByRole('cell');
    const night = within(unCells[5]).getByRole('button', { name: /22:00–06:00/ });
    expect(within(night).getByText('Open shift')).toBeVisible();
    expect(within(unCells[6]).queryByRole('button')).toBeNull();
  });

  it('shows the Offered badge on an assigned shift with an open offer', async () => {
    setup([shift('s1', '2026-11-03T08:00:00Z', '2026-11-03T12:00:00Z', { openOfferId: 'o1' })]);
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    expect(await screen.findByText('Offered')).toBeVisible();
  });

  it('has previous and next week links that update ?week=', async () => {
    setup([]);
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    expect(await screen.findByRole('link', { name: 'Previous week' })).toHaveAttribute(
      'href',
      '/schedule?week=2026-W44',
    );
    expect(screen.getByRole('link', { name: 'Next week' })).toHaveAttribute(
      'href',
      '/schedule?week=2026-W46',
    );
  });

  it('opens the shift dialog from New shift and from a shift button', async () => {
    setup([shift('s1', '2026-11-03T08:00:00Z', '2026-11-03T12:00:00Z')]);
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    await userEvent.click(await screen.findByRole('button', { name: 'New shift' }));
    expect(await screen.findByRole('dialog', { name: 'New shift' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: /09:00–13:00/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit shift' })).toBeVisible();
  });

  it('falls back to the current week for an invalid ?week=', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    try {
      setup([]);
      renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=banana');
      expect(await screen.findByRole('link', { name: 'Next week' })).toHaveAttribute(
        'href',
        '/schedule?week=2026-W46',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the notice in the page Feedback after a save', async () => {
    setup([]);
    apiSend.mockResolvedValue({
      shift: shift('n1', '2026-11-03T08:00:00Z', '2026-11-03T12:00:00Z'),
      warnings: [],
    });
    renderWithOrg(<SchedulePage />, MANAGER_ORG, '/schedule?week=2026-W45');
    await userEvent.click(await screen.findByRole('button', { name: 'New shift' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save shift' }));
    expect(await screen.findByText('Shift saved.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
