import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import type { MemberDto, OfferSummaryDto } from '@shiftswap/shared';
import { Link, useParams } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { OfferReviewDetail } from './OfferReviewDetail';

export function OfferReviewPage() {
  const org = useOrg();
  if (org.accessLevel === 'EMPLOYEE') return <p>Only managers can see this page.</p>;
  return <ReviewList />;
}

function ReviewList() {
  const org = useOrg();
  const { offerId } = useParams();
  const offers = useQuery({
    queryKey: ['offers', org.organizationId, 'review'],
    queryFn: () => apiFetch<OfferSummaryDto[]>(orgApi(org, '/offers?scope=review')),
  });
  const members = useQuery({
    queryKey: ['members', org.organizationId],
    queryFn: () => apiFetch<MemberDto[]>(orgApi(org, '/members')),
  });
  const nameOf = (id: string | null) =>
    id === null ? 'Open shift' : (members.data?.find((m) => m.id === id)?.displayName ?? '…');

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="review-heading" className="flex flex-col gap-4">
        <PageHeader
          id="review-heading"
          title="Offer review"
          description="Offers with people waiting for a decision. The hour and rest rules are company policy, not legal compliance."
        />
        {offers.isPending && <p>Loading…</p>}
        {offers.isError && <p role="alert">Could not load offers. Please try again.</p>}
        {offers.data?.length === 0 && (
          <EmptyState icon={ClipboardCheck} title="No offers to review right now." />
        )}
        {offers.data && offers.data.length > 0 && (
          <Table>
            <caption className="sr-only">Offers to review</caption>
            <THead>
              <TR>
                <TH>Shift</TH>
                <TH>Owner</TH>
                <TH>Status</TH>
                <TH>Pending</TH>
                <TH>Action</TH>
              </TR>
            </THead>
            <tbody>
              {offers.data.map((o) => {
                const time = formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone);
                return (
                  <TR key={o.id}>
                    <TH scope="row">{time}</TH>
                    <TD>{nameOf(o.originalOwnerMembershipId)}</TD>
                    <TD>
                      <StatusBadge status={o.status} />
                    </TD>
                    <TD>{o.pendingCount}</TD>
                    <TD>
                      <Link
                        to={`/orgs/${org.organizationId}/review/${o.id}`}
                        aria-label={`Review ${time}`}
                        className="font-medium text-brand-strong underline underline-offset-2"
                      >
                        Review
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
      {offerId && <OfferReviewDetail key={offerId} offerId={offerId} />}
    </div>
  );
}
