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
    advanced: { useSecureCookies: useSecureCookies(env) },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
