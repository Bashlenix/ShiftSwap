import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { MANAGER_ORG, renderWithOrg } from '../../test-utils';
import { ShiftDialog } from './ShiftDialog';

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
    accessLevel: 'EMPLOYEE' as const,
    status: 'ACTIVE',
    hasLogin: true,
    skillIds: [],
    weeklyLimitMin: null,
  },
];
const skills = [{ id: 'sk1', name: 'Barista' }];
const stored = {
  id: 's1',
  startAt: '2026-11-03T08:00:00Z',
  endAt: '2026-11-03T12:00:00Z',
  requiredSkillIds: ['sk1'],
  assignedMembershipId: 'm1',
  location: 'Terrace',
  notes: null,
  version: 3,
  openOfferId: null,
};

function open(shift: typeof stored | null = null) {
  const onClose = vi.fn();
  renderWithOrg(
    <ShiftDialog
      open
      shift={shift}
      defaultDate="2026-11-09"
      members={members}
      skills={skills}
      onClose={onClose}
    />,
    MANAGER_ORG,
  );
  return onClose;
}

async function fillTimes(start: string, end: string) {
  const s = screen.getByLabelText('Start');
  const e = screen.getByLabelText('End');
  await userEvent.clear(s);
  await userEvent.type(s, start);
  await userEvent.clear(e);
  await userEvent.type(e, end);
}

describe('ShiftDialog', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('has labelled fields', () => {
    open();
    for (const l of ['Date', 'Start', 'End', 'Assignee', 'Location', 'Notes'])
      expect(screen.getByLabelText(l)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Skills' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Barista' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument();
  });

  it('hints "Ends next day" when end is not after start', async () => {
    open();
    await fillTimes('22:00', '06:00');
    expect(screen.getByText('Ends next day')).toBeVisible();
    await fillTimes('09:00', '17:00');
    expect(screen.queryByText('Ends next day')).toBeNull();
  });

  it('creates with ISO instants for the org timezone, overnight rolling to the next day', async () => {
    apiSend.mockResolvedValue({ shift: { ...stored, id: 'new' }, warnings: [] });
    const onClose = open();
    await fillTimes('22:00', '06:00');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Barista' }));
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'm1');
    await userEvent.type(screen.getByLabelText('Location'), 'Bar');
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/shifts', {
        startAt: '2026-11-09T21:00:00.000Z',
        endAt: '2026-11-10T05:00:00.000Z',
        requiredSkillIds: ['sk1'],
        assignedMembershipId: 'm1',
        location: 'Bar',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notice: 'Shift saved.' }));
  });

  it('shows warnings as a non-blocking policy notice', async () => {
    apiSend.mockResolvedValue({
      shift: { ...stored, id: 'new' },
      warnings: ['MIN_REST', 'WEEKLY_LIMIT'],
    });
    const onClose = open();
    await fillTimes('09:00', '17:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    const msg =
      'Saved. Heads-up: Less than the minimum rest between shifts, Over the weekly hour limit (company policy check)';
    expect(await screen.findByText(msg)).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith({ notice: msg });
  });

  it('offers "Post as open shift" only for unassigned new shifts and posts the offer', async () => {
    apiSend.mockResolvedValue({ shift: { ...stored, id: 'new' }, warnings: [] });
    open();
    expect(screen.getByRole('checkbox', { name: 'Post as open shift' })).toBeVisible();
    await fillTimes('09:00', '17:00');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Post as open shift' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers', {
        shiftId: 'new',
        kind: 'OPEN_SHIFT',
      }),
    );
  });

  it('hides "Post as open shift" once an assignee is chosen', async () => {
    open();
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'm1');
    expect(screen.queryByRole('checkbox', { name: 'Post as open shift' })).toBeNull();
  });

  it('edits with PATCH and the version, clearing empty location/notes with null', async () => {
    apiSend.mockResolvedValue({ shift: stored, warnings: [] });
    open(stored);
    expect(screen.getByLabelText('Start')).toHaveValue('09:00');
    expect(screen.getByLabelText('End')).toHaveValue('13:00');
    expect(screen.queryByRole('checkbox', { name: 'Post as open shift' })).toBeNull();
    await userEvent.clear(screen.getByLabelText('Location'));
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1/shifts/s1', {
        startAt: '2026-11-03T08:00:00.000Z',
        endAt: '2026-11-03T12:00:00.000Z',
        requiredSkillIds: ['sk1'],
        assignedMembershipId: 'm1',
        location: null,
        notes: null,
        version: 3,
      }),
    );
  });

  it('deletes with the version', async () => {
    apiSend.mockResolvedValue(undefined);
    const onClose = open(stored);
    await userEvent.click(screen.getByRole('button', { name: 'Delete shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/orgs/org-1/shifts/s1?version=3'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notice: 'Shift deleted.' }));
  });

  it('closes with the conflict message on VERSION_CONFLICT', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'x' } }),
    );
    const onClose = open(stored);
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(onClose).toHaveBeenCalledWith({
        error: 'This was changed by someone else. The page has been refreshed.',
      }),
    );
  });
});
