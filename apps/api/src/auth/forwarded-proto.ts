/**
 * Better Auth's Node adapter builds the request URL as `${x-forwarded-proto}://${host}`.
 * Behind two proxies the header is a list: the Codespaces forwarder sends `https` and the
 * Vite proxy (xfwd) appends `,http`, so the URL `https,http://...` is invalid and every
 * auth request failed with 500. Keep only the client-facing (leftmost) scheme.
 */
export function clientForwardedProto(header: string | string[] | undefined): string | undefined {
  const first = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')[0]
    .trim()
    .toLowerCase();
  return first === 'http' || first === 'https' ? first : undefined;
}
