import { describe, expect, it } from 'vitest';
import config, { viteServerOptions } from './vite.config';

describe('viteServerOptions', () => {
  it('proxies /api to API_PROXY_TARGET', () => {
    const o = viteServerOptions({ API_PROXY_TARGET: 'http://api:3000' });
    expect(o.proxy['/api'].target).toBe('http://api:3000');
  });

  it('defaults the proxy target to localhost:3000', () => {
    expect(viteServerOptions({}).proxy['/api'].target).toBe('http://localhost:3000');
  });

  it('keeps the browser Origin and forwards the client IP', () => {
    const p = viteServerOptions({}).proxy['/api'];
    expect(p.changeOrigin).toBe(false);
    expect(p.xfwd).toBe(true);
  });

  it('allows localhost and Codespace hosts', () => {
    const { allowedHosts } = viteServerOptions({});
    expect(allowedHosts).toContain('.app.github.dev');
    expect(allowedHosts).toContain('localhost');
  });

  it('binds 0.0.0.0:5173 strictly', () => {
    const o = viteServerOptions({});
    expect(o.host).toBe('0.0.0.0');
    expect(o.port).toBe(5173);
    expect(o.strictPort).toBe(true);
  });

  it('applies the same options to server and preview', () => {
    const c = config as { server: unknown; preview: unknown };
    expect(c.server).toEqual(c.preview);
  });
});
