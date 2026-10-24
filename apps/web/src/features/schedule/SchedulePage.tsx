import { useQuery } from '@tanstack/react-query';
import type { MemberDto, ShiftDto, SkillDto } from '@shiftswap/shared';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Feedback } from '../../components/Feedback';
import { Button } from '../../components/ui/button';
import { apiFetch } from '../../lib/api';
import { orgApi, useOrg } from '../org/useOrg';
import { useSkillNames } from '../org/useSkillNames';
import { ShiftDialog, type ShiftDialogResult } from './ShiftDialog';
import { dayKey, isWeekParam, localParts, shiftWeek, weekParam, weekRange } from './week';

const UNASSIGNED = 'unassigned';

export function SchedulePage() {
  const org = useOrg();
  if (org.accessLevel === 'EMPLOYEE') return <p>Only managers can see this page.</p>;
  return <ScheduleGrid />;
}

function ScheduleGrid() {
  const org = useOrg();
  const skillNames = useSkillNames();
  const [params] = useSearchParams();
  const requested = params.get('week');
  const week = isWeekParam(requested) ? requested : weekParam(new Date(), org.timezone);
  const range = weekRange(week, org.timezone);
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const [dialog, setDialog] = useState<{ shift: ShiftDto | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const focusFeedback = useRef(false);

  const members = useQuery({
    queryKey: ['members', org.organizationId],
    queryFn: () => apiFetch<MemberDto[]>(orgApi(org, '/members')),
  });
  const skills = useQuery({
    queryKey: ['skills', org.organizationId],
    queryFn: () => apiFetch<SkillDto[]>(orgApi(org, '/skills')),
    staleTime: 5 * 60_000,
  });
  const shifts = useQuery({
    queryKey: ['shifts', org.organizationId, 'week', week],
    queryFn: () =>
      apiFetch<ShiftDto[]>(
        orgApi(org, `/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      ),
  });

  function openDialog(shift: ShiftDto | null) {
    opener.current = document.activeElement;
    setError(null);
    setNotice(null);
    setDialog({ shift });
  }

  function closeDialog(result?: ShiftDialogResult) {
    focusFeedback.current = !!(result?.notice || result?.error);
    setNotice(result?.notice ?? null);
    setError(result?.error ?? null);
    setDialog(null);
  }

  const rows: { id: string; name: string }[] = [
    ...(members.data ?? []).map((m) => ({ id: m.id, name: m.displayName })),
    { id: UNASSIGNED, name: 'Unassigned' },
  ];
  const byCell = new Map<string, ShiftDto[]>();
  for (const s of [...(shifts.data ?? [])].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const key = `${s.assignedMembershipId ?? UNASSIGNED}|${dayKey(s.startAt, org.timezone)}`;
    byCell.set(key, [...(byCell.get(key) ?? []), s]);
  }

  const dayHeader = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const dayLabel = (key: string) => dayHeader.format(new Date(`${key}T12:00:00Z`));
  const caption = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${range.days[0]}T12:00:00Z`));

  return (
    <section aria-labelledby="schedule-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="schedule-heading" className="text-2xl font-semibold">
          Schedule
        </h1>
        <nav aria-label="Week" className="flex items-center gap-3 text-sm">
          <Link
            to={`?week=${shiftWeek(week, -1, org.timezone)}`}
            className="text-indigo-800 underline"
          >
            Previous week
          </Link>
          <Link
            to={`?week=${shiftWeek(week, 1, org.timezone)}`}
            className="text-indigo-800 underline"
          >
            Next week
          </Link>
        </nav>
        <Button className="ml-auto" onClick={() => openDialog(null)}>
          New shift
        </Button>
      </div>
      <Feedback error={error} notice={notice} containerRef={feedbackRef} />
      {(members.isError || shifts.isError) && (
        <p role="alert">Could not load the schedule. Please try again.</p>
      )}
      {(members.isPending || shifts.isPending) && <p>Loading…</p>}
      {members.data && shifts.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed border-collapse text-left text-sm">
            <caption className="pb-2 text-left font-medium">Week of {caption}</caption>
            <thead>
              <tr className="border-b border-slate-300">
                <th scope="col" className="w-32 p-2">
                  Team member
                </th>
                {range.days.map((d) => (
                  <th key={d} scope="col" className="p-2">
                    {dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-200 align-top">
                  <th scope="row" className="p-2 font-medium">
                    {row.name}
                  </th>
                  {range.days.map((d) => (
                    <td key={d} className="p-1">
                      <div className="flex flex-col gap-1">
                        {(byCell.get(`${row.id}|${d}`) ?? []).map((s) => {
                          const t0 = localParts(s.startAt, org.timezone).time;
                          const t1 = localParts(s.endAt, org.timezone).time;
                          const skillText =
                            s.requiredSkillIds.length > 0 ? skillNames(s.requiredSkillIds) : null;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => openDialog(s)}
                              className="rounded-md border border-slate-300 bg-white p-1.5 text-left text-xs hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-700"
                            >
                              {`${t0}–${t1}`}
                              {skillText && ` · ${skillText}`}
                              {s.openOfferId && (
                                <span className="mt-1 block w-fit rounded-full border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-900">
                                  {s.assignedMembershipId ? 'Offered' : 'Open shift'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ShiftDialog
        open={dialog !== null}
        shift={dialog?.shift ?? null}
        defaultDate={range.days[0]}
        members={members.data ?? []}
        skills={skills.data ?? []}
        onClose={closeDialog}
        onAfterClose={() => {
          if (focusFeedback.current) feedbackRef.current?.focus();
          else if (opener.current instanceof HTMLElement && opener.current.isConnected)
            opener.current.focus();
          focusFeedback.current = false;
        }}
      />
    </section>
  );
}
