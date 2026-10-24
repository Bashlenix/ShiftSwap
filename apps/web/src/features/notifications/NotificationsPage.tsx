import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { notificationText, type NotificationDto } from '@shiftswap/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { apiFetch, apiSend } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg, type OrgInfo } from '../org/useOrg';
import { unreadKey } from './useUnreadCount';

interface Page {
  items: NotificationDto[];
  nextCursor: string | null;
}

function linkFor(n: NotificationDto, org: OrgInfo): { to: string; label: string } | null {
  const base = `/orgs/${org.organizationId}`;
  const manager = org.accessLevel !== 'EMPLOYEE';
  const { role, offerId } = n.payload;
  switch (n.type) {
    case 'OFFER_CREATED':
      if (role === 'eligible') return { to: `${base}/offers`, label: 'Open offers' };
      return manager
        ? { to: `${base}/review${offerId ? `/${offerId}` : ''}`, label: 'Offer review' }
        : null;
    case 'ACCEPTANCE_RECEIVED':
      return manager
        ? { to: `${base}/review${offerId ? `/${offerId}` : ''}`, label: 'Offer review' }
        : { to: `${base}/me/shifts`, label: 'My shifts' };
    case 'OFFER_APPROVED':
      return role === 'selected' || role === 'owner'
        ? { to: `${base}/me/shifts`, label: 'My shifts' }
        : null;
    case 'OPEN_SHIFT_FILLED':
      return role === 'selected'
        ? { to: `${base}/me/shifts`, label: 'My shifts' }
        : manager
          ? { to: `${base}/review`, label: 'Offer review' }
          : null;
    case 'ACCEPTANCE_INVALIDATED':
      return { to: `${base}/offers`, label: 'Open offers' };
    default:
      return null;
  }
}

export function NotificationsPage() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const key = ['notifications', org.organizationId];
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      apiFetch<Page>(
        orgApi(org, `/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
      ),
    getNextPageParam: (last) => last.nextCursor,
  });

  async function markAllRead() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await apiSend('POST', orgApi(org, '/notifications/read'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: unreadKey(org.organizationId) }),
      ]);
      setNotice('All notifications marked as read.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="notifications-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="notifications-heading" className="text-2xl font-semibold">
          Notifications
        </h1>
        <Button variant="outline" className="ml-auto" disabled={pending} onClick={markAllRead}>
          Mark all as read
        </Button>
      </div>
      <Feedback error={error} notice={notice} />
      {query.isError && <p role="alert">Could not load notifications. Please try again.</p>}
      {query.isPending && <p>Loading…</p>}
      {query.data && items.length === 0 && <p>No notifications yet.</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const unread = n.readAt === null;
            const link = linkFor(n, org);
            return (
              <li
                key={n.id}
                className={`rounded-md border p-3 ${unread ? 'border-indigo-400 border-l-4 bg-indigo-50' : 'border-slate-200 bg-white'}`}
              >
                <p className={unread ? 'font-semibold' : ''}>
                  {unread && (
                    <span className="mr-2 rounded-full border border-indigo-700 px-2 py-0.5 text-xs font-medium text-indigo-900">
                      New
                    </span>
                  )}
                  {notificationText(n, org.timezone)}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-700">
                  <span>{formatDateTime(n.createdAt, org.timezone)}</span>
                  {link && (
                    <Link to={link.to} className="text-indigo-800 underline">
                      {link.label}
                    </Link>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
