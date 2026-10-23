import type { AcceptanceStatus, OfferKind, OfferStatus } from '@shiftswap/shared';
import { InvalidTransitionError, assertAcceptanceTransition, assertOfferTransition } from './offer-state';

const KINDS: OfferKind[] = ['GIVE_AWAY', 'OPEN_SHIFT'];
const OFFER: OfferStatus[] = ['OPEN', 'APPROVED', 'REJECTED', 'FILLED', 'CANCELLED', 'EXPIRED'];
const ACC: AcceptanceStatus[] = ['PENDING', 'SELECTED', 'NOT_SELECTED', 'WITHDRAWN', 'INVALIDATED'];

const allowedOffer = new Set([
  'GIVE_AWAY:OPEN:APPROVED', 'GIVE_AWAY:OPEN:REJECTED', 'OPEN_SHIFT:OPEN:FILLED',
  'GIVE_AWAY:OPEN:CANCELLED', 'OPEN_SHIFT:OPEN:CANCELLED', 'GIVE_AWAY:OPEN:EXPIRED', 'OPEN_SHIFT:OPEN:EXPIRED',
]);
const allowedAcc = new Set([
  'PENDING:SELECTED', 'PENDING:NOT_SELECTED', 'PENDING:WITHDRAWN', 'PENDING:INVALIDATED',
  'WITHDRAWN:PENDING', 'INVALIDATED:PENDING',
]);

describe('assertOfferTransition', () => {
  for (const kind of KINDS) for (const from of OFFER) for (const to of OFFER) {
    const ok = allowedOffer.has(`${kind}:${from}:${to}`);
    it(`${kind} ${from}->${to} ${ok ? 'passes' : 'throws'}`, () => {
      if (ok) expect(() => assertOfferTransition(kind, from, to)).not.toThrow();
      else {
        expect(() => assertOfferTransition(kind, from, to)).toThrow(InvalidTransitionError);
        try { assertOfferTransition(kind, from, to); } catch (e) {
          expect((e as InvalidTransitionError).code).toBe('INVALID_TRANSITION');
          expect((e as Error).message).toContain(kind);
        }
      }
    });
  }
  it('GIVE_AWAY OPEN->FILLED and OPEN_SHIFT OPEN->APPROVED throw', () => {
    expect(() => assertOfferTransition('GIVE_AWAY', 'OPEN', 'FILLED')).toThrow(InvalidTransitionError);
    expect(() => assertOfferTransition('OPEN_SHIFT', 'OPEN', 'APPROVED')).toThrow(InvalidTransitionError);
  });
});

describe('assertAcceptanceTransition', () => {
  for (const from of ACC) for (const to of ACC) {
    const ok = allowedAcc.has(`${from}:${to}`);
    it(`${from}->${to} ${ok ? 'passes' : 'throws'}`, () => {
      if (ok) expect(() => assertAcceptanceTransition(from, to)).not.toThrow();
      else {
        expect(() => assertAcceptanceTransition(from, to)).toThrow(InvalidTransitionError);
        try { assertAcceptanceTransition(from, to); } catch (e) {
          expect((e as InvalidTransitionError).code).toBe('INVALID_TRANSITION');
        }
      }
    });
  }
});
