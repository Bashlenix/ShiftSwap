import { HttpException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InvalidTransitionError } from '../offers/offer-state';
import { DomainError } from './domain-error';
import { ErrorFilter } from './error.filter';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res }) };
  new ErrorFilter().catch(exception, host as never);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] };
}

describe('ErrorFilter', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('renders DomainError with details and its status', () => {
    const { status, body } = run(
      new DomainError('INELIGIBLE', 'Not eligible', { failedRules: ['OVERLAP'] }),
    );
    expect(status).toBe(422);
    expect(body).toEqual({
      error: { code: 'INELIGIBLE', message: 'Not eligible', details: { failedRules: ['OVERLAP'] } },
    });
  });

  it('omits details when there are none', () => {
    const { body } = run(new DomainError('NOT_FOUND', 'Not found'));
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  it('maps InvalidTransitionError to 409 INVALID_TRANSITION', () => {
    const { status, body } = run(new InvalidTransitionError('nope'));
    expect(status).toBe(409);
    expect(body.error.code).toBe('INVALID_TRANSITION');
  });

  it('maps Nest HttpExceptions', () => {
    expect(run(new NotFoundException()).body.error.code).toBe('NOT_FOUND');
    expect(run(new UnauthorizedException()).body.error.code).toBe('UNAUTHENTICATED');
    expect(run(new HttpException('x', 403)).body.error.code).toBe('FORBIDDEN');
  });

  it('maps a P2002 on offers_one_open_per_shift to 409 OFFER_ALREADY_OPEN', () => {
    // Shape captured from a real Prisma 7 + pg adapter violation (see tenancy e2e for the live one).
    const e = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { index: 'offers_one_open_per_shift' },
          },
        },
        modelName: 'Offer',
      },
    });
    const { status, body } = run(e);
    expect(status).toBe(409);
    expect(body.error.code).toBe('OFFER_ALREADY_OPEN');
  });

  it('does not map other unique violations', () => {
    const e = Object.assign(new Error('x'), {
      code: 'P2002',
      meta: { constraint: { index: 'other' } },
    });
    expect(run(e).body.error.code).toBe('INTERNAL');
  });

  it('hides unknown errors behind 500 INTERNAL', () => {
    const { status, body } = run(new Error('secret db password'));
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  it('maps 4xx errors from express body parsing to 400 VALIDATION_FAILED', () => {
    const { status, body } = run(Object.assign(new Error('bad json'), { status: 400 }));
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
