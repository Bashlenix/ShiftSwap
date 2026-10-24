import { Navigate, Outlet } from 'react-router';
import { authClient } from '../lib/auth-client';

export function RequireAuth() {
  const { data: session, isPending, isRefetching } = authClient.useSession();
  // A refetch without data may be the one that picks up a fresh sign-in: wait, don't bounce.
  if (isPending || (!session && isRefetching)) return <p className="p-4">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
