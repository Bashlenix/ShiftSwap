import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('skips loopback hops from the right', () => {
    expect(clientIp({ 'x-forwarded-for': '10.9.0.1, 127.0.0.1' }, '::1')).toBe('10.9.0.1');
  });
  it('ignores a spoofed leftmost value', () => {
    expect(clientIp({ 'x-forwarded-for': '6.6.6.6, 10.9.0.1, 127.0.0.1' }, '::1')).toBe('10.9.0.1');
  });
  it('falls back to the socket address without the header', () => {
    expect(clientIp({}, '192.0.2.5')).toBe('192.0.2.5');
  });
  it('handles ::1 and mapped loopback hops', () => {
    expect(clientIp({ 'x-forwarded-for': '10.9.0.3, ::ffff:127.0.0.1, ::1' }, undefined)).toBe('10.9.0.3');
  });
});
