import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { MANAGER_ORG, renderWithOrg, TEST_ORG } from '../../test-utils';
import { OfferReviewPage } from './OfferReviewPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const shift = {
  id: 's1',
  startAt: '2026-11-10T08:00:00Z',
  endAt: '2026-11-10T12:00:00Z',
  requiredSkillIds: ['sk1'],
  assignedMembershipId: 'm1',
  location: null,
  notes: null,
  version: 1,
  openOfferId: 'o1',
};

const summary = {
  id: 'o1',
  kind: 'GIVE_AWAY',
  status: 'OPEN',
  expiresAt: '2026-11-10T06:00:00Z',
  version: 4,
  shift,
  originalOwnerMembershipId: 'm1',
  myAcceptanceStatus: null,
  pendingCount: 2,
};

const acceptance = (id: string, name: string, extra: object = {}) => ({
  id,
  membershipId: 'mm-' + id,
  displayName: name,
  status: 'PENDING',
  createdAt: '2026-11-05T10:00:00Z',
  score: { total: 83, breakdown: { preference: 20, headroom: 28, swapLoad: 15 } },
  recheck: { eligible: true, failedRules: [] },
  ...extra,
});

const detail = (acceptances: unknown[], extra: object = {}) => ({
  ...summary,
  ...extra,
  acceptances,
});

function setup(d: unknown) {
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/offers?scope=review')) return Promise.resolve([summary]);
    if (path.includes('/offers/o1')) return Promise.resolve(d);
    if (path.includes('/members'))
      return Promise.resolve([{ id: 'm1', displayName: 'Anna Beck', status: 'ACTIVE' }]);
    if (path.includes('/skills')) return Promise.resolve([{ id: 'sk1', name: 'Barista' }]);
    return Promise.reject(new Error('unexpected ' + path));
  });
  apiSend.mockResolvedValue({});
}

function render(route = '/review/o1', org = MANAGER_ORG) {
  return renderWithOrg(
    <Routes>
      <Route path="/review" element={<OfferReviewPage />} />
      <Route path="/review/:offerId" element={<OfferReviewPage />} />
    </Routes>,
    org,
    route,
  );
}

describe('OfferReviewPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('tells employees it is managers only and calls no API', () => {
    render('/review', TEST_ORG);
    expect(screen.getByText('Only managers can see this page.')).toBeVisible();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('lists review offers with owner, time and pending count', async () => {
    setup(detail([]));
    render('/review');
    const row = (await screen.findByRole('link', { name: /Review/ })).closest('tr')!;
    expect(within(row).getByText('Anna Beck')).toBeVisible();
    expect(within(row).getByText('Tue 10 Nov, 09:00–13:00')).toBeVisible();
    expect(within(row).getByText('2')).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/orgs/org-1/offers?scope=review');
  });

  it('shows the exact score breakdown and an Approve button per eligible candidate', async () => {
    setup(detail([acceptance('a1', 'Lukas Wolf')]));
    render();
    expect(
      await screen.findByText('Score 83 — Preference +20 · Headroom +28 · Swap load +15'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Lukas Wolf' })).toBeEnabled();
  });

  it('disables Approve and gives the reason for an ineligible candidate', async () => {
    setup(
      detail([
        acceptance('a1', 'Lukas Wolf', {
          recheck: { eligible: false, failedRules: ['OVERLAP', 'MIN_REST'] },
        }),
      ]),
    );
    render();
    expect(
      await screen.findByText(
        'Not eligible now: Overlaps another shift, Less than the minimum rest between shifts',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve Lukas Wolf' })).toBeDisabled();
  });

  it('shows a status badge and no Approve button for non-pending acceptances', async () => {
    setup(
      detail([
        acceptance('a1', 'Lukas Wolf'),
        acceptance('a2', 'Mia Roth', { status: 'WITHDRAWN', score: null }),
      ]),
    );
    render();
    expect(await screen.findByText('Withdrawn')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve Mia Roth' })).toBeNull();
    expect(screen.queryByText(/Score .*Mia/)).toBeNull();
  });

  it('approves with acceptanceId and the offer version and announces it', async () => {
    setup(detail([acceptance('a1', 'Lukas Wolf')]));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Lukas Wolf' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o1/approve', {
        acceptanceId: 'a1',
        version: 4,
      }),
    );
    expect(await screen.findByText('Approved Lukas Wolf.')).toBeVisible();
  });

  it('rejects the offer with the version', async () => {
    setup(detail([acceptance('a1', 'Lukas Wolf')]));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Reject offer' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/offers/o1/reject', {
        version: 4,
      }),
    );
    expect(await screen.findByText('Offer rejected.')).toBeVisible();
  });

  it('shows the conflict message and refetches on 409', async () => {
    setup(detail([acceptance('a1', 'Lukas Wolf')]));
    apiSend.mockRejectedValue(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'x' } }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Lukas Wolf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was changed by someone else. The page has been refreshed.',
    );
    const detailCalls = () => apiFetch.mock.calls.filter(([p]) => p.endsWith('/offers/o1')).length;
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(1));
  });

  it('shows failed rules on 422', async () => {
    setup(detail([acceptance('a1', 'Lukas Wolf')]));
    apiSend.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'INELIGIBLE', message: 'x', details: { failedRules: ['OVERLAP'] } },
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Lukas Wolf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Overlaps another shift');
  });
});
