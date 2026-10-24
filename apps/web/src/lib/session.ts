import { authClient } from './auth-client';

type SessionState = ReturnType<typeof authClient.useSession>;

/** Upper bound for waiting on a newer session fetch. */
const REFRESH_WAIT_MS = 3000;

/**
 * Resolves once the session store holds the server's current session.
 *
 * Better Auth only refetches the session 10 ms after sign-in or sign-up (a timer in its proxy),
 * and only while something is subscribed to the store. Navigating to a protected route before
 * that makes `RequireAuth` read the stale signed-out state and bounce back to `/login`.
 */
export async function refreshSession(): Promise<void> {
  const store = authClient.$store.atoms.session as {
    get(): SessionState;
    listen(cb: (value: SessionState) => void): () => void;
  };
  await store.get().refetch();
  // The sign-in signal can start a newer fetch that cancels ours; wait for that one too.
  if (!store.get().isRefetching) return;
  // Bounded: this relies on library internals, and a change there must never hang the button.
  // Upgrade tripwire: LoginRedirect.test.tsx fails if sign-in stops landing on the next page.
  let unbind = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    new Promise<void>((resolve) => {
      unbind = store.listen((value) => {
        if (value.isRefetching) return;
        resolve();
      });
    }),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, REFRESH_WAIT_MS);
    }),
  ]);
  unbind();
  clearTimeout(timer);
}
