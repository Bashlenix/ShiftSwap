import { AppOriginRegistry } from './app-origin';

describe('AppOriginRegistry', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.ALLOW_CODESPACE_ORIGINS;
    delete process.env.CODESPACE_NAME;
    delete process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    delete process.env.TRUSTED_ORIGINS;
  });
  afterAll(() => {
    process.env = saved;
  });

  it('falls back to http://localhost:5173 when nothing is known', () => {
    expect(new AppOriginRegistry().baseUrl()).toBe('http://localhost:5173');
  });

  it('falls back to resolveBaseUrl(env) before the localhost default', () => {
    process.env.CODESPACE_NAME = 'demo';
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = 'app.github.dev';
    expect(new AppOriginRegistry().baseUrl()).toBe('https://demo-5173.app.github.dev');
  });

  it('ignores an untrusted origin', () => {
    const r = new AppOriginRegistry();
    r.remember('https://evil.example');
    expect(r.baseUrl()).toBe('http://localhost:5173');
  });

  it('ignores a missing header and keeps the last trusted origin', () => {
    process.env.ALLOW_CODESPACE_ORIGINS = 'true';
    const r = new AppOriginRegistry();
    r.remember('https://abc-5173.app.github.dev');
    r.remember(undefined);
    r.remember('https://evil.example');
    expect(r.baseUrl()).toBe('https://abc-5173.app.github.dev');
  });

  it('remembers http://localhost:5173', () => {
    process.env.CODESPACE_NAME = 'demo';
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN = 'app.github.dev';
    const r = new AppOriginRegistry();
    r.remember('http://localhost:5173');
    expect(r.baseUrl()).toBe('http://localhost:5173');
  });

  it('remembers a *-5173.app.github.dev origin when ALLOW_CODESPACE_ORIGINS=true', () => {
    process.env.ALLOW_CODESPACE_ORIGINS = 'true';
    const r = new AppOriginRegistry();
    r.remember('https://my-space-5173.app.github.dev');
    expect(r.baseUrl()).toBe('https://my-space-5173.app.github.dev');
  });

  it('ignores a Codespace origin without ALLOW_CODESPACE_ORIGINS', () => {
    const r = new AppOriginRegistry();
    r.remember('https://my-space-5173.app.github.dev');
    expect(r.baseUrl()).toBe('http://localhost:5173');
  });
});
