import {
  isCodespaceOrigin,
  isTrustedOrigin,
  resolveBaseUrl,
  resolveTrustedOrigins,
  useSecureCookies,
} from './auth-config';

const cs = {
  CODESPACE_NAME: 'bashlenix-abc123',
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
};
const demo = { ALLOW_CODESPACE_ORIGINS: 'true' };

describe('auth-config', () => {
  it('resolveBaseUrl is undefined outside a Codespace', () => {
    expect(resolveBaseUrl({})).toBeUndefined();
  });

  it('resolveBaseUrl uses the forwarded Codespace URL', () => {
    expect(resolveBaseUrl(cs)).toBe('https://bashlenix-abc123-5173.app.github.dev');
  });

  it('isCodespaceOrigin accepts only the 5173 https forwarded origin when enabled', () => {
    expect(isCodespaceOrigin('https://bashlenix-abc123-5173.app.github.dev', demo)).toBe(true);
    expect(isCodespaceOrigin('https://bashlenix-abc123-5173.app.github.dev', {})).toBe(false);
    expect(isCodespaceOrigin('https://bashlenix-abc123-3000.app.github.dev', demo)).toBe(false);
    expect(isCodespaceOrigin('https://evil.app.github.dev.example.com', demo)).toBe(false);
    expect(isCodespaceOrigin('http://bashlenix-abc123-5173.app.github.dev', demo)).toBe(false);
  });

  it('resolveTrustedOrigins lists localhost, Codespace and configured origins', () => {
    expect(resolveTrustedOrigins({})).toEqual(['http://localhost:5173']);
    expect(resolveTrustedOrigins(cs)).toEqual([
      'http://localhost:5173',
      'https://bashlenix-abc123-5173.app.github.dev',
    ]);
    expect(
      resolveTrustedOrigins({ TRUSTED_ORIGINS: 'http://web:5173, http://127.0.0.1:5173' }),
    ).toEqual(['http://localhost:5173', 'http://web:5173', 'http://127.0.0.1:5173']);
  });

  // The Codespaces forwarder rewrites the browser Origin to https://localhost:5173.
  it('trusts the forwarder-rewritten origin only when Codespace origins are enabled', () => {
    expect(resolveTrustedOrigins(demo)).toEqual([
      'http://localhost:5173',
      'https://localhost:5173',
    ]);
    expect(isTrustedOrigin('https://localhost:5173', demo)).toBe(true);
    expect(isTrustedOrigin('https://localhost:5173', {})).toBe(false);
    expect(isTrustedOrigin('https://localhost:5173', cs)).toBe(false);
    expect(isTrustedOrigin('https://localhost:3000', demo)).toBe(false);
  });

  it('useSecureCookies is true only in a Codespace', () => {
    expect(useSecureCookies({})).toBe(false);
    expect(useSecureCookies(cs)).toBe(true);
  });

  it('isTrustedOrigin accepts configured and enabled Codespace origins only', () => {
    expect(isTrustedOrigin('http://localhost:5173', {})).toBe(true);
    expect(isTrustedOrigin('https://evil.example', {})).toBe(false);
    expect(isTrustedOrigin('https://bashlenix-abc123-5173.app.github.dev', demo)).toBe(true);
    expect(isTrustedOrigin('https://bashlenix-abc123-5173.app.github.dev', {})).toBe(false);
  });
});
