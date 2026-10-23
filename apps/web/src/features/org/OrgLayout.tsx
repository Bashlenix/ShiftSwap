import { NavLink, Outlet, Link, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useLogout } from '../orgs/useLogout';
import { useMe } from '../orgs/useMe';
import { OrgContext, type OrgInfo } from './useOrg';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-700',
    isActive ? 'bg-slate-100 text-indigo-900 underline' : 'text-slate-800',
  );

export function OrgLayout() {
  const { orgId } = useParams();
  const { data, isPending, isError } = useMe();
  const logOut = useLogout();

  if (isPending) return <p className="p-4">Loading…</p>;
  if (isError)
    return (
      <p role="alert" className="p-4">
        Could not load your organisations. Please try again.
      </p>
    );

  const membership = data.memberships.find((m) => m.organizationId === orgId);
  if (!membership) {
    return (
      <main className="p-4">
        <h1 className="text-2xl font-semibold">Organisation not found</h1>
        <Link to="/orgs" className="text-indigo-800 underline">
          Switch organisation
        </Link>
      </main>
    );
  }

  const org: OrgInfo = {
    organizationId: membership.organizationId,
    membershipId: membership.membershipId,
    organizationName: membership.organizationName,
    accessLevel: membership.accessLevel,
    timezone: membership.organizationTimezone,
  };
  const base = `/orgs/${org.organizationId}`;

  return (
    <OrgContext.Provider value={org}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <span className="font-semibold">{org.organizationName}</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink to={`${base}/me/shifts`} className={navClass}>
              My shifts
            </NavLink>
            <NavLink to={`${base}/offers`} className={navClass}>
              Open offers
            </NavLink>
            <NavLink to={`${base}/me/availability`} className={navClass}>
              Availability
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link to="/orgs" className="text-sm text-indigo-800 underline">
              Switch organisation
            </Link>
            <Button variant="outline" onClick={() => void logOut()}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </OrgContext.Provider>
  );
}
