import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  isCodespaceOrigin,
  resolveBaseUrl,
  resolveTrustedOrigins,
  useSecureCookies,
} from '../config/auth-config';
import { IP_ADDRESS_HEADERS, TRUSTED_PROXIES } from '../common/client-ip';
import type { PrismaClient } from '../generated/prisma/client';

export function createAuth(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    basePath: '/api/auth',
    baseURL: resolveBaseUrl(env),
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: (request) => {
      const origin = request?.headers.get('origin');
      return [
        ...resolveTrustedOrigins(env),
        ...(origin && isCodespaceOrigin(origin, env) ? [origin] : []),
      ];
    },
    // Tests provoke wrong-password and rate-limit warnings on purpose; keep errors visible.
    logger: { level: env.NODE_ENV === 'test' ? 'error' : 'warn' },
    emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8 },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    // Read-only (never settable by sign-up/update); getSession returns it so SessionGuard can
    // reject a session that a sign-in created while the account was being deleted.
    user: {
      additionalFields: {
        deletedAt: { type: 'date', required: false, input: false },
      },
    },
    // Off by default outside production; keep it on (library defaults: sign-in 3 per 10s per IP).
    rateLimit: { enabled: true },
    advanced: {
      useSecureCookies: useSecureCookies(env),
      // The web proxy sets x-forwarded-for. Loopback hops are skipped so a client-supplied
      // leftmost value cannot choose its own rate-limit bucket.
      ipAddress: { ipAddressHeaders: IP_ADDRESS_HEADERS, trustedProxies: TRUSTED_PROXIES },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
