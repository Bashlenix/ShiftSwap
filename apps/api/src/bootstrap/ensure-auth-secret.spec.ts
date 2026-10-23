import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureAuthSecret } from './ensure-auth-secret';

describe('ensureAuthSecret', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'auth-secret-'));
    file = join(dir, 'nested', 'auth-secret.env');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('env var wins and no file is created', () => {
    expect(ensureAuthSecret(file, { BETTER_AUTH_SECRET: 'from-env' })).toBe('from-env');
    expect(existsSync(file)).toBe(false);
  });

  it('generates a 32-byte base64url secret, stores it 0600, and reuses it', () => {
    const a = ensureAuthSecret(file, {});
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(ensureAuthSecret(file, {})).toBe(a);
  });

  it('ignores an empty env var', () => {
    expect(ensureAuthSecret(file, { BETTER_AUTH_SECRET: '' })).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
