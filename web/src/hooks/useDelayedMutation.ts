import { useCallback, useState } from 'react';
import { useMutation, type UseMutationOptions } from '@tanstack/react-query';

/**
 * Wraps useMutation with a guaranteed minimum loading duration so the
 * user actually sees the spinning icon and neon-charge animation.
 * The local API returns in <100ms which makes the pending state
 * invisible without this.
 *
 * Usage:
 *   const { run, isPending } = useDelayedMutation(
 *     { mutationFn: (v: number) => api('/x', { method: 'POST', body: v }),
 *       onSuccess: () => qc.invalidateQueries(...) },
 *     1000,
 *   );
 *   <NeonButton loading={isPending} icon="⚡" loadingText="Saving…" onClick={() => run(42)}>Save</NeonButton>
 */
export function useDelayedMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, Error, TVariables>,
  minDelayMs: number = 1000,
) {
  const [isPending, setIsPending] = useState(false);
  const mutation = useMutation<TData, Error, TVariables>(options);

  const run = useCallback(
    async (variables: TVariables) => {
      if (isPending) return;
      setIsPending(true);
      try {
        const result = await mutation.mutateAsync(variables);
        await new Promise((r) => setTimeout(r, minDelayMs));
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [mutation, isPending, minDelayMs],
  );

  return {
    run,
    isPending,
    data: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  };
}
