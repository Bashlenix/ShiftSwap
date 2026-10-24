import { useQueryClient } from '@tanstack/react-query';
import {
  RULE_LABELS,
  type MemberDto,
  type OfferDetailDto,
  type RuleCode,
  type ShiftDto,
  type ShiftWriteResponse,
  type SkillDto,
} from '@shiftswap/shared';
import { useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ApiError, apiFetch, apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';
import { localToInstant } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { addDays, localParts } from './week';

export interface ShiftDialogResult {
  notice?: string;
  error?: string;
}

interface Props {
  open: boolean;
  /** The shift to edit; `null` creates a new one. */
  shift: ShiftDto | null;
  /** `YYYY-MM-DD` pre-filled for a new shift. */
  defaultDate: string;
  members: MemberDto[];
  skills: SkillDto[];
  /** Called when the dialog closes; `result` is what the page should announce. */
  onClose: (result?: ShiftDialogResult) => void;
  /** Runs after the dialog has unmounted; the page decides where focus goes. */
  onAfterClose?: () => void;
}

const fieldClass =
  'h-10 w-full rounded-md border border-slate-400 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700';

export function ShiftDialog({
  open,
  shift,
  defaultDate,
  members,
  skills,
  onClose,
  onAfterClose,
}: Props) {
  // Remount per shift so the form always starts from that shift's values.
  return (
    <Dialog open={open}>
      {open && (
        <ShiftForm
          key={shift?.id ?? 'new'}
          shift={shift}
          defaultDate={defaultDate}
          members={members}
          skills={skills}
          onClose={onClose}
          onAfterClose={onAfterClose}
        />
      )}
    </Dialog>
  );
}

function ShiftForm({
  shift,
  defaultDate,
  members,
  skills,
  onClose,
  onAfterClose,
}: Omit<Props, 'open'>) {
  const org = useOrg();
  const queryClient = useQueryClient();
  const initial = shift
    ? { start: localParts(shift.startAt, org.timezone), end: localParts(shift.endAt, org.timezone) }
    : null;
  const [date, setDate] = useState(initial?.start.date ?? defaultDate);
  const [start, setStart] = useState(initial?.start.time ?? '09:00');
  const [end, setEnd] = useState(initial?.end.time ?? '17:00');
  const [skillIds, setSkillIds] = useState<string[]>(shift?.requiredSkillIds ?? []);
  const [assignee, setAssignee] = useState(shift?.assignedMembershipId ?? '');
  const [location, setLocation] = useState(shift?.location ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const [postOpen, setPostOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set after a save that has something to read (policy warnings): the dialog
  // stays open showing it, and hands it to the page when it closes.
  const [done, setDone] = useState<string | null>(null);

  const canPostOpen = !shift || shift.openOfferId === null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const openOfferId = shift && shift.assignedMembershipId === null ? shift.openOfferId : null;
  const endsNextDay = end !== '' && start !== '' && end <= start;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      queryClient.invalidateQueries({ queryKey: ['offers'] }),
    ]);

  async function run(work: () => Promise<ShiftDialogResult & { hold?: boolean }>) {
    setError(null);
    setPending(true);
    try {
      const result = await work();
      await refresh();
      if (result.hold) setDone(result.notice ?? null);
      else onClose({ notice: result.notice });
    } catch (err) {
      await refresh();
      const message = errorMessage(err);
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') onClose({ error: message });
      else setError(message);
    } finally {
      setPending(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !start || !end) {
      setError('Enter a date, a start time and an end time.');
      return;
    }
    const startAt = localToInstant(`${date}T${start}`, org.timezone);
    const endAt = localToInstant(`${endsNextDay ? addDays(date, 1) : date}T${end}`, org.timezone);
    const assignedMembershipId = assignee === '' ? null : assignee;
    void run(async () => {
      let shiftId: string;
      let warnings: RuleCode[] = [];
      if (shift) {
        // Only send what the manager changed: rebuilding the times from wall-clock
        // strings can move them (DST fall-back hour, seconds), which the API treats
        // as a time change.
        const patch: Record<string, unknown> = {};
        const timesChanged =
          date !== initial!.start.date ||
          start !== initial!.start.time ||
          end !== initial!.end.time;
        if (timesChanged) {
          if (Date.parse(startAt) !== Date.parse(shift.startAt)) patch.startAt = startAt;
          if (Date.parse(endAt) !== Date.parse(shift.endAt)) patch.endAt = endAt;
        }
        if (!sameSet(skillIds, shift.requiredSkillIds)) patch.requiredSkillIds = skillIds;
        if (assignedMembershipId !== shift.assignedMembershipId)
          patch.assignedMembershipId = assignedMembershipId;
        if (location.trim() !== (shift.location ?? '')) patch.location = location.trim() || null;
        if (notes.trim() !== (shift.notes ?? '')) patch.notes = notes.trim() || null;
        shiftId = shift.id;
        if (Object.keys(patch).length > 0) {
          const saved = await apiSend<ShiftWriteResponse>(
            'PATCH',
            orgApi(org, `/shifts/${shift.id}`),
            { ...patch, version: shift.version },
          );
          warnings = saved.warnings;
        }
      } else {
        const saved = await apiSend<ShiftWriteResponse>('POST', orgApi(org, '/shifts'), {
          startAt,
          endAt,
          requiredSkillIds: skillIds,
          assignedMembershipId,
          ...(location.trim() !== '' && { location: location.trim() }),
          ...(notes.trim() !== '' && { notes: notes.trim() }),
        });
        shiftId = saved.shift.id;
        warnings = saved.warnings;
      }
      let offerFailure: string | null = null;
      if (canPostOpen && postOpen && assignedMembershipId === null) {
        try {
          await apiSend('POST', orgApi(org, '/offers'), { shiftId, kind: 'OPEN_SHIFT' });
        } catch (err) {
          offerFailure = errorMessage(err);
        }
      }
      if (offerFailure)
        return {
          hold: true,
          notice: `Shift saved, but it couldn't be posted as an open shift: ${offerFailure} Open the shift to try again.`,
        };
      if (warnings.length > 0)
        return {
          hold: true,
          notice: `Saved. Heads-up: ${warnings.map((w) => RULE_LABELS[w] ?? w).join(', ')} (company policy check)`,
        };
      return { notice: 'Shift saved.' };
    });
  }

  function remove() {
    if (!shift) return;
    void run(async () => {
      await apiSend('DELETE', orgApi(org, `/shifts/${shift.id}?version=${shift.version}`));
      return { notice: 'Shift deleted.' };
    });
  }

  function withdrawOpenShift() {
    if (!openOfferId) return;
    void run(async () => {
      // The shift only carries the offer id; the cancel call needs the offer's version.
      const offer = await apiFetch<OfferDetailDto>(orgApi(org, `/offers/${openOfferId}`));
      await apiSend('POST', orgApi(org, `/offers/${openOfferId}/cancel`), {
        version: offer.version,
      });
      return { notice: 'Open shift withdrawn.' };
    });
  }

  const toggleSkill = (id: string) =>
    setSkillIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));

  return (
    <DialogContent
      className="max-h-[90vh] max-w-lg overflow-y-auto"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        onAfterClose?.();
      }}
      onEscapeKeyDown={() => onClose(done ? { notice: done } : undefined)}
      onPointerDownOutside={() => onClose(done ? { notice: done } : undefined)}
    >
      <DialogTitle>{shift ? 'Edit shift' : 'New shift'}</DialogTitle>
      <DialogDescription>
        Times are in {org.timezone}. Hour rules are a company policy check, not legal compliance.
      </DialogDescription>
      {done !== null ? (
        <div className="mt-4 flex flex-col gap-4">
          <p role="status" className="text-sm text-slate-900">
            {done}
          </p>
          <div className="flex justify-end">
            <Button onClick={() => onClose({ notice: done })}>Close</Button>
          </div>
        </div>
      ) : confirmingDelete ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm font-medium">Delete this shift?</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmingDelete(false)}>
              Keep shift
            </Button>
            <Button disabled={pending} onClick={remove}>
              Yes, delete
            </Button>
          </div>
          <Feedback error={error} />
        </div>
      ) : confirmingWithdraw ? (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-sm font-medium">Withdraw this open shift?</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmingWithdraw(false)}
            >
              Keep open
            </Button>
            <Button disabled={pending} onClick={withdrawOpenShift}>
              Yes, withdraw
            </Button>
          </div>
          <Feedback error={error} />
        </div>
      ) : (
        <form onSubmit={save} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="shift-date">Date</Label>
            <Input
              id="shift-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="shift-start">Start</Label>
              <Input
                id="shift-start"
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="shift-end">End</Label>
              <Input
                id="shift-end"
                type="time"
                required
                value={end}
                aria-describedby="shift-end-hint"
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <p id="shift-end-hint" className="min-h-5 text-sm text-slate-700">
            {endsNextDay ? 'Ends next day' : ''}
          </p>
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
            <Label htmlFor="shift-assignee">Assignee</Label>
            <select
              id="shift-assignee"
              className={fieldClass}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          {canPostOpen && assignee === '' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={postOpen}
                onChange={(e) => setPostOpen(e.target.checked)}
              />
              Post as open shift
            </label>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="shift-location">Location</Label>
            <Input
              id="shift-location"
              maxLength={120}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="shift-notes">Notes</Label>
            <textarea
              id="shift-notes"
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Feedback error={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {shift && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                className="mr-auto"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete shift
              </Button>
            )}
            {openOfferId && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirmingWithdraw(true)}
              >
                Withdraw open shift
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save shift
            </Button>
          </div>
        </form>
      )}
    </DialogContent>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
