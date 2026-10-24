import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type State = { isRefetching: boolean; refetch: () => Promise<void> };
const store = vi.hoisted(() => ({
  state: null as unknown as State,
  listeners: [] as ((v: State) => void)[],
}));
vi.mock('./auth-client', () => ({
  authClient: {
    $store: {
      atoms: {
        session: {
          get: () => store.state,
          listen: (cb: (v: State) => void) => {
            store.listeners.push(cb);
            return () => {
              store.listeners = store.listeners.filter((l) => l !== cb);
            };
          },
        },
      },
    },
  },
}));

import { refreshSession } from './session';

describe('refreshSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.listeners = [];
  });
  afterEach(() => vi.useRealTimers());

  it('resolves right away when no newer fetch is running', async () => {
    store.state = { isRefetching: false, refetch: vi.fn().mockResolvedValue(undefined) };
    await expect(refreshSession()).resolves.toBeUndefined();
    expect(store.listeners).toHaveLength(0);
  });

  it('waits for a newer fetch to finish', async () => {
    store.state = { isRefetching: true, refetch: vi.fn().mockResolvedValue(undefined) };
    let done = false;
    const p = refreshSession().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    for (const l of [...store.listeners]) l({ ...store.state, isRefetching: false });
    await p;
    expect(done).toBe(true);
    expect(store.listeners).toHaveLength(0);
  });

  it('gives up after 3 s when the store never settles (never hangs the button)', async () => {
    store.state = { isRefetching: true, refetch: vi.fn().mockResolvedValue(undefined) };
    let done = false;
    void refreshSession().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(store.listeners).toHaveLength(0);
  });
});
