import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Wordmark } from '../../components/Brand';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { PageHeader } from '../../components/ui/page-header';
import { ApiError, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { refreshSession } from '../../lib/session';
import { useMe, type Me } from '../orgs/useMe';

const CONFIRM_WORD = 'DELETE';

function failureCopy(err: unknown, memberships: Me['memberships']): string {
  if (err instanceof ApiError && err.code === 'LAST_ADMIN') {
    const ids = Array.isArray(err.details?.organizationIds)
      ? (err.details.organizationIds as string[])
      : [];
    const names = ids
      .map((id) => memberships.find((m) => m.organizationId === id)?.organizationName)
      .filter((n): n is string => Boolean(n));
    if (names.length > 0) {
      return `You are the last admin of ${names.join(', ')}. Make another member an admin first.`;
    }
  }
  return errorMessage(err);
}

export function AccountPage() {
  const { data, isPending, isError } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  function onOpenChange(next: boolean) {
    if (!next && busy) return;
    setOpen(next);
    if (!next) {
      setConfirmText('');
      setError(null);
    }
  }

  async function deleteAccount() {
    if (inFlight.current || confirmText !== CONFIRM_WORD || !data) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiSend('DELETE', '/api/v1/me', { confirm: CONFIRM_WORD });
      await navigate('/login', { state: { notice: 'Your account was deleted.' } });
      // Drop cached data so nothing of the deleted user stays in memory.
      queryClient.clear();
    } catch (err) {
      setError(failureCopy(err, data.memberships));
      inFlight.current = false;
      setBusy(false);
      return;
    }
    // Only after leaving /account (RequireAuth wraps it): the session store still holds the
    // deleted user until refetched, which would let Back reopen protected pages.
    await refreshSession().catch(() => undefined);
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto flex max-w-2xl items-center px-4 py-3">
          <Wordmark />
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <p className="text-sm">
          <Link
            to="/orgs"
            className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-strong underline"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Back to organisations
          </Link>
        </p>
        <PageHeader title="Your account" />
        {isPending && <p>Loading…</p>}
        {isError && <p role="alert">Could not load your account. Please try again.</p>}
        {data && (
          <>
            <Card className="p-4 sm:p-6">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="font-medium text-muted">Name</dt>
                <dd>{data.user.name}</dd>
                <dt className="font-medium text-muted">Email</dt>
                <dd>{data.user.email}</dd>
              </dl>
            </Card>
            <Card className="border-red-200 p-4 sm:p-6">
              <section aria-labelledby="delete-account-heading">
                <h2 id="delete-account-heading" className="text-lg font-semibold">
                  Delete account
                </h2>
                <p className="mt-2 text-sm text-muted">
                  Deleting your account removes your login, name and email from ShiftSwap. Your
                  future shifts in every organisation are unassigned and offered to your coworkers.
                  This cannot be undone.
                </p>
                <Dialog open={open} onOpenChange={onOpenChange}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="mt-4">
                      Delete account…
                    </Button>
                  </DialogTrigger>
                  <DialogContent
                    role="alertdialog"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => {
                      if (busy) e.preventDefault();
                    }}
                  >
                    <DialogTitle>Delete your account?</DialogTitle>
                    <DialogDescription>
                      This removes your login, name and email and cannot be undone.
                    </DialogDescription>
                    <div className="mt-4 flex flex-col gap-1.5">
                      <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
                      <Input
                        id="confirm-delete"
                        autoComplete="off"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                      />
                    </div>
                    <div aria-live="polite">
                      {error && (
                        <p role="alert" className="mt-3 text-sm text-danger">
                          {error}
                        </p>
                      )}
                    </div>
                    <div className="mt-6 flex justify-end gap-2">
                      <DialogClose asChild>
                        <Button variant="outline" disabled={busy}>
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button
                        onClick={() => void deleteAccount()}
                        disabled={confirmText !== CONFIRM_WORD || busy}
                      >
                        Delete my account
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </section>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
