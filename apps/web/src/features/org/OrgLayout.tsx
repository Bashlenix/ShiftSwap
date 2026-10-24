import {
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Clock,
  HandHelping,
  LogOut,
  ScrollText,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet, Link, useParams } from 'react-router';
import { Wordmark } from '../../components/Brand';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useLogout } from '../orgs/useLogout';
import { useMe } from '../orgs/useMe';
import { useUnreadCount } from '../notifications/useUnreadCount';
import { OrgContext, type OrgInfo } from './useOrg';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap motion-safe:transition-colors lg:rounded-lg',
    isActive
      ? 'bg-indigo-50 text-brand-strong ring-1 ring-indigo-200 ring-inset'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
  );

const headerLink =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-strong underline-offset-4 hover:underline';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

function NavGroup({ id, label, items }: { id: string; label: string; items: NavItem[] }) {
  return (
    <div className="flex shrink-0 gap-1 lg:flex-col">
      <p
        id={id}
        className="hidden px-3 pt-4 pb-1 text-xs font-semibold tracking-wide text-muted lg:block"
      >
        {label}
      </p>
      <ul aria-labelledby={id} className="flex gap-1 lg:flex-col">
        {items.map(({ to, label: text, icon: Icon, badge }) => (
          <li key={to}>
            <NavLink to={to} className={navClass}>
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {text}
              {badge !== undefined && (badge > 0 ? ' ' : '')}
              {badge !== undefined && (
                <span
                  aria-live="polite"
                  className={cn(
                    badge > 0 && 'rounded-full bg-brand px-1.5 text-xs leading-5 text-white',
                  )}
                >
                  {badge > 0 ? `(${badge})` : ''}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrgLayout() {
  const { orgId } = useParams();
  const { data, isPending, isError } = useMe();
  const logOut = useLogout();
  const unread = useUnreadCount(
    data?.memberships.some((m) => m.organizationId === orgId) ? orgId : undefined,
  );

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
      <main className="mx-auto flex max-w-md flex-col items-start gap-3 p-4 pt-16">
        <h1 className="text-2xl font-semibold tracking-tight">Organisation not found</h1>
        <Link to="/orgs" className="font-medium text-brand-strong underline">
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
    offerLeadTimeMin: membership.offerLeadTimeMin,
  };
  const base = `/orgs/${org.organizationId}`;
  const manager = org.accessLevel !== 'EMPLOYEE';

  const myWork: NavItem[] = [
    { to: `${base}/me/shifts`, label: 'My shifts', icon: CalendarCheck },
    { to: `${base}/offers`, label: 'Open offers', icon: HandHelping },
    { to: `${base}/me/availability`, label: 'Availability', icon: Clock },
    { to: `${base}/notifications`, label: 'Notifications', icon: Bell, badge: unread },
  ];
  const team: NavItem[] = [
    { to: `${base}/schedule`, label: 'Schedule', icon: CalendarDays },
    { to: `${base}/review`, label: 'Offer review', icon: ClipboardCheck },
    { to: `${base}/members`, label: 'Members', icon: Users },
    { to: `${base}/audit`, label: 'Audit', icon: ScrollText },
  ];
  const admin: NavItem[] = [{ to: `${base}/settings`, label: 'Settings', icon: Settings }];

  return (
    <OrgContext.Provider value={org}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            <Wordmark />
            <div className="order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:w-auto sm:border-l sm:border-slate-200 sm:pl-4">
              <Building2 aria-hidden="true" className="size-4 shrink-0 text-muted" />
              <span className="truncate font-medium">{org.organizationName}</span>
              <Link to="/orgs" className={cn(headerLink, 'shrink-0')}>
                Switch organisation
              </Link>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Link to="/account" className={headerLink}>
                <UserRound aria-hidden="true" className="size-4" />
                Account
              </Link>
              <Button variant="ghost" className="px-2" onClick={() => void logOut()}>
                <LogOut aria-hidden="true" />
                Log out
              </Button>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl lg:flex lg:gap-8 lg:px-4">
          <nav
            aria-label="Main"
            className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-surface px-4 py-2 lg:sticky lg:top-16 lg:w-56 lg:shrink-0 lg:flex-col lg:self-start lg:overflow-visible lg:border-0 lg:bg-transparent lg:px-0 lg:py-4"
          >
            <NavGroup id="nav-my-work" label="My work" items={myWork} />
            {manager && <NavGroup id="nav-team" label="Team" items={team} />}
            {org.accessLevel === 'ADMIN' && <NavGroup id="nav-admin" label="Admin" items={admin} />}
          </nav>
          <main className="min-w-0 flex-1 px-4 py-6 lg:px-0 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </OrgContext.Provider>
  );
}
