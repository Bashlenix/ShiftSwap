import { Building2, ChevronRight, LogOut, Plus, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { Wordmark } from '../../components/Brand';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { useLogout } from './useLogout';
import { type AccessLevel, useMe } from './useMe';

const ACCESS_LABEL: Record<AccessLevel, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

const card =
  'group flex h-full min-h-24 items-center gap-4 rounded-card border bg-surface p-4 shadow-soft motion-safe:transition hover:border-brand hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function OrgPickerPage() {
  const { data, isPending, isError } = useMe();
  const logOut = useLogout();
  const firstName = data?.user.name.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Wordmark />
          <div className="ml-auto flex items-center gap-1">
            <Link
              to="/account"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-strong underline-offset-4 hover:underline"
            >
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
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:py-12">
        <div className="flex flex-col gap-1">
          {firstName && <p className="text-sm font-medium text-muted">Welcome back, {firstName}</p>}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Choose an organisation
          </h1>
        </div>
        {isPending && <p>Loading…</p>}
        {isError && <p role="alert">Could not load your organisations. Please try again.</p>}
        {data && data.memberships.length === 0 && (
          <EmptyState icon={Building2} title="You are not a member of any organisation yet." />
        )}
        {data && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.memberships.map((m) => (
              <li key={m.organizationId}>
                <Link
                  to={`/orgs/${m.organizationId}`}
                  aria-label={`${m.organizationName} · ${ACCESS_LABEL[m.accessLevel]}`}
                  className={`${card} border-slate-200`}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-11 shrink-0 place-items-center rounded-full bg-indigo-50 text-lg font-semibold text-brand-strong"
                  >
                    {m.organizationName.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="max-w-full truncate font-semibold text-slate-900">
                      {m.organizationName}
                    </span>
                    <Badge tone={m.accessLevel === 'EMPLOYEE' ? 'neutral' : 'brand'}>
                      {ACCESS_LABEL[m.accessLevel]}
                    </Badge>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted group-hover:text-brand"
                  />
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/orgs/new"
                className={`${card} border-dashed border-control font-medium text-brand-strong shadow-none`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-dashed border-control"
                >
                  <Plus className="size-5" />
                </span>
                Create organisation
              </Link>
            </li>
          </ul>
        )}
      </main>
    </div>
  );
}
