import { Deferred, Effect, FiberMap, Option, Queue, Ref, SynchronizedRef, type Duration } from "effect"
import type * as Scope from "effect/Scope"

type Job = {
  run: Effect.Effect<void, never>
  cancel: Effect.Effect<void, never>
}

/**
 * A keyed actor map — a concurrent map of serial work queues.
 *
 * Each key gets its own fiber-backed queue. Effects submitted to the same key
 * are executed sequentially (preserving order), while different keys run
 * concurrently. Optionally supports idle timeouts per key and per-key state
 * with persistence hooks.
 */
export declare namespace ActorMap {
  /**
   * Configuration for idle-timeout behavior and optional per-key state.
   *
   * When both `idleTimeout` and `onIdle` are provided, each key starts a timer
   * after activity. If no further activity (or explicit `touch`) occurs before
   * the timer expires, `onIdle` is called with that key.
   *
   * When `load` and/or `save` are provided, the actor map manages per-key
   * state of type `S`. `load` is called when an actor is first created to
   * hydrate state from storage. `save` is called after `run` completes when
   * the state has been modified.
   */
  export interface Options<K, S = void> {
    /** How long a key must be idle before `onIdle` fires. */
    idleTimeout?: Duration.DurationInput
    /** Callback invoked when a key's idle timer expires. */
    onIdle?: (key: K) => Effect.Effect<void, unknown, never>
    /** Load persisted state when an actor is first activated. */
    load?: (key: K) => Effect.Effect<Option.Option<S>, unknown, never>
    /** Save state after it has been modified during `run`. */
    save?: (key: K, state: S) => Effect.Effect<void, unknown, never>
  }

  export interface ActorMap<K, S = void> {
    /** Enqueue an effect onto a key's serial queue. Creates the actor if it
     *  doesn't exist yet. By default resets the key's idle timer (`touch: true`). */
    run: {
      <A, E>(
        key: K,
        effect: Effect.Effect<A, E>,
        options?: { touch?: boolean },
      ): Effect.Effect<A, E>
      <A, E>(
        key: K,
        f: (state: Ref.Ref<Option.Option<S>>) => Effect.Effect<A, E>,
        options?: { touch?: boolean },
      ): Effect.Effect<A, E>
    }
    /** Reset the idle timer for a key without enqueuing work. No-op if the key
     *  doesn't exist or no idle timeout is configured. */
    touch: (key: K) => Effect.Effect<void>
    /** Cancel the pending idle timer for a key without removing the actor. */
    cancelIdle: (key: K) => Effect.Effect<void>
    /** Tear down an actor: cancel its idle timer, interrupt its worker fiber,
     *  and shut down its queue. In-flight `run` calls are interrupted.
     *  The key can be re-created by a subsequent `run`. */
    remove: (key: K) => Effect.Effect<void>
    /** Remove all actors and cancel all idle timers. */
    stop: Effect.Effect<void>
    /** The number of currently active actor keys. */
    size: Effect.Effect<number>
    /** Read the current state for a key without running an effect.
     *  Returns None if the actor doesn't exist or has no state. */
    getState: (key: K) => Effect.Effect<Option.Option<S>>
  }
}

interface Entry<S> {
  queue: Queue.Queue<Job>
  state: Ref.Ref<Option.Option<S>>
}

export const ActorMap = {
  make: <K, S = void>(options?: ActorMap.Options<K, S>): Effect.Effect<ActorMap.ActorMap<K, S>, never, Scope.Scope> =>
    Effect.gen(function* () {
      const workers = yield* FiberMap.make<K>()
      const timers = yield* FiberMap.make<K>()
      const state = yield* SynchronizedRef.make(new Map<K, Entry<S>>())

      const has = (key: K) =>
        Effect.map(SynchronizedRef.get(state), (map) => map.has(key))

      const ensure = (key: K): Effect.Effect<Entry<S>> =>
        SynchronizedRef.modifyEffect(state, (map) => {
          const current = map.get(key)
          if (current) {
            return Effect.succeed([current, map] as const)
          }
          return Effect.gen(function* () {
            const q = yield* Queue.unbounded<Job>()
            // Load initial state from persistence hook if provided
            const initial: Option.Option<S> = options?.load
              ? yield* options.load(key).pipe(Effect.catchAll(() => Effect.succeed(Option.none<S>())))
              : Option.none<S>()
            const stateRef = yield* Ref.make(initial)
            yield* FiberMap.run(
              workers,
              key,
              Effect.forever(
                q.take.pipe(Effect.flatMap((job) => job.run)),
              ),
            ).pipe(Effect.asVoid)
            const entry: Entry<S> = { queue: q, state: stateRef }
            const next = new Map(map)
            next.set(key, entry)
            return [entry, next] as const
          })
        })

      const cancelIdle = (key: K) =>
        FiberMap.remove(timers, key)

      const remove = (key: K) =>
        Effect.gen(function* () {
          const entry = yield* SynchronizedRef.modify(state, (map) => {
            const current = map.get(key)
            if (!current) return [null as Entry<S> | null, map] as const
            const next = new Map(map)
            next.delete(key)
            return [current, next] as const
          })
          if (!entry) {
            yield* cancelIdle(key)
            return
          }
          yield* cancelIdle(key)
          yield* FiberMap.remove(workers, key)
          yield* entry.queue.takeAll.pipe(
            Effect.flatMap(
              Effect.forEach((job) => job.cancel, { discard: true }),
            ),
          )
          yield* entry.queue.shutdown
        })

      const touch = (key: K) =>
        Effect.gen(function* () {
          if (!options?.idleTimeout || !options.onIdle) return
          if (!(yield* has(key))) return
          yield* FiberMap.run(
            timers,
            key,
            options.onIdle(key).pipe(
              Effect.catchAll(() => Effect.void),
              Effect.delay(options.idleTimeout),
            ),
          ).pipe(Effect.asVoid)
        })

      const run = <A, E>(
        key: K,
        effectOrFn: Effect.Effect<A, E> | ((state: Ref.Ref<Option.Option<S>>) => Effect.Effect<A, E>),
        runOptions?: { touch?: boolean },
      ): Effect.Effect<A, E> =>
        Effect.gen(function* () {
          const entry = yield* ensure(key)
          const done = yield* Deferred.make<A, E>()

          // Snapshot state before running so we can detect changes
          const stateBefore = yield* Ref.get(entry.state)

          const effect: Effect.Effect<A, E> = Effect.isEffect(effectOrFn)
            ? effectOrFn
            : (effectOrFn as (state: Ref.Ref<Option.Option<S>>) => Effect.Effect<A, E>)(entry.state)

          yield* entry.queue.offer({
            run: Effect.uninterruptibleMask((restore) =>
              restore(effect).pipe(
                Effect.exit,
                Effect.flatMap((exit) => Deferred.done(done, exit)),
                Effect.asVoid,
              )),
            cancel: Deferred.interrupt(done).pipe(Effect.asVoid),
          }).pipe(Effect.asVoid)
          if (runOptions?.touch ?? true) {
            yield* touch(key)
          }
          const result = yield* Deferred.await(done)

          // Persist state if it changed and a save hook is configured
          if (options?.save) {
            const stateAfter = yield* Ref.get(entry.state)
            if (stateBefore !== stateAfter && Option.isSome(stateAfter)) {
              yield* options.save(key, stateAfter.value).pipe(
                Effect.catchAll(() => Effect.void),
              )
            }
          }

          return result
        })

      const stop = Effect.gen(function* () {
        const keys = [...(yield* SynchronizedRef.get(state)).keys()]
        yield* Effect.forEach(keys, (key) => remove(key), { discard: true, concurrency: "unbounded" })
      })

      const size = Effect.map(SynchronizedRef.get(state), (map) => map.size)

      const getState = (key: K): Effect.Effect<Option.Option<S>> =>
        Effect.gen(function* () {
          const map = yield* SynchronizedRef.get(state)
          const entry = map.get(key)
          if (!entry) return Option.none<S>()
          return yield* Ref.get(entry.state)
        })

      return { run, touch, cancelIdle, remove, stop, size, getState } satisfies ActorMap.ActorMap<K, S>
    }),
}
