import { createHash, randomBytes } from 'node:crypto';
import { isTrustedOrigin } from '../config/auth-config';

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
const FALLBACK_ORIGIN = 'http://localhost:5173';

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes as base64url (43 chars). Only the SHA-256 hex hash is ever stored. */
export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/**
 * Builds the link from the client-supplied origin only when it is trusted; never from
 * request headers (the Codespaces forwarder rewrites Origin/Host).
 */
export function inviteLink(
  appOrigin: string | undefined,
  env: NodeJS.ProcessEnv,
  token: string,
): string {
  const origin = appOrigin && isTrustedOrigin(appOrigin, env) ? appOrigin : FALLBACK_ORIGIN;
  return `${origin}/invites/${token}`;
}
