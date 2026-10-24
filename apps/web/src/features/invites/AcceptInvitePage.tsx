import type { InvitePreviewDto } from '@shiftswap/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ApiError, apiFetch, apiSend } from '../../lib/api';
import { authClient } from '../../lib/auth-client';
import { errorMessage } from '../../lib/error-messages';
import { PASSWORD_ERROR, PASSWORD_HINT } from '../../lib/password-copy';
import { withNext } from '../../lib/safe-next';
import { refreshSession } from '../../lib/session';
import { isAlreadyRegistered } from '../../lib/sign-up-error';

const GENERIC_FAILURE = 'Something went wrong. Please try again.';
const STATE_COPY: Record<string, string> = {
  USED: 'This invite has already been used.',
  EXPIRED: 'This invite has expired. Ask your manager to send a new one.',
  REVOKED: 'This invite was replaced by a newer one.',
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    </main>
  );
}

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => apiFetch<InvitePreviewDto>(`/api/v1/invites/${encodeURIComponent(token)}`),
    retry: false,
  });

  if (preview.isPending) return <Shell title="Invitation">Loading…</Shell>;
  if (preview.isError) {
    const notFound = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <Shell title="Invitation">
        <p role={notFound ? undefined : 'alert'}>
          {notFound ? 'This invite link is not valid.' : errorMessage(preview.error)}
        </p>
      </Shell>
    );
  }
  const invite = preview.data;
  if (invite.state !== 'VALID') {
    return (
      <Shell title="Invitation">
        <p>{STATE_COPY[invite.state] ?? 'This invite is no longer valid.'}</p>
      </Shell>
    );
  }
  return <ValidInvite invite={invite} token={token} />;
}

function ValidInvite({ invite, token }: { invite: InvitePreviewDto; token: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [serverMismatch, setServerMismatch] = useState(false);
  const [usedState, setUsedState] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const loginHref = withNext('/login', `/invites/${token}`);

  const sessionEmail = session?.user.email ?? null;
  const mismatch =
    sessionEmail !== null &&
    (serverMismatch || sessionEmail.toLowerCase() !== invite.email.toLowerCase());

  const accept = useMutation({
    mutationFn: () =>
      apiSend<{ organizationId: string }>(
        'POST',
        `/api/v1/invites/${encodeURIComponent(token)}/accept`,
      ),
  });

  async function acceptAndGo() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { organizationId } = await accept.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await navigate(`/orgs/${organizationId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_MISMATCH') {
        setServerMismatch(true);
      } else if (err instanceof ApiError && err.code === 'INVITE_INVALID') {
        const state = err.details?.state;
        setUsedState(typeof state === 'string' && state in STATE_COPY ? state : 'USED');
        setError(errorMessage(err));
      } else {
        setError(errorMessage(err));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function onSignUp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const found: { name?: string; password?: string } = {};
    if (!name) found.name = 'Enter your name';
    if (password.length < 8) found.password = PASSWORD_ERROR;
    setFieldErrors(found);
    setError(null);
    setExistingAccount(false);
    if (found.name || found.password) {
      (found.name ? nameRef : passwordRef).current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({
        email: invite.email.trim().toLowerCase(),
        password,
        name,
      });
      if (signUpError) {
        if (isAlreadyRegistered(signUpError)) {
          setExistingAccount(true);
          setError('You already have an account. Log in to join.');
        } else {
          setError(GENERIC_FAILURE);
        }
        inFlight.current = false;
        setBusy(false);
        return;
      }
      await refreshSession();
    } catch {
      setError(GENERIC_FAILURE);
      inFlight.current = false;
      setBusy(false);
      return;
    }
    inFlight.current = false;
    await acceptAndGo();
  }

  async function logOut() {
    try {
      // Better Auth answers HTTP errors with `{ error }` instead of throwing.
      const { error: signOutError } = await authClient.signOut();
      if (signOutError) throw signOutError;
      setServerMismatch(false);
      queryClient.removeQueries({ queryKey: ['me'] });
    } catch {
      setError(GENERIC_FAILURE);
    }
  }

  if (usedState) {
    return (
      <Shell title="Invitation">
        <p>{STATE_COPY[usedState]}</p>
      </Shell>
    );
  }

  const title = `Join ${invite.organizationName}`;
  if (sessionPending) return <Shell title={title}>Loading…</Shell>;

  if (session && mismatch) {
    return (
      <Shell title={title}>
        <p role="alert">
          {`You're signed in as ${session.user.email}, but this invite is for ${invite.email}.`}
        </p>
        <Feedback error={error} />
        <Button variant="outline" onClick={() => void logOut()}>
          Log out
        </Button>
      </Shell>
    );
  }

  if (session) {
    return (
      <Shell title={title}>
        <p>Invited: {invite.email}</p>
        <Feedback error={error} />
        <Button disabled={busy} onClick={() => void acceptAndGo()}>
          {title}
        </Button>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <p>Invited: {invite.email}</p>
      {!showForm && (
        <div className="flex flex-col gap-2">
          <Button onClick={() => setShowForm(true)}>Create account</Button>
          <Link
            to={loginHref}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-400 px-4 text-sm font-medium text-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
          >
            I already have an account
          </Link>
        </div>
      )}
      {showForm && (
        <form onSubmit={(e) => void onSignUp(e)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              ref={nameRef}
              autoComplete="name"
              autoFocus
              aria-invalid={fieldErrors.name ? 'true' : undefined}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            />
            <div aria-live="polite">
              {fieldErrors.name && (
                <p id="name-error" className="text-sm text-red-700">
                  {fieldErrors.name}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" readOnly value={invite.email} autoComplete="username" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              ref={passwordRef}
              autoComplete="new-password"
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={
                fieldErrors.password ? 'password-hint password-error' : 'password-hint'
              }
            />
            <p id="password-hint" className="text-sm text-slate-700">
              {PASSWORD_HINT}
            </p>
            <div aria-live="polite">
              {fieldErrors.password && (
                <p id="password-error" className="text-sm text-red-700">
                  {fieldErrors.password}
                </p>
              )}
            </div>
          </div>
          <Feedback error={error} />
          {existingAccount && (
            <p>
              <Link className="font-medium text-indigo-800 underline" to={loginHref}>
                Log in
              </Link>
            </p>
          )}
          <Button type="submit" disabled={busy}>
            Create account and join
          </Button>
        </form>
      )}
    </Shell>
  );
}
