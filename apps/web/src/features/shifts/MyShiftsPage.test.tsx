import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithOrg } from '../../test-utils';
import { MyShiftsPage } from './MyShiftsPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const shift = (id: string, startH: number, extra: object = {}) => ({
  id,
  startAt: hours(startH),
  endAt: hours(startH + 5),
  requiredSkillIds: ['sk1'],
  assignedMembershipId: 'mem-1',
  location: 'Front',
  notes: null,
  version: 1,
  openOfferId: null,
  ...extra,
});

const offerFor = (s: ReturnType<typeof shift>, extra: object = {}) => ({
  id: 'of-' + s.id,
  kind: 'GIVE_AWAY',
  status: 'OPEN',
  expiresAt: hours(30),
  version: 3,
  shift: s,
  originalOwnerMembershipId: 'mem-1',
  myAcceptanceStatus: null,
  pendingCount: 0,
  ...extra,
});

function setup(shifts: unknown[], offers: unknown[] = []) {
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/shifts')) return Promise.resolve(shifts);
    if (path.includes('/offers')) return Promise.resolve(offers);
    if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
    return Promise.reject(new Error('unexpected ' + path));
  });
  apiSend.mockResolvedValue({});
}

describe('MyShiftsPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('requests mine=true with ISO instants and renders skill names and location', async () => {
    setup([shift('s1', 48)]);
    renderWithOrg(<MyShiftsPage />);
    expect(await screen.findByText('Barista')).toBeVisible();
    expect(screen.getByText('Front')).toBeVisible();
    const call = apiFetch.mock.calls.map((c) => c[0] as string).find((p) => p.includes('/shifts'))!;
    expect(call).toMatch(/^\/api\/v1\/orgs\/org-1\/shifts\?/);
    expect(call).toContain('mine=true');
    expect(call).toMatch(/from=\d{4}-\d\d-\d\dT[\d:.]+Z/);
  });

  it('offers a shift after confirming in a dialog', async () => {
    setup([shift('s1', 48)]);
    renderWithOrg(<MyShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Offer this shift' }));
    const dialog = await screen.findByRole('dialog');
    expect(apiSend).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers', {
        shiftId: 's1',
        kind: 'GIVE_AWAY',
      }),
    );
  });

  it('hides the offer button when an offer is open or start is within 2 hours', async () => {
    const open = shift('s1', 48, { openOfferId: 'of-s1' });
    const soon = shift('s2', 1);
    setup([open, soon], [offerFor(open)]);
    renderWithOrg(<MyShiftsPage />);
    await screen.findAllByText('Barista');
    expect(screen.queryByRole('button', { name: 'Offer this shift' })).toBeNull();
  });

  it('withdraws an own open give-away with the offer version', async () => {
    const s = shift('s1', 48, { openOfferId: 'of-s1' });
    setup([s], [offerFor(s)]);
    renderWithOrg(<MyShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw offer' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/of-s1/cancel', {
        version: 3,
      }),
    );
  });

  it('lists my offers with text status badges', async () => {
    const s = shift('s1', 48);
    setup([s], [offerFor(s, { status: 'FILLED' })]);
    renderWithOrg(<MyShiftsPage />);
    const section = await screen.findByRole('region', { name: 'My offers' });
    expect(await within(section).findByText('Filled')).toBeVisible();
  });

  it('shows errors in an alert region', async () => {
    const { ApiError } = await import('../../lib/api');
    setup([shift('s1', 48)]);
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'OFFER_ALREADY_OPEN', message: 'x' } }),
    );
    renderWithOrg(<MyShiftsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Offer this shift' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirm' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('This shift is already offered.');
  });
});
