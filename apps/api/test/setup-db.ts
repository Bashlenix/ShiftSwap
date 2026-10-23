import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';

const TEST_DB = 'shiftswap_test';

export function testDatabaseUrl(): string {
  const base =
    process.env.DATABASE_URL ?? 'postgresql://shiftswap:shiftswap@localhost:5432/shiftswap';
  const url = new URL(base);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

/**
 * Recreates the dedicated test database from scratch and applies all migrations.
 * Equivalent to `prisma migrate reset`, but never touches any database other than
 * `shiftswap_test` (dev data stays untouched).
 */
export default async function setupDb(): Promise<void> {
  const databaseUrl = testDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.BETTER_AUTH_SECRET = 'test-only-secret-0123456789abcdef0123456789';

  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
