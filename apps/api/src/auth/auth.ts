import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  isCodespaceOrigin,
  resolveBaseUrl,
  resolveTrustedOrigins,
  useSecureCookies,
} from '../config/auth-config';
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
    emailAndPassword: { enabled: true, requireEmailVerification: false, minPasswordLength: 8 },
    session: { expiresIn: 60 * 60 * 24 * 7 },
    // Off by default outside production; keep it on (library defaults: sign-in 3 per 10s per IP).
    rateLimit: { enabled: true },
    advanced: {
      useSecureCookies: useSecureCookies(env),
      // The web proxy sets x-forwarded-for. Loopback hops are skipped so a client-supplied
      // leftmost value cannot choose its own rate-limit bucket.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: ['127.0.0.0/8', '::1'] },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
