import { useQuery } from '@tanstack/react-query';
import type { SkillDto } from '@shiftswap/shared';
import { apiFetch } from '../../lib/api';
import { orgApi, useOrg } from './useOrg';

/** One cached skills query; returns a function mapping skill ids to a readable list. */
export function useSkillNames() {
  const org = useOrg();
  const { data } = useQuery({
    queryKey: ['skills', org.organizationId],
    queryFn: () => apiFetch<SkillDto[]>(orgApi(org, '/skills')),
    staleTime: 5 * 60_000,
  });
  const names = new Map((data ?? []).map((s) => [s.id, s.name]));
  return (ids: string[]): string =>
    ids.length === 0 ? 'None' : ids.map((id) => names.get(id) ?? '…').join(', ');
}
