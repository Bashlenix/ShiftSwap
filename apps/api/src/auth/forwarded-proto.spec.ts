import { clientForwardedProto } from './forwarded-proto';

describe('clientForwardedProto', () => {
  it('keeps the leftmost scheme of a proxy chain', () => {
    expect(clientForwardedProto('https,http')).toBe('https');
    expect(clientForwardedProto('https, http')).toBe('https');
    expect(clientForwardedProto(['https', 'http'])).toBe('https');
    expect(clientForwardedProto('http')).toBe('http');
    expect(clientForwardedProto('HTTPS')).toBe('https');
  });

  it('drops missing or invalid values', () => {
    expect(clientForwardedProto(undefined)).toBeUndefined();
    expect(clientForwardedProto('')).toBeUndefined();
    expect(clientForwardedProto('javascript')).toBeUndefined();
    expect(clientForwardedProto('ftp,https')).toBeUndefined();
  });
});
