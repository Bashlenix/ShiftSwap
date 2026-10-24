import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export const unreadKey = (orgId: string) => ['notifications-unread', orgId] as const;

/** Unread notification count; polls every 60 s and refetches on window focus. 0 until known. */
export function useUnreadCount(orgId: string | undefined): number {
  const { data } = useQuery({
    queryKey: unreadKey(orgId ?? ''),
    queryFn: () => apiFetch<{ count: number }>(`/api/v1/orgs/${orgId}/notifications/unread-count`),
    enabled: !!orgId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });
  return typeof data?.count === 'number' ? data.count : 0;
}
