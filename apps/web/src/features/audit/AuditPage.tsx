import { useInfiniteQuery } from '@tanstack/react-query';
import type { AuditEntryDto } from '@shiftswap/shared';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { controlClass } from '../../components/ui/control';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Table, TD, TH, THead, TR } from '../../components/ui/table';
import { apiFetch } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { cn } from '../../lib/utils';
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
      <PageHeader
        id="audit-heading"
        title="Audit log"
        actions={
          <label className="flex items-center gap-2 text-sm font-medium">
            Item type
            <select
              className={cn(controlClass, 'h-11 w-auto')}
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
        }
      />
      {query.isError && <p role="alert">Could not load the audit log. Please try again.</p>}
      {query.isPending && <p>Loading…</p>}
      {query.data && items.length === 0 && <EmptyState icon={ScrollText} title="No entries." />}
      {items.length > 0 && (
        <Table className="min-w-[36rem]">
          <caption className="sr-only">Audit log</caption>
          <THead>
            <TR>
              {['When', 'Who', 'Action', 'Item'].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </TR>
          </THead>
          <tbody>
            {items.map((e) => (
              <TR key={e.id}>
                <TD>{formatDateTime(e.createdAt, org.timezone)}</TD>
                <TD>{e.actorName ?? 'System'}</TD>
                <TD>{e.action}</TD>
                <TD>
                  {e.entityType} {e.entityId.slice(0, 8)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
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
