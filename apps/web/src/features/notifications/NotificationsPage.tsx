import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { notificationPath, notificationText, type NotificationDto } from '@shiftswap/shared';
import { BellOff, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { apiFetch, apiSend } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { errorMessage } from '../../lib/error-messages';
import { cn } from '../../lib/utils';
import { orgApi, useOrg } from '../org/useOrg';
import { unreadKey } from './useUnreadCount';

interface Page {
  items: NotificationDto[];
  nextCursor: string | null;
}

const LABELS: [suffix: string, label: string][] = [
  ['/offers', 'Open offers'],
  ['/me/shifts', 'My shifts'],
  ['/review', 'Offer review'],
];

/** Same target as the email deep link; none when that is this page itself. */
function linkFor(n: NotificationDto, orgId: string): { to: string; label: string } | null {
  const to = notificationPath(orgId, n);
  const rest = to.slice(`/orgs/${orgId}`.length);
  const hit = LABELS.find(([p]) => rest === p || rest.startsWith(`${p}/`));
  return hit ? { to, label: hit[1] } : null;
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
      <PageHeader
        id="notifications-heading"
        title="Notifications"
        actions={
          <Button variant="outline" disabled={pending} onClick={markAllRead}>
            <CheckCheck aria-hidden="true" />
            Mark all as read
          </Button>
        }
      />
      <Feedback error={error} notice={notice} />
      {query.isError && <p role="alert">Could not load notifications. Please try again.</p>}
      {query.isPending && <p>Loading…</p>}
      {query.data && items.length === 0 && (
        <EmptyState icon={BellOff} title="No notifications yet." />
      )}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((n) => {
            const unread = n.readAt === null;
            const link = linkFor(n, org.organizationId);
            return (
              <li
                key={n.id}
                className={cn(
                  'rounded-card border p-4 shadow-soft',
                  unread
                    ? 'border-indigo-200 border-l-4 border-l-brand bg-indigo-50'
                    : 'border-slate-200 bg-surface',
                )}
              >
                <p className={unread ? 'font-semibold' : ''}>
                  {unread && (
                    <span className="mr-2 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">
                      New
                    </span>
                  )}
                  {notificationText(n, org.timezone)}
                </p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
                  <span>{formatDateTime(n.createdAt, org.timezone)}</span>
                  {link && (
                    <Link to={link.to} className="font-medium text-brand-strong underline">
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
