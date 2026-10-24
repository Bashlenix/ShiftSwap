import { useQuery } from '@tanstack/react-query';
import { HandHelping } from 'lucide-react';
import type { OfferSummaryDto } from '@shiftswap/shared';
import { Feedback } from '../../components/Feedback';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { useOfferMutation } from '../org/useOfferMutation';
import { useSkillNames } from '../org/useSkillNames';

/** Table action buttons may wrap to two lines on phones; let them grow past 44px. */
const ACTION_BUTTON = 'h-auto min-h-11 py-1.5 leading-tight';

export function OpenOffersPage() {
  const org = useOrg();
  const skillNames = useSkillNames();
  const { error, notice, mutation } = useOfferMutation('Done.');
  const offers = useQuery({
    queryKey: ['offers', org.organizationId, 'eligible'],
    queryFn: () => apiFetch<OfferSummaryDto[]>(orgApi(org, '/offers?scope=eligible')),
  });

  const run = (method: 'POST' | 'DELETE', path: string) =>
    mutation.mutate({ method, path: orgApi(org, path) });

  return (
    <section aria-labelledby="open-offers-heading" className="flex flex-col gap-4">
      <PageHeader
        id="open-offers-heading"
        title="Open offers"
        description="You only see offers you are allowed to take. The rules (rest time, daily and weekly hours, skills, availability) are company policy, not legal compliance."
      />
      <Feedback error={error} notice={notice} />
      {offers.isPending && <p>Loading…</p>}
      {offers.isError && <p role="alert">Could not load offers. Please try again.</p>}
      {offers.data?.length === 0 && (
        <EmptyState icon={HandHelping} title="No open offers right now." />
      )}
      {offers.data && offers.data.length > 0 && (
        <Table>
          <caption className="sr-only">Open offers you can take</caption>
          <THead>
            <TR>
              <TH>Shift</TH>
              <TH>Action</TH>
              <TH>Type</TH>
              <TH>Skills</TH>
              <TH>Location</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {offers.data.map((o) => (
              <TR key={o.id}>
                <TH scope="row">{formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}</TH>
                <TD>
                  {o.kind === 'OPEN_SHIFT' ? (
                    <Button
                      className={ACTION_BUTTON}
                      disabled={mutation.isPending}
                      onClick={() => run('POST', `/offers/${o.id}/claim`)}
                    >
                      Claim
                    </Button>
                  ) : o.myAcceptanceStatus === 'PENDING' ? (
                    <Button
                      className={ACTION_BUTTON}
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => run('DELETE', `/offers/${o.id}/acceptances/me`)}
                    >
                      Withdraw acceptance
                    </Button>
                  ) : o.myAcceptanceStatus === 'SELECTED' ? null : (
                    <div className="flex flex-col items-start gap-1">
                      {o.myAcceptanceStatus === 'INVALIDATED' && (
                        <p className="text-sm text-amber-900">
                          The shift changed — accept again if you still want it.
                        </p>
                      )}
                      <Button
                        className={ACTION_BUTTON}
                        disabled={mutation.isPending}
                        onClick={() => run('POST', `/offers/${o.id}/acceptances`)}
                      >
                        Accept
                      </Button>
                    </div>
                  )}
                </TD>
                <TD>{o.kind === 'GIVE_AWAY' ? 'Give-away' : 'Open shift'}</TD>
                <TD>{skillNames(o.shift.requiredSkillIds)}</TD>
                <TD>{o.shift.location ?? '—'}</TD>
                <TD>
                  {o.myAcceptanceStatus ? <StatusBadge status={o.myAcceptanceStatus} /> : '—'}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
