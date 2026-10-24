import type { AcceptanceStatus } from './offers';

/** What the acceptance endpoints return (the caller's own acceptance row). */
export interface AcceptanceDto {
  id: string;
  offerId: string;
  membershipId: string;
  status: AcceptanceStatus;
  createdAt: string;
}
