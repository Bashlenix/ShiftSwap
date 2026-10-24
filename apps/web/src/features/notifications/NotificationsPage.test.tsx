import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notificationPath, type NotificationDto } from '@shiftswap/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MANAGER_ORG, renderWithOrg } from '../../test-utils';
import { NotificationsPage } from './NotificationsPage';

const apiFetch = vi.hoisted(() => vi.fn());
const apiSend = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
  apiSend,
}));

const item = (id: string, over: Partial<NotificationDto> = {}): NotificationDto => ({
  id,
  type: 'OFFER_CREATED',
  readAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  payload: {
    offerId: 'of1',
    shiftStartAt: '2026-10-24T08:00:00Z',
    shiftEndAt: '2026-10-24T16:00:00Z',
    role: 'eligible',
  },
  ...over,
});

describe('NotificationsPage', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiSend.mockReset();
  });

  it('lists notifications with New markers on unread ones and links', async () => {
    apiFetch.mockResolvedValue({
      items: [
        item('a'),
        item('b', {
          type: 'OFFER_APPROVED',
          readAt: '2026-10-21T10:00:00Z',
          payload: { ...item('x').payload, role: 'selected' },
        }),
      ],
      nextCursor: null,
    });
    renderWithOrg(<NotificationsPage />, MANAGER_ORG);
    const first = (
      await screen.findByText('New shift available: Sat 24 Oct, 10:00–18:00.')
    ).closest('li')!;
    expect(within(first).getByText('New')).toBeVisible();
    expect(within(first).getByRole('link', { name: 'Open offers' })).toHaveAttribute(
      'href',
      '/orgs/org-1/offers',
    );
    const second = screen.getByText('You got the shift Sat 24 Oct, 10:00–18:00.').closest('li')!;
    expect(within(second).queryByText('New')).toBeNull();
    expect(within(second).getByRole('link', { name: 'My shifts' })).toBeVisible();
  });

  it('links every notification to the same path as its email (shared notificationPath)', async () => {
    const base = item('x').payload;
    const items = [
      item('c', { payload: { ...base, role: 'manager' } }),
      item('d', { type: 'OFFER_EXPIRED', payload: { ...base, role: 'owner' } }),
      item('e', { type: 'OFFER_APPROVED', payload: { ...base, role: 'notSelected' } }),
      item('f', { type: 'ACCEPTANCE_INVALIDATED', payload: { ...base, role: 'candidate' } }),
      item('g', { type: 'OPEN_SHIFT_FILLED', payload: { ...base, role: 'manager' } }),
    ];
    apiFetch.mockResolvedValue({ items, nextCursor: null });
    renderWithOrg(<NotificationsPage />, MANAGER_ORG);
    await screen.findAllByRole('listitem');
    const lis = screen.getAllByRole('listitem');
    expect(lis).toHaveLength(items.length);
    items.forEach((n, i) => {
      expect(within(lis[i]).getByRole('link')).toHaveAttribute(
        'href',
        notificationPath('org-1', n),
      );
    });
    expect(within(lis[0]).getByRole('link')).toHaveAccessibleName('Offer review');
    expect(within(lis[1]).getByRole('link')).toHaveAccessibleName('My shifts');
    expect(within(lis[3]).getByRole('link')).toHaveAccessibleName('Open offers');
  });

  it('shows no link when the target is the notifications page itself', async () => {
    apiFetch.mockResolvedValue({
      items: [item('h', { type: 'MEMBER_DEACTIVATED', payload: {} })],
      nextCursor: null,
    });
    renderWithOrg(<NotificationsPage />, MANAGER_ORG);
    const li = (await screen.findByText(/A member was deactivated/)).closest('li')!;
    expect(within(li).queryByRole('link')).toBeNull();
  });

  it('shows an empty state', async () => {
    apiFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithOrg(<NotificationsPage />);
    expect(await screen.findByText('No notifications yet.')).toBeVisible();
  });

  it('marks all as read and refetches', async () => {
    apiFetch.mockResolvedValue({ items: [item('a')], nextCursor: null });
    apiSend.mockResolvedValue(undefined);
    renderWithOrg(<NotificationsPage />);
    await screen.findByText(/New shift available/);
    const calls = apiFetch.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(apiSend).toHaveBeenCalledWith('POST', '/api/v1/orgs/org-1/notifications/read');
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText('All notifications marked as read.')).toBeVisible();
  });

  it('loads more with the cursor', async () => {
    apiFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('cursor=c1')
          ? { items: [item('b', { type: 'OFFER_EXPIRED' })], nextCursor: null }
          : { items: [item('a')], nextCursor: 'c1' },
      ),
    );
    renderWithOrg(<NotificationsPage />);
    await screen.findByText(/New shift available/);
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText(/The offer for .* expired\./)).toBeVisible();
    expect(screen.getByText(/New shift available/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows an error when loading fails', async () => {
    apiFetch.mockRejectedValue(new Error('x'));
    renderWithOrg(<NotificationsPage />);
    expect(
      await screen.findByText('Could not load notifications. Please try again.'),
    ).toBeVisible();
  });
});
