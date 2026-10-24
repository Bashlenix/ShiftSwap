import type { IncomingHttpHeaders } from 'node:http';

/** Shared by Better Auth's rate limiter and the invite throttler so both bucket the same client. */
export const IP_ADDRESS_HEADERS = ['x-forwarded-for'];
/** Loopback proxy hops (the web proxy) are skipped; CIDRs 127.0.0.0/8 and ::1. */
export const TRUSTED_PROXIES = ['127.0.0.0/8', '::1'];

const isTrustedProxy = (ip: string): boolean => {
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  return v === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
};

/**
 * Walks X-Forwarded-For right to left, skipping trusted proxies; the first untrusted hop is the
 * client. A client-supplied leftmost value therefore cannot pick its own bucket. Falls back to
 * the socket address.
 */
export function clientIp(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string {
  const raw = headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const hops = value
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i])) return hops[i];
  }
  return hops[0] ?? remoteAddress ?? 'unknown';
}
