import { useQueryClient } from '@tanstack/react-query';
import type {
  AccessLevel,
  CreateMemberResponse,
  MemberDto,
  SkillDto,
  UpdateMemberInput,
} from '@shiftswap/shared';
import { useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { errorMessage } from '../../lib/error-messages';
import { apiSend } from '../../lib/api';
import { orgApi, useOrg } from '../org/useOrg';

export interface MemberDialogResult {
  notice?: string;
  /** Set when an invite link was created; the page shows it. */
  invite?: { email: string; link: string };
}

interface Props {
  open: boolean;
  /** The member to edit; `null` adds a new one. */
  member: MemberDto | null;
  skills: SkillDto[];
  onClose: (result?: MemberDialogResult) => void;
  /** Runs after the dialog has unmounted; the page decides where focus goes. */
  onAfterClose?: () => void;
}

const fieldClass =
  'h-10 w-full rounded-md border border-slate-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:bg-slate-100';

const toHours = (min: number | null) => (min === null ? '' : String(Math.round(min / 6) / 10));

export function MemberDialog({ open, member, skills, onClose, onAfterClose }: Props) {
  // Remount per member so the form always starts from that member's values.
  return (
    <Dialog open={open}>
      {open && (
        <MemberForm
          key={member?.id ?? 'new'}
          member={member}
          skills={skills}
          onClose={onClose}
          onAfterClose={onAfterClose}
        />
      )}
    </Dialog>
  );
}

function MemberForm({ member, skills, onClose, onAfterClose }: Omit<Props, 'open'>) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const [name, setName] = useState(member?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [access, setAccess] = useState<AccessLevel>(member?.accessLevel ?? 'EMPLOYEE');
  const [skillIds, setSkillIds] = useState<string[]>(member?.skillIds ?? []);
  const [hours, setHours] = useState(toHours(member?.weeklyLimitMin ?? null));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isAdmin = org.accessLevel === 'ADMIN';
  const accessLocked = !isAdmin && member?.accessLevel === 'ADMIN';

  // A request is in flight: closing now would hide its outcome.
  const close = () => {
    if (!pending) onClose();
  };

  const toggleSkill = (id: string) =>
    setSkillIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  /** `undefined` = invalid, `null` = org default. */
  function limitMinutes(): number | null | undefined {
    if (hours.trim() === '') return null;
    const h = Number(hours);
    const min = Math.round(h * 60);
    return Number.isFinite(h) && min >= 60 && min <= 4800 ? min : undefined;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const limitUnchanged =
      member !== undefined && member !== null && hours === toHours(member.weeklyLimitMin);
    const weeklyLimitMin = limitUnchanged ? member.weeklyLimitMin : limitMinutes();
    if (weeklyLimitMin === undefined) {
      setError('Enter a weekly limit between 1 and 80 hours, or leave it empty.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      if (member) {
        const patch: UpdateMemberInput = {};
        if (name.trim() !== member.displayName) patch.displayName = name.trim();
        if (access !== member.accessLevel) patch.accessLevel = access;
        if (!sameSet(skillIds, member.skillIds)) patch.skillIds = skillIds;
        if (!limitUnchanged && weeklyLimitMin !== member.weeklyLimitMin)
          patch.weeklyLimitMin = weeklyLimitMin;
        if (Object.keys(patch).length > 0)
          await apiSend('PATCH', orgApi(org, `/members/${member.id}`), patch);
        await refresh();
        onClose({ notice: 'Changes saved.' });
      } else {
        const trimmedEmail = email.trim();
        const created = await apiSend<CreateMemberResponse>('POST', orgApi(org, '/members'), {
          displayName: name.trim(),
          ...(trimmedEmail !== '' && { email: trimmedEmail }),
          accessLevel: access,
          skillIds,
          ...(weeklyLimitMin !== null && { weeklyLimitMin }),
          appOrigin: window.location.origin,
        });
        await refresh();
        if (created.inviteLink && created.member.email)
          onClose({ invite: { email: created.member.email, link: created.inviteLink } });
        else onClose({ notice: `${name.trim()} added.` });
      }
    } catch (err) {
      await refresh();
      setError(errorMessage(err, { context: 'member' }));
    } finally {
      setPending(false);
    }
  }

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['members', org.organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['me'] }),
    ]);
  }

  return (
    <DialogContent
      className="max-h-[90vh] max-w-lg overflow-y-auto"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        onAfterClose?.();
      }}
      onEscapeKeyDown={close}
      onPointerDownOutside={close}
    >
      <DialogTitle>{member ? 'Edit person' : 'Add person'}</DialogTitle>
      <DialogDescription>
        {member
          ? `Change details for ${member.displayName}.`
          : 'Add someone to this organisation. With an email they get an invite link.'}
      </DialogDescription>
      <form onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="member-name">Name</Label>
          <Input
            id="member-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {!member && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="member-email">Email (optional)</Label>
            <Input
              id="member-email"
              type="email"
              autoComplete="off"
              aria-describedby="member-email-hint"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p id="member-email-hint" className="text-sm text-slate-700">
              Leave empty for staff without email (no login)
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="member-access">Access level</Label>
          <select
            id="member-access"
            className={fieldClass}
            value={access}
            disabled={accessLocked}
            aria-describedby={accessLocked ? 'member-access-hint' : undefined}
            onChange={(e) => setAccess(e.target.value as AccessLevel)}
          >
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager</option>
            {(isAdmin || member?.accessLevel === 'ADMIN') && <option value="ADMIN">Admin</option>}
          </select>
          {accessLocked && (
            <p id="member-access-hint" className="text-sm text-slate-700">
              Only admins can change this.
            </p>
          )}
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Skills</legend>
          {skills.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={skillIds.includes(s.id)}
                onChange={() => toggleSkill(s.id)}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor="member-limit">Weekly limit in hours (optional)</Label>
          <Input
            id="member-limit"
            type="number"
            inputMode="decimal"
            min={1}
            max={80}
            step="any"
            aria-describedby="member-limit-hint"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <p id="member-limit-hint" className="text-sm text-slate-700">
            Leave empty to use the organisation default.
          </p>
        </div>
        <Feedback error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {member ? 'Save changes' : 'Add person'}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
