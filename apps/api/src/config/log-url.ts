// The invite token sits in the path of the public invite routes; it is a bearer secret.
// Express routing is case-insensitive and tolerates a trailing slash, so the match is too.
const INVITE_TOKEN_PATH = /^(\/api\/v1\/invites\/)[^/]+(\/accept)?(\/?)$/i;

/**
 * Makes a request URL safe to log: drops the query string (auth routes can carry tokens
 * there) and replaces the invite token segment with `:token`.
 */
export function pathOnly(url: string): string {
  const i = url.indexOf('?');
  const path = i === -1 ? url : url.slice(0, i);
  return path.replace(INVITE_TOKEN_PATH, '$1:token$2$3');
}
