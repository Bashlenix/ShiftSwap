import { Navigate, Outlet } from 'react-router';
import { authClient } from '../lib/auth-client';

export function RequireAuth() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="p-4">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
