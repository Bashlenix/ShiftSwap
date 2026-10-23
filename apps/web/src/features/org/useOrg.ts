import { createContext, useContext } from 'react';
import type { AccessLevel } from '../orgs/useMe';

export interface OrgInfo {
  organizationId: string;
  membershipId: string;
  organizationName: string;
  accessLevel: AccessLevel;
  /** IANA zone of the organisation; all times are shown in it. */
  timezone: string;
}

export const OrgContext = createContext<OrgInfo | null>(null);

export function useOrg(): OrgInfo {
  const org = useContext(OrgContext);
  if (!org) throw new Error('useOrg must be used inside OrgLayout');
  return org;
}

export const orgApi = (org: OrgInfo, path: string) => `/api/v1/orgs/${org.organizationId}${path}`;
