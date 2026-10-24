import { z } from 'zod';

/** Body of `DELETE /api/v1/me`: the user types DELETE to confirm (FR-23). */
export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') }).strict();
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
