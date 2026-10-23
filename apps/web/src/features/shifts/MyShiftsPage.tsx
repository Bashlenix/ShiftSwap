import { useQuery } from '@tanstack/react-query';
import type { OfferSummaryDto, ShiftDto } from '@shiftswap/shared';
import { useRef, useState } from 'react';
import { Feedback } from '../../components/Feedback';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { useOfferMutation } from '../org/useOfferMutation';
import { useSkillNames } from '../org/useSkillNames';

const DAY_MS = 24 * 60 * 60 * 1000;

export function MyShiftsPage() {
  const org = useOrg();
  const skillNames = useSkillNames();
  const { error, notice, mutation } = useOfferMutation();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const focusFeedback = useRef(false);
  const [confirming, setConfirming] = useState<ShiftDto | null>(null);
  // Fixed per mount so the query key stays stable across renders.
  const [range] = useState(() => {
    const now = Date.now();
    return { from: new Date(now).toISOString(), to: new Date(now + 14 * DAY_MS).toISOString() };
  });

  const shifts = useQuery({
    queryKey: ['shifts', org.organizationId, 'mine', range.from],
    queryFn: () =>
      apiFetch<ShiftDto[]>(orgApi(org, `/shifts?mine=true&from=${range.from}&to=${range.to}`)),
  });
  const myOffers = useQuery({
    queryKey: ['offers', org.organizationId, 'mine'],
    queryFn: () => apiFetch<OfferSummaryDto[]>(orgApi(org, '/offers?scope=mine')),
  });

  const openGiveAway = (shiftId: string) =>
    myOffers.data?.find(
      (o) => o.shift.id === shiftId && o.status === 'OPEN' && o.kind === 'GIVE_AWAY',
    );

  function offer(shift: ShiftDto) {
    focusFeedback.current = true;
    setConfirming(null);
    mutation.mutate({
      method: 'POST',
      path: orgApi(org, '/offers'),
      body: { shiftId: shift.id, kind: 'GIVE_AWAY' },
      notice: 'Shift offered.',
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="my-shifts-heading" className="flex flex-col gap-4">
        <h1 id="my-shifts-heading" className="text-2xl font-semibold">
          My shifts
        </h1>
        <p className="text-sm text-slate-700">Your shifts for the next 14 days.</p>
        <Feedback error={error} notice={notice} containerRef={feedbackRef} />
        {shifts.isPending && <p>Loading…</p>}
        {shifts.isError && <p role="alert">Could not load your shifts. Please try again.</p>}
        {shifts.data?.length === 0 && <p>You have no shifts in the next 14 days.</p>}
        {shifts.data && shifts.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Your shifts in the next 14 days</caption>
            <thead>
              <tr className="border-b border-slate-300">
                <th scope="col" className="p-2">
                  Time
                </th>
                <th scope="col" className="p-2">
                  Skills
                </th>
                <th scope="col" className="p-2">
                  Location
                </th>
                <th scope="col" className="p-2">
                  Offer
                </th>
                <th scope="col" className="p-2">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {shifts.data.map((s) => {
                const own = openGiveAway(s.id);
                const canOffer =
                  s.openOfferId === null &&
                  !own &&
                  Date.now() < Date.parse(s.startAt) - org.offerLeadTimeMin * 60_000;
                return (
                  <tr key={s.id} className="border-b border-slate-200">
                    <th scope="row" className="p-2 font-medium">
                      {formatShiftTime(s.startAt, s.endAt, org.timezone)}
                    </th>
                    <td className="p-2">{skillNames(s.requiredSkillIds)}</td>
                    <td className="p-2">{s.location ?? '—'}</td>
                    <td className="p-2">
                      {s.openOfferId ? <StatusBadge status="OPEN" /> : 'Not offered'}
                    </td>
                    <td className="p-2">
                      {canOffer && (
                        <Button disabled={mutation.isPending} onClick={() => setConfirming(s)}>
                          Offer this shift
                        </Button>
                      )}
                      {own && (
                        <Button
                          variant="outline"
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              method: 'POST',
                              path: orgApi(org, `/offers/${own.id}/cancel`),
                              body: { version: own.version },
                              notice: 'Offer withdrawn.',
                            })
                          }
                        >
                          Withdraw offer
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="my-offers-heading" className="flex flex-col gap-4">
        <h2 id="my-offers-heading" className="text-xl font-semibold">
          My offers
        </h2>
        {myOffers.data?.length === 0 && <p>You have not offered any shifts.</p>}
        {myOffers.data && myOffers.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Shifts you have offered</caption>
            <thead>
              <tr className="border-b border-slate-300">
                <th scope="col" className="p-2">
                  Shift
                </th>
                <th scope="col" className="p-2">
                  Status
                </th>
                <th scope="col" className="p-2">
                  Interested colleagues
                </th>
              </tr>
            </thead>
            <tbody>
              {myOffers.data.map((o) => (
                <tr key={o.id} className="border-b border-slate-200">
                  <th scope="row" className="p-2 font-medium">
                    {formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}
                  </th>
                  <td className="p-2">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="p-2">{o.pendingCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            // After Confirm the trigger is disabled; announce the result instead.
            if (focusFeedback.current) {
              e.preventDefault();
              feedbackRef.current?.focus();
              focusFeedback.current = false;
            }
          }}
        >
          <DialogTitle>Offer this shift?</DialogTitle>
          <DialogDescription>
            {confirming &&
              `${formatShiftTime(confirming.startAt, confirming.endAt, org.timezone)}${confirming.location ? `, ${confirming.location}` : ''}. `}
            Colleagues who are allowed to take it can accept. A manager approves who gets it. The
            shift stays yours until then.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={() => confirming && offer(confirming)}>Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
