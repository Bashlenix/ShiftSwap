import { pathOnly } from './log-url';

describe('pathOnly', () => {
  it('strips the query string', () => {
    expect(pathOnly('/api/auth/verify-email?token=secret&x=1')).toBe('/api/auth/verify-email');
  });
  it('keeps URLs without a query', () => {
    expect(pathOnly('/api/v1/me')).toBe('/api/v1/me');
  });
});
