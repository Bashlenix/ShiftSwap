import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY = 'BETTER_AUTH_SECRET';

/**
 * Returns the signing secret for sessions. Order: env var, then the persisted file,
 * else generate once and persist (so restarts do not log everyone out).
 */
export function ensureAuthSecret(secretFilePath: string, env: NodeJS.ProcessEnv): string {
  const fromEnv = env[KEY];
  if (fromEnv) return fromEnv;

  if (existsSync(secretFilePath)) {
    const line = readFileSync(secretFilePath, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${KEY}=`));
    const stored = line?.slice(KEY.length + 1).trim();
    if (stored) return stored;
  }

  const secret = randomBytes(32).toString('base64url');
  mkdirSync(dirname(secretFilePath), { recursive: true });
  writeFileSync(secretFilePath, `${KEY}=${secret}\n`, { mode: 0o600 });
  chmodSync(secretFilePath, 0o600);
  return secret;
}
