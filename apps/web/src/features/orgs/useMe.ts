import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export type AccessLevel = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';

export interface Me {
  user: { id: string; email: string; name: string };
  memberships: { organizationId: string; organizationName: string; accessLevel: AccessLevel }[];
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/api/v1/me') });
}
