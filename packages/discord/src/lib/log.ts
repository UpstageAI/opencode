import { Effect } from "effect"

/** Swallow errors with a warning log. Use for best-effort bookkeeping writes. */
export const logIgnore = <A>(effect: Effect.Effect<A, unknown>, context: string) =>
  effect.pipe(
    Effect.catchAll((err) =>
      Effect.logWarning(`${context} failed (ignored)`).pipe(Effect.annotateLogs({ error: String(err) })),
    ),
  )
