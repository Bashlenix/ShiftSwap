import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createAuth } from '../auth/auth';
import { PrismaService } from '../prisma/prisma.service';
import { seedDemo } from '../seed/seed-demo';
import { ensureAuthSecret } from './ensure-auth-secret';

/**
 * Container entrypoint: secret, migrations, optional demo seed, then the API.
 * Any failure exits non-zero so Compose restarts the container.
 */
async function start(): Promise<void> {
  // Must happen before anything builds the Better Auth instance (it would otherwise
  // fall back to a publicly known default secret).
  process.env.BETTER_AUTH_SECRET = ensureAuthSecret(
    process.env.AUTH_SECRET_FILE ?? '/data/auth-secret.env',
    process.env,
  );

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '../..'),
    stdio: 'inherit',
  });

  if (process.env.SEED_ON_START === 'true') {
    const prisma = new PrismaService();
    try {
      const counts = await seedDemo(prisma, createAuth(prisma, process.env));
      console.log(JSON.stringify({ msg: 'demo data seeded', ...counts }));
    } finally {
      await prisma.$disconnect();
    }
  }

  await import('../main.js');
}

start().catch((err: unknown) => {
  console.error('start failed:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
