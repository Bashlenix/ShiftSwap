import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditEntryDto } from '@shiftswap/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { orgApi, useOrg } from '../org/useOrg';

const ENTITY_TYPES = [
  'acceptance',
  'invite',
  'membership',
  'offer',
  'organization',
  'shift',
  'skill',
  'unavailability',
];

interface Page {
  items: AuditEntryDto[];
  nextCursor: string | null;
}

export function AuditPage() {
  const org = useOrg();
  if (org.accessLevel === 'EMPLOYEE') return <p>Only managers can see this page.</p>;
  return <AuditTable />;
}

function AuditTable() {
  const org = useOrg();
  const [entityType, setEntityType] = useState('');

  const query = useInfiniteQuery({
    queryKey: ['audit', org.organizationId, entityType],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (entityType) params.set('entityType', entityType);
      if (pageParam) params.set('cursor', pageParam);
      const qs = params.toString();
      return apiFetch<Page>(orgApi(org, `/audit${qs ? `?${qs}` : ''}`));
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section aria-labelledby="audit-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="audit-heading" className="text-2xl font-semibold">
          Audit log
        </h1>
        <label className="ml-auto flex items-center gap-2 text-sm">
          Item type
          <select
            className="h-10 rounded-md border border-slate-400 bg-white px-2"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          >
            <option value="">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isError && <p role="alert">Could not load the audit log. Please try again.</p>}
      {query.isPending && <p>Loading…</p>}
      {query.data && items.length === 0 && <p>No entries.</p>}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">Audit log</caption>
            <thead>
              <tr className="border-b border-slate-300">
                {['When', 'Who', 'Action', 'Item'].map((h) => (
                  <th key={h} scope="col" className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-200">
                  <td className="p-2">{formatDateTime(e.createdAt, org.timezone)}</td>
                  <td className="p-2">{e.actorName ?? 'System'}</td>
                  <td className="p-2">{e.action}</td>
                  <td className="p-2">
                    {e.entityType} {e.entityId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </section>
  );
}
