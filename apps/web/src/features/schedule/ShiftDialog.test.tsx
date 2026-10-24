import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShiftDto } from '@shiftswap/shared';
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
    email: 'anna@example.com',
    status: 'ACTIVE' as const,
    hasLogin: true,
    invitePending: false,
    skillIds: [],
    weeklyLimitMin: null,
  },
];
const skills = [{ id: 'sk1', name: 'Barista' }];
const stored: ShiftDto = {
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

function open(shift: ShiftDto | null = null) {
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

  it('edits notes only: PATCH carries just notes and version', async () => {
    apiSend.mockResolvedValue({ shift: stored, warnings: [] });
    open(stored);
    expect(screen.getByLabelText('Start')).toHaveValue('09:00');
    expect(screen.getByLabelText('End')).toHaveValue('13:00');
    expect(screen.queryByRole('checkbox', { name: 'Post as open shift' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Notes'), 'Bring keys');
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1/shifts/s1', {
        notes: 'Bring keys',
        version: 3,
      }),
    );
  });

  it('sends startAt only when only the start changed, and null to clear location', async () => {
    apiSend.mockResolvedValue({ shift: stored, warnings: [] });
    open(stored);
    await userEvent.clear(screen.getByLabelText('Start'));
    await userEvent.type(screen.getByLabelText('Start'), '08:00');
    await userEvent.clear(screen.getByLabelText('Location'));
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('PATCH', '/api/v1/orgs/org-1/shifts/s1', {
        startAt: '2026-11-03T07:00:00.000Z',
        location: null,
        version: 3,
      }),
    );
  });

  it('asks for confirmation before deleting, and Keep shift backs out', async () => {
    apiSend.mockResolvedValue(undefined);
    const onClose = open(stored);
    await userEvent.click(screen.getByRole('button', { name: 'Delete shift' }));
    expect(screen.getByText('Delete this shift?')).toBeVisible();
    expect(apiSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep shift' }));
    expect(screen.getByRole('button', { name: 'Save shift' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Delete shift' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/orgs/org-1/shifts/s1?version=3'),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notice: 'Shift deleted.' }));
  });

  it('offers posting an unassigned, not-yet-offered shift when editing; failure keeps the shift', async () => {
    const unassigned = { ...stored, assignedMembershipId: null };
    apiSend.mockImplementation((method: string, path: string) =>
      path.endsWith('/offers')
        ? Promise.reject(new ApiError(409, { error: { code: 'OFFER_EXPIRED', message: 'x' } }))
        : Promise.resolve({ shift: unassigned, warnings: [] }),
    );
    const onClose = open(unassigned);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Post as open shift' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    const msg =
      "Shift saved, but it couldn't be posted as an open shift: This offer has expired. Open the shift to try again.";
    expect(await screen.findByText(msg)).toBeVisible();
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers', {
      shiftId: 's1',
      kind: 'OPEN_SHIFT',
    });
    expect(apiSend).not.toHaveBeenCalledWith('PATCH', expect.anything(), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledWith({ notice: msg });
  });

  it('does not offer posting when the shift already has an open offer', () => {
    open({ ...stored, assignedMembershipId: null, openOfferId: 'o1' });
    expect(screen.queryByRole('checkbox', { name: 'Post as open shift' })).toBeNull();
  });

  it('closes with the conflict message on VERSION_CONFLICT', async () => {
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'x' } }),
    );
    const onClose = open(stored);
    await userEvent.type(screen.getByLabelText('Notes'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    await waitFor(() =>
      expect(onClose).toHaveBeenCalledWith({
        error: 'This was changed by someone else. The page has been refreshed.',
      }),
    );
  });

  it('shows the API validation message, e.g. the 16-hour limit', async () => {
    apiSend.mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: { issues: [{ path: 'endAt', message: 'A shift can be at most 16 hours' }] },
        },
      }),
    );
    open();
    await fillTimes('06:00', '23:00');
    await userEvent.click(screen.getByRole('button', { name: 'Save shift' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A shift can be at most 16 hours');
  });

  it('withdraws an open shift after confirming, using the offer version', async () => {
    const openShift = { ...stored, assignedMembershipId: null, openOfferId: 'o1' };
    apiFetch.mockResolvedValue({ id: 'o1', version: 7, status: 'OPEN' });
    apiSend.mockResolvedValue({});
    const onClose = open(openShift);
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw open shift' }));
    expect(screen.getByText('Withdraw this open shift?')).toBeVisible();
    expect(apiSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o1/cancel', {
        version: 7,
      }),
    );
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/orgs/org-1/offers/o1');
    await waitFor(() => expect(onClose).toHaveBeenCalledWith({ notice: 'Open shift withdrawn.' }));
  });

  it('offers no withdraw button without an open offer', () => {
    open({ ...stored, assignedMembershipId: null });
    expect(screen.queryByRole('button', { name: 'Withdraw open shift' })).toBeNull();
  });
});
