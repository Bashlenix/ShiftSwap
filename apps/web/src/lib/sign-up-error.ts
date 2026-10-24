/** Better Auth answers a duplicate email with 422 / USER_ALREADY_EXISTS (name varies by version). */
export function isAlreadyRegistered(error: { status?: number; code?: string }): boolean {
  return Boolean(error.code?.startsWith('USER_ALREADY_EXISTS')) || error.status === 422;
}
