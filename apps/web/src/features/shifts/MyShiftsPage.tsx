import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
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
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { useOfferMutation } from '../org/useOfferMutation';
import { useSkillNames } from '../org/useSkillNames';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Table action buttons may wrap to two lines on phones; let them grow past 44px. */
const ACTION_BUTTON = 'h-auto min-h-11 py-1.5 leading-tight';

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

  // scope=mine also returns offers I only accepted; those are not mine to describe.
  const ownOffers = myOffers.data?.filter((o) => o.originalOwnerMembershipId === org.membershipId);
  const acceptedOffers = myOffers.data?.filter(
    (o) => o.originalOwnerMembershipId !== org.membershipId,
  );

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
        <PageHeader
          id="my-shifts-heading"
          title="My shifts"
          description="Your shifts for the next 14 days."
        />
        <Feedback error={error} notice={notice} containerRef={feedbackRef} />
        {shifts.isPending && <p>Loading…</p>}
        {shifts.isError && <p role="alert">Could not load your shifts. Please try again.</p>}
        {shifts.data?.length === 0 && (
          <EmptyState icon={CalendarCheck} title="You have no shifts in the next 14 days." />
        )}
        {shifts.data && shifts.data.length > 0 && (
          <Table>
            <caption className="sr-only">Your shifts in the next 14 days</caption>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Action</TH>
                <TH>Skills</TH>
                <TH>Location</TH>
                <TH>Offer</TH>
              </TR>
            </THead>
            <tbody>
              {shifts.data.map((s) => {
                const own = openGiveAway(s.id);
                const canOffer =
                  s.openOfferId === null &&
                  !own &&
                  Date.now() < Date.parse(s.startAt) - org.offerLeadTimeMin * 60_000;
                return (
                  <TR key={s.id}>
                    <TH scope="row">{formatShiftTime(s.startAt, s.endAt, org.timezone)}</TH>
                    <TD>
                      {canOffer && (
                        <Button
                          className={ACTION_BUTTON}
                          disabled={mutation.isPending}
                          onClick={() => setConfirming(s)}
                        >
                          Offer this shift
                        </Button>
                      )}
                      {own && (
                        <Button
                          className={ACTION_BUTTON}
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
                    </TD>
                    <TD>{skillNames(s.requiredSkillIds)}</TD>
                    <TD>{s.location ?? '—'}</TD>
                    <TD>{s.openOfferId ? <StatusBadge status="OPEN" /> : 'Not offered'}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="my-offers-heading" className="flex flex-col gap-3">
        <h2 id="my-offers-heading" className="text-lg font-semibold tracking-tight">
          My offers
        </h2>
        {ownOffers?.length === 0 && (
          <EmptyState className="py-6" title="You have not offered any shifts." />
        )}
        {ownOffers && ownOffers.length > 0 && (
          <Table>
            <caption className="sr-only">Shifts you have offered</caption>
            <THead>
              <TR>
                <TH>Shift</TH>
                <TH>Status</TH>
                <TH>Interested colleagues</TH>
              </TR>
            </THead>
            <tbody>
              {ownOffers.map((o) => (
                <TR key={o.id}>
                  <TH scope="row">
                    {formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}
                  </TH>
                  <TD>
                    <StatusBadge status={o.status} />
                  </TD>
                  <TD>{o.pendingCount}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="my-acceptances-heading" className="flex flex-col gap-3">
        <h2 id="my-acceptances-heading" className="text-lg font-semibold tracking-tight">
          My acceptances
        </h2>
        {acceptedOffers?.length === 0 && (
          <EmptyState className="py-6" title="You have not asked to take any shifts." />
        )}
        {acceptedOffers && acceptedOffers.length > 0 && (
          <Table>
            <caption className="sr-only">Shifts you have asked to take</caption>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Skills</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <tbody>
              {acceptedOffers.map((o) => (
                <TR key={o.id}>
                  <TH scope="row">
                    {formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}
                  </TH>
                  <TD>{skillNames(o.shift.requiredSkillIds)}</TD>
                  <TD>{o.myAcceptanceStatus && <StatusBadge status={o.myAcceptanceStatus} />}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
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
