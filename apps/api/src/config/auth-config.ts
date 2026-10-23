const WEB_PORT = 5173;
const CODESPACE_ORIGIN = /^https:\/\/[a-z0-9-]+-5173\.app\.github\.dev$/;

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
  const baseUrl = resolveBaseUrl(env);
  if (baseUrl) origins.push(baseUrl);
  for (const extra of (env.TRUSTED_ORIGINS ?? '').split(',')) {
    const o = extra.trim();
    if (o) origins.push(o);
  }
  return origins;
}

export function useSecureCookies(env: NodeJS.ProcessEnv): boolean {
  return resolveBaseUrl(env) !== undefined;
}

export function isTrustedOrigin(origin: string, env: NodeJS.ProcessEnv): boolean {
  return resolveTrustedOrigins(env).includes(origin) || isCodespaceOrigin(origin, env);
}
