import { useQuery } from '@tanstack/react-query';
import { RULE_LABELS, type OfferDetailDto } from '@shiftswap/shared';
import { useEffect, useRef } from 'react';
import { Feedback } from '../../components/Feedback';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { useOfferMutation } from '../org/useOfferMutation';
import { useSkillNames } from '../org/useSkillNames';

export function OfferReviewDetail({ offerId }: { offerId: string }) {
  const org = useOrg();
  const skillNames = useSkillNames();
  const { error, notice, mutation } = useOfferMutation();
  const feedbackRef = useRef<HTMLDivElement>(null);
  const focusFeedback = useRef(false);
  const offer = useQuery({
    queryKey: ['offers', org.organizationId, 'detail', offerId],
    queryFn: () => apiFetch<OfferDetailDto>(orgApi(org, `/offers/${offerId}`)),
  });

  // The clicked button may be gone or disabled after the refetch; announce there instead.
  useEffect(() => {
    if ((error || notice) && focusFeedback.current) {
      feedbackRef.current?.focus();
      focusFeedback.current = false;
    }
  }, [error, notice]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const loaded = offer.isSuccess;
  useEffect(() => {
    if (loaded) headingRef.current?.focus();
  }, [loaded]);

  if (offer.isPending) return <p>Loading…</p>;
  if (offer.isError) return <p role="alert">Could not load this offer. Please try again.</p>;

  const o = offer.data;
  const open = o.status === 'OPEN';
  const act = (path: string, body: object, done: string, candidate?: string) => {
    focusFeedback.current = true;
    mutation.mutate({ method: 'POST', path: orgApi(org, path), body, notice: done, candidate });
  };

  return (
    <section aria-labelledby="review-detail-heading" className="flex flex-col gap-4">
      <h2
        id="review-detail-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold tracking-tight outline-none"
      >
        {formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}
      </h2>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={o.status} />
        <span>Skills: {skillNames(o.shift.requiredSkillIds)}</span>
        {o.shift.location && <span>Location: {o.shift.location}</span>}
      </p>
      <Feedback error={error} notice={notice} containerRef={feedbackRef} />
      {o.acceptances.length === 0 && <p>No one has accepted yet.</p>}
      <ul className="flex flex-col gap-3">
        {o.acceptances.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-slate-200 bg-surface p-4 shadow-soft"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{a.displayName}</span>
              {a.status === 'PENDING' ? (
                <>
                  {a.score && (
                    <span className="text-sm">
                      {`Score ${a.score.total} — Preference +${a.score.breakdown.preference} · Headroom +${a.score.breakdown.headroom} · Swap load +${a.score.breakdown.swapLoad}`}
                    </span>
                  )}
                  {!a.recheck.eligible && (
                    <span className="text-sm text-amber-900">
                      {`Not eligible now: ${a.recheck.failedRules.map((r) => RULE_LABELS[r] ?? r).join(', ')}`}
                    </span>
                  )}
                </>
              ) : (
                <span>
                  <StatusBadge status={a.status} />
                </span>
              )}
            </div>
            {a.status === 'PENDING' && (
              <Button
                disabled={!open || !a.recheck.eligible || mutation.isPending}
                onClick={() =>
                  act(
                    `/offers/${o.id}/approve`,
                    { acceptanceId: a.id, version: o.version },
                    `Approved ${a.displayName}.`,
                    a.displayName,
                  )
                }
              >
                {`Approve ${a.displayName}`}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <div>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => act(`/offers/${o.id}/reject`, { version: o.version }, 'Offer rejected.')}
          >
            Reject offer
          </Button>
        </div>
      )}
    </section>
  );
}
