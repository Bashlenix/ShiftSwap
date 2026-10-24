import { useQueryClient } from '@tanstack/react-query';
import type { MemberDto } from '@shiftswap/shared';
import { useEffect, useRef, useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { orgApi, useOrg } from '../org/useOrg';
import type { MemberDialogResult } from './MemberDialog';

interface Props {
  /** The login-less placeholder without email to invite; `null` = closed. */
  member: MemberDto | null;
  onClose: (result?: MemberDialogResult) => void;
  /** Runs after the dialog has unmounted; the page decides where focus goes. */
  onAfterClose?: () => void;
}

/** Asks for an email address and invites a placeholder that was created without one (FR-03). */
export function InviteDialog({ member, onClose, onAfterClose }: Props) {
  return (
    <Dialog open={member !== null}>
      {member && (
        <InviteForm key={member.id} member={member} onClose={onClose} onAfterClose={onAfterClose} />
      )}
    </Dialog>
  );
}

function InviteForm({
  member,
  onClose,
  onAfterClose,
}: Omit<Props, 'member'> & { member: MemberDto }) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  // The list was refreshed and this member already has an email or a login (e.g. someone
  // else invited them): the dialog is stale, so close it. Not while our own request runs;
  // its handler reports the outcome.
  useEffect(() => {
    if (!pending && (member.email || member.hasLogin)) onClose();
  }, [pending, member.email, member.hasLogin, onClose]);

  // A request is in flight: closing now would hide its outcome.
  const close = () => {
    if (!pending) onClose();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPending(true);
    const address = email.trim();
    try {
      const res = await apiSend<{ inviteLink: string }>(
        'POST',
        orgApi(org, `/members/${member.id}/invite`),
        { email: address, appOrigin: window.location.origin },
      );
      await refresh();
      onClose({ invite: { email: address.toLowerCase(), link: res.inviteLink } });
    } catch (err) {
      await refresh();
      setError(errorMessage(err, { context: 'member' }));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['members', org.organizationId] });
  }

  return (
    <DialogContent
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        onAfterClose?.();
      }}
      onEscapeKeyDown={close}
      onPointerDownOutside={close}
    >
      <DialogTitle>Invite {member.displayName}</DialogTitle>
      <DialogDescription>
        They get an email with a link to create a login for this organisation.
      </DialogDescription>
      <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Feedback error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Send invite
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
