/** Drops the query string: auth routes can carry tokens there. */
export function pathOnly(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
