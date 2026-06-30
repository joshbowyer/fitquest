import { useCallback, useRef, useState } from 'react';
import { useMutation, type UseMutationOptions } from '@tanstack/react-query';

/**
 * Wraps useMutation with a guaranteed minimum loading duration so the
 * user actually sees the spinning icon and neon-charge animation.
 * The local API returns in <100ms which makes the pending state
 * invisible without this.
 *
 * Usage:
 *   const { run, isPending, variables } = useDelayedMutation(
 *     { mutationFn: (v: number) => api('/x', { method: 'POST', body: v }),
 *       onSuccess: () => qc.invalidateQueries(...) },
 *     1000,
 *   );
 *   <NeonButton loading={isPending} icon="⚡" loadingText="Saving…" onClick={() => run(42)}>Save</NeonButton>
 *
 * The `variables` field exposes the most-recently-mutated variables so
 * callers can match on them when several instances of the same
 * mutation are in flight (e.g. disable the specific row's button
 * while it's in flight, not the whole list).
 */
export function useDelayedMutation<TData = unknown, TVariables = void>(
  options: UseMutationOptions<TData, Error, TVariables>,
  minDelayMs: number = 1000,
) {
  const [isPending, setIsPending] = useState(false);
  // Ref (not state) so the variables handle is stable across
  // renders — readers consume it synchronously in the same render
  // the in-flight button is being checked.
  const lastVariablesRef = useRef<TVariables | undefined>(undefined);
  const mutation = useMutation<TData, Error, TVariables>(options);

  const run = useCallback(
    async (variables: TVariables) => {
      if (isPending) return;
      lastVariablesRef.current = variables;
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
    variables: lastVariablesRef.current,
    data: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  };
}
