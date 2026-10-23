import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { renderWithOrg } from '../../test-utils';
import { OpenOffersPage } from './OpenOffersPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const offer = (id: string, extra: object = {}) => ({
  id,
  kind: 'GIVE_AWAY',
  status: 'OPEN',
  expiresAt: hours(30),
  version: 1,
  shift: {
    id: 's-' + id,
    startAt: hours(48),
    endAt: hours(53),
    requiredSkillIds: ['sk1'],
    assignedMembershipId: 'other',
    location: 'Terrace',
    notes: null,
    version: 1,
    openOfferId: id,
  },
  originalOwnerMembershipId: 'other',
  myAcceptanceStatus: null,
  pendingCount: 0,
  ...extra,
});

function setup(offers: unknown[]) {
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/offers')) return Promise.resolve(offers);
    if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
    return Promise.reject(new Error('unexpected ' + path));
  });
  apiSend.mockResolvedValue({});
}

describe('OpenOffersPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('loads scope=eligible, shows skills and the policy note, and has no detail links', async () => {
    setup([offer('o1')]);
    renderWithOrg(<OpenOffersPage />);
    expect(await screen.findByText('Barista')).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/orgs/org-1/offers?scope=eligible');
    expect(screen.getByText(/company policy, not legal compliance/)).toBeVisible();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('accepts a give-away offer', async () => {
    setup([offer('o1')]);
    renderWithOrg(<OpenOffersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o1/acceptances'),
    );
    expect(await screen.findByText('Done.')).toBeVisible();
  });

  it('withdraws an existing acceptance', async () => {
    setup([offer('o1', { myAcceptanceStatus: 'PENDING' })]);
    renderWithOrg(<OpenOffersPage />);
    expect(await screen.findByText('Pending')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw acceptance' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/orgs/org-1/offers/o1/acceptances/me'),
    );
  });

  it('shows Selected as text with no button', async () => {
    setup([offer('o1', { myAcceptanceStatus: 'SELECTED' })]);
    renderWithOrg(<OpenOffersPage />);
    expect(await screen.findByText('Selected')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets an invalidated acceptance be re-accepted, with an explanation', async () => {
    setup([offer('o1', { myAcceptanceStatus: 'INVALIDATED' })]);
    renderWithOrg(<OpenOffersPage />);
    expect(
      await screen.findByText('The shift changed — accept again if you still want it.'),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o1/acceptances'),
    );
  });

  it('claims an open shift', async () => {
    setup([offer('o2', { kind: 'OPEN_SHIFT', originalOwnerMembershipId: null })]);
    renderWithOrg(<OpenOffersPage />);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o2/claim'),
    );
  });

  it('shows failed rules on 422', async () => {
    setup([offer('o1')]);
    apiSend.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'INELIGIBLE', message: 'x', details: { failedRules: ['OVERLAP'] } },
      }),
    );
    renderWithOrg(<OpenOffersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You can't take this shift: Overlaps another shift",
    );
  });

  it('shows the filled message on 409', async () => {
    setup([offer('o2', { kind: 'OPEN_SHIFT' })]);
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'OFFER_ALREADY_FILLED', message: 'x' } }),
    );
    renderWithOrg(<OpenOffersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone else claimed this shift first.',
    );
  });

  it('shows an empty state', async () => {
    setup([]);
    renderWithOrg(<OpenOffersPage />);
    expect(await screen.findByText('No open offers right now.')).toBeVisible();
  });
});
