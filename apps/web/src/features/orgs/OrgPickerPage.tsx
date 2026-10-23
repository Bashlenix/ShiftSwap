import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { type AccessLevel, useMe } from './useMe';

const ACCESS_LABEL: Record<AccessLevel, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
};

export function OrgPickerPage() {
  const { data, isPending, isError } = useMe();

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Choose an organisation</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending && <p>Loading…</p>}
          {isError && <p role="alert">Could not load your organisations. Please try again.</p>}
          {data && data.memberships.length === 0 && (
            <p>You are not a member of any organisation yet.</p>
          )}
          {data && data.memberships.length > 0 && (
            <ul className="flex flex-col gap-2">
              {data.memberships.map((m) => (
                <li key={m.organizationId}>
                  <Link
                    to={`/orgs/${m.organizationId}`}
                    className="block rounded-md border border-slate-300 px-4 py-3 font-medium text-indigo-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
                  >
                    {m.organizationName} · {ACCESS_LABEL[m.accessLevel]}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
