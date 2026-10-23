const WEB_PORT = 5173;
const CODESPACE_ORIGIN = /^https:\/\/[a-z0-9-]+-5173\.app\.github\.dev$/;
/**
 * The Codespaces port forwarder rewrites the browser's Origin
 * `https://<codespace>-5173.app.github.dev` to `https://localhost:5173` before the request
 * reaches the app (seen on a real Codespace; other origins pass through unchanged).
 * Accepted residual risk: inside a Codespace the Origin check can no longer tell the
 * forwarded app apart from a page served on https://localhost:5173 of the same machine.
 * The forwarded port is private (GitHub login required) and the flag is demo-only.
 */
const TUNNEL_REWRITTEN_ORIGIN = `https://localhost:${WEB_PORT}`;

/** Public URL of the web app when running in a Codespace; undefined elsewhere. */
export function resolveBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  return name && domain ? `https://${name}-${WEB_PORT}.${domain}` : undefined;
}

/** True only when explicitly enabled and the origin is a forwarded port-5173 Codespace URL. */
export function isCodespaceOrigin(origin: string, env: NodeJS.ProcessEnv): boolean {
  return env.ALLOW_CODESPACE_ORIGINS === 'true' && CODESPACE_ORIGIN.test(origin);
}

export function resolveTrustedOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = [`http://localhost:${WEB_PORT}`];
  if (env.ALLOW_CODESPACE_ORIGINS === 'true') origins.push(TUNNEL_REWRITTEN_ORIGIN);
  const baseUrl = resolveBaseUrl(env);
  if (baseUrl) origins.push(baseUrl);
  for (const extra of (env.TRUSTED_ORIGINS ?? '').split(',')) {
    const o = extra.trim();
    if (o) origins.push(o);
  }
  return origins;
}

/**
 * Secure cookies need CODESPACE_NAME inside the api container, which Compose may not
 * pass through. Either way the browser only ever talks https to the forwarder, so it
 * stores and sends the session cookie (host-only, SameSite=Lax, same-origin fetches).
 */
export function useSecureCookies(env: NodeJS.ProcessEnv): boolean {
  return resolveBaseUrl(env) !== undefined;
}

export function isTrustedOrigin(origin: string, env: NodeJS.ProcessEnv): boolean {
  return resolveTrustedOrigins(env).includes(origin) || isCodespaceOrigin(origin, env);
}
