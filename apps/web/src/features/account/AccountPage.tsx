import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
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
import { ApiError, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
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
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <p className="mb-4 text-sm">
        <Link to="/orgs" className="text-indigo-800 underline">
          Back to organisations
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">Your account</h1>
      {isPending && <p className="mt-4">Loading…</p>}
      {isError && (
        <p role="alert" className="mt-4">
          Could not load your account. Please try again.
        </p>
      )}
      {data && (
        <>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="font-medium">Name</dt>
            <dd>{data.user.name}</dd>
            <dt className="font-medium">Email</dt>
            <dd>{data.user.email}</dd>
          </dl>
          <section aria-labelledby="delete-account-heading" className="mt-8">
            <h2 id="delete-account-heading" className="text-lg font-semibold">
              Delete account
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Deleting your account removes your login, name and email from ShiftSwap. Your future
              shifts in every organisation are unassigned and offered to your coworkers. This cannot
              be undone.
            </p>
            <Dialog open={open} onOpenChange={onOpenChange}>
              <DialogTrigger asChild>
                <Button variant="outline" className="mt-4">
                  Delete account…
                </Button>
              </DialogTrigger>
              <DialogContent role="alertdialog">
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
                    <p role="alert" className="mt-3 text-sm text-red-700">
                      {error}
                    </p>
                  )}
                </div>
                <div className="mt-6 flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
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
        </>
      )}
    </main>
  );
}
