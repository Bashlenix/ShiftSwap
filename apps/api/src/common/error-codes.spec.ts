import { isErrorCode } from './error-codes';

describe('isErrorCode', () => {
  it('accepts known codes', () => {
    expect(isErrorCode('VERSION_CONFLICT')).toBe(true);
  });
  it('rejects unknown codes', () => {
    expect(isErrorCode('NOPE')).toBe(false);
  });
});
