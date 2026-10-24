const FALLBACK = '/orgs';

/**
 * Sanitises a `?next=` value so a login/sign-up link can never bounce the user to another site.
 * Only same-origin absolute paths pass; anything else becomes `/orgs`.
 */
export function safeNext(raw: string | null): string {
  if (typeof raw !== 'string' || raw === '') return FALLBACK;
  if (!raw.startsWith('/')) return FALLBACK;
  // `//host` is protocol-relative; browsers also treat `\` like `/`, so `/\host` is the same trick.
  if (raw.startsWith('//') || raw.includes('\\')) return FALLBACK;
  if (raw.includes('://')) return FALLBACK;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return FALLBACK;
  return raw;
}

/** Builds `/login?next=…` / `/signup?next=…` hrefs; `next` is already sanitised by callers. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
