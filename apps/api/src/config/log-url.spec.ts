import { pathOnly } from './log-url';

describe('pathOnly', () => {
  it('strips the query string', () => {
    expect(pathOnly('/api/auth/verify-email?token=secret&x=1')).toBe('/api/auth/verify-email');
  });
  it('keeps URLs without a query', () => {
    expect(pathOnly('/api/v1/me')).toBe('/api/v1/me');
  });
  it('redacts the invite token in the preview route', () => {
    expect(pathOnly('/api/v1/invites/abc_DEF-123')).toBe('/api/v1/invites/:token');
  });
  it('redacts the invite token in the accept route', () => {
    expect(pathOnly('/api/v1/invites/abc_DEF-123/accept')).toBe('/api/v1/invites/:token/accept');
  });
  it('redacts the token and strips the query together', () => {
    expect(pathOnly('/api/v1/invites/abc_DEF-123/accept?x=secret')).toBe(
      '/api/v1/invites/:token/accept',
    );
    expect(pathOnly('/api/v1/invites/abc_DEF-123?x=1')).toBe('/api/v1/invites/:token');
  });
  it('redacts regardless of case and trailing slash', () => {
    expect(pathOnly('/API/V1/Invites/abc/')).toBe('/API/V1/Invites/:token/');
    expect(pathOnly('/api/v1/invites/abc/Accept/')).toBe('/api/v1/invites/:token/Accept/');
  });
  it('leaves other paths untouched', () => {
    expect(pathOnly('/api/v1/orgs/o1/members/m1/invite')).toBe('/api/v1/orgs/o1/members/m1/invite');
    expect(pathOnly('/api/v1/invites')).toBe('/api/v1/invites');
    expect(pathOnly('/api/v1/invites/abc/accept/extra')).toBe('/api/v1/invites/abc/accept/extra');
  });
});
