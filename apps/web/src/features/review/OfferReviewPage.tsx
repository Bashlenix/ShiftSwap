import { useQuery } from '@tanstack/react-query';
import type { MemberDto, OfferSummaryDto } from '@shiftswap/shared';
import { Link, useParams } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge';
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
        <h1 id="review-heading" className="text-2xl font-semibold">
          Offer review
        </h1>
        <p className="text-sm text-slate-700">
          Offers with people waiting for a decision. The hour and rest rules are company policy, not
          legal compliance.
        </p>
        {offers.isPending && <p>Loading…</p>}
        {offers.isError && <p role="alert">Could not load offers. Please try again.</p>}
        {offers.data?.length === 0 && <p>No offers to review right now.</p>}
        {offers.data && offers.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Offers to review</caption>
            <thead>
              <tr className="border-b border-slate-300">
                <th scope="col" className="p-2">
                  Shift
                </th>
                <th scope="col" className="p-2">
                  Owner
                </th>
                <th scope="col" className="p-2">
                  Status
                </th>
                <th scope="col" className="p-2">
                  Pending
                </th>
                <th scope="col" className="p-2">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {offers.data.map((o) => {
                const time = formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone);
                return (
                  <tr key={o.id} className="border-b border-slate-200">
                    <th scope="row" className="p-2 font-medium">
                      {time}
                    </th>
                    <td className="p-2">{nameOf(o.originalOwnerMembershipId)}</td>
                    <td className="p-2">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="p-2">{o.pendingCount}</td>
                    <td className="p-2">
                      <Link
                        to={`/orgs/${org.organizationId}/review/${o.id}`}
                        aria-label={`Review ${time}`}
                        className="text-indigo-800 underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {offerId && <OfferReviewDetail key={offerId} offerId={offerId} />}
    </div>
  );
}
