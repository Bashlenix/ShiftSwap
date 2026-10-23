import type { AcceptanceStatus, OfferKind, OfferStatus } from '@shiftswap/shared';

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

/** Initial states on creation. */
export const OFFER_INITIAL_STATUS: OfferStatus = 'OPEN';
export const ACCEPTANCE_INITIAL_STATUS: Record<OfferKind, AcceptanceStatus> = {
  GIVE_AWAY: 'PENDING',
  OPEN_SHIFT: 'SELECTED',
};

const OFFER_TRANSITIONS: Record<OfferKind, Partial<Record<OfferStatus, readonly OfferStatus[]>>> = {
  GIVE_AWAY: { OPEN: ['APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'] },
  OPEN_SHIFT: { OPEN: ['FILLED', 'CANCELLED', 'EXPIRED'] },
};

const ACCEPTANCE_TRANSITIONS: Partial<Record<AcceptanceStatus, readonly AcceptanceStatus[]>> = {
  PENDING: ['SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'INVALIDATED'],
  WITHDRAWN: ['PENDING'],
  INVALIDATED: ['PENDING'],
};

export function assertOfferTransition(kind: OfferKind, from: OfferStatus, to: OfferStatus): void {
  if (!OFFER_TRANSITIONS[kind][from]?.includes(to)) {
    throw new InvalidTransitionError(`Invalid offer transition for ${kind}: ${from} -> ${to}`);
  }
}

export function assertAcceptanceTransition(from: AcceptanceStatus, to: AcceptanceStatus): void {
  if (!ACCEPTANCE_TRANSITIONS[from]?.includes(to)) {
    throw new InvalidTransitionError(`Invalid acceptance transition: ${from} -> ${to}`);
  }
}
