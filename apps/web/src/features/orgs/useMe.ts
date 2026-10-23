import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export type AccessLevel = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';

export interface Me {
  user: { id: string; email: string; name: string };
  memberships: {
    membershipId: string;
    organizationId: string;
    organizationName: string;
    organizationTimezone: string;
    offerLeadTimeMin: number;
    accessLevel: AccessLevel;
  }[];
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => apiFetch<Me>('/api/v1/me') });
}
