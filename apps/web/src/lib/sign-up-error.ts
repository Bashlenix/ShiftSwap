/** Better Auth answers a duplicate email with USER_ALREADY_EXISTS (suffix varies by version). */
export function isAlreadyRegistered(error: { status?: number; code?: string }): boolean {
  return Boolean(error.code?.startsWith('USER_ALREADY_EXISTS'));
}
