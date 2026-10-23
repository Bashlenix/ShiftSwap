import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithOrg } from '../../test-utils';
import { AvailabilityPage } from './AvailabilityPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

describe('AvailabilityPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
    apiFetch.mockResolvedValue([
      { id: 'u1', startAt: '2026-11-06T17:00:00.000Z', endAt: '2026-11-06T22:00:00.000Z' },
    ]);
    apiSend.mockResolvedValue({});
  });

  it('lists windows in org time and explains hard blocks', async () => {
    renderWithOrg(<AvailabilityPage />);
    expect(await screen.findByText('Fri 6 Nov, 18:00–23:00')).toBeVisible();
    expect(
      screen.getByText(
        "Unavailable times are hard blocks: you won't be offered shifts that overlap them.",
      ),
    ).toBeVisible();
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/orgs/org-1/me/unavailability');
  });

  it('shows End must be after start and does not post', async () => {
    renderWithOrg(<AvailabilityPage />);
    await userEvent.type(await screen.findByLabelText('From'), '2026-11-10T18:00');
    await userEvent.type(screen.getByLabelText('Until'), '2026-11-10T09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('End must be after start')).toBeVisible();
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('posts ISO instants converted from org-local time', async () => {
    renderWithOrg(<AvailabilityPage />);
    await userEvent.type(await screen.findByLabelText('From'), '2026-11-10T09:00');
    await userEvent.type(screen.getByLabelText('Until'), '2026-11-10T18:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/me/unavailability', {
        startAt: '2026-11-10T08:00:00.000Z',
        endAt: '2026-11-10T17:00:00.000Z',
      }),
    );
  });

  it('deletes a window', async () => {
    renderWithOrg(<AvailabilityPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Delete/ }));
    await waitFor(() =>
      expect(apiSend).toHaveBeenCalledWith('DELETE', '/api/v1/orgs/org-1/me/unavailability/u1'),
    );
  });
});
