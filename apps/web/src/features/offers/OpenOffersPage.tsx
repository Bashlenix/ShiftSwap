import { useQuery } from '@tanstack/react-query';
import type { OfferSummaryDto } from '@shiftswap/shared';
import { Feedback } from '../../components/Feedback';
import { StatusBadge } from '../../components/StatusBadge';
import { Button } from '../../components/ui/button';
import { apiFetch } from '../../lib/api';
import { formatShiftTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';
import { useOfferMutation } from '../org/useOfferMutation';
import { useSkillNames } from '../org/useSkillNames';

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
      <h1 id="open-offers-heading" className="text-2xl font-semibold">
        Open offers
      </h1>
      <p className="text-sm text-slate-700">
        You only see offers you are allowed to take. The rules (rest time, daily and weekly hours,
        skills, availability) are company policy, not legal compliance.
      </p>
      <Feedback error={error} notice={notice} />
      {offers.isPending && <p>Loading…</p>}
      {offers.isError && <p role="alert">Could not load offers. Please try again.</p>}
      {offers.data?.length === 0 && <p>No open offers right now.</p>}
      {offers.data && offers.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Open offers you can take</caption>
          <thead>
            <tr className="border-b border-slate-300">
              <th scope="col" className="p-2">
                Shift
              </th>
              <th scope="col" className="p-2">
                Type
              </th>
              <th scope="col" className="p-2">
                Skills
              </th>
              <th scope="col" className="p-2">
                Location
              </th>
              <th scope="col" className="p-2">
                Status
              </th>
              <th scope="col" className="p-2">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.data.map((o) => (
              <tr key={o.id} className="border-b border-slate-200">
                <th scope="row" className="p-2 font-medium">
                  {formatShiftTime(o.shift.startAt, o.shift.endAt, org.timezone)}
                </th>
                <td className="p-2">{o.kind === 'GIVE_AWAY' ? 'Give-away' : 'Open shift'}</td>
                <td className="p-2">{skillNames(o.shift.requiredSkillIds)}</td>
                <td className="p-2">{o.shift.location ?? '—'}</td>
                <td className="p-2">
                  {o.myAcceptanceStatus ? <StatusBadge status={o.myAcceptanceStatus} /> : '—'}
                </td>
                <td className="p-2">
                  {o.kind === 'OPEN_SHIFT' ? (
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => run('POST', `/offers/${o.id}/claim`)}
                    >
                      Claim
                    </Button>
                  ) : o.myAcceptanceStatus === 'PENDING' ? (
                    <Button
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => run('DELETE', `/offers/${o.id}/acceptances/me`)}
                    >
                      Withdraw acceptance
                    </Button>
                  ) : (
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => run('POST', `/offers/${o.id}/acceptances`)}
                    >
                      Accept
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
