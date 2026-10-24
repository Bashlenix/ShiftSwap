import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiSend } from '../../lib/api';
import { errorMessage } from '../../lib/error-messages';

type Method = 'POST' | 'DELETE';

/**
 * Runs an offer-related write, then refreshes offers and shifts.
 * Exposes the user-facing error/notice texts for a `<Feedback>` region.
 */
export function useOfferMutation<T = unknown>(successNotice: string | null = null) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (v: {
      method: Method;
      path: string;
      body?: unknown;
      notice?: string;
      candidate?: string;
    }) =>
      v.body === undefined ? apiSend<T>(v.method, v.path) : apiSend<T>(v.method, v.path, v.body),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (_data, v) => setNotice(v.notice ?? successNotice),
    onError: (err, v) => setError(errorMessage(err, { candidate: v.candidate })),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['offers'] }),
        queryClient.invalidateQueries({ queryKey: ['shifts'] }),
      ]);
    },
  });
  return { error, notice, mutation };
}
