import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnreadCount } from './useUnreadCount';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  apiFetch,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useUnreadCount', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('returns the count from the API', async () => {
    apiFetch.mockResolvedValue({ count: 3 });
    const { result } = renderHook(() => useUnreadCount('o1'), { wrapper });
    await waitFor(() => expect(result.current).toBe(3));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/orgs/o1/notifications/unread-count');
  });

  it('is 0 without an org, on errors and on malformed answers', async () => {
    const none = renderHook(() => useUnreadCount(undefined), { wrapper });
    expect(none.result.current).toBe(0);
    expect(apiFetch).not.toHaveBeenCalled();
    apiFetch.mockResolvedValue({ unexpected: true });
    const bad = renderHook(() => useUnreadCount('o1'), { wrapper });
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(bad.result.current).toBe(0);
  });
});
