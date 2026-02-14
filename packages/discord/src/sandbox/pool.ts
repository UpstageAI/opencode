import { Context, Duration, Effect, Layer, Option, Ref, Schedule } from "effect"
import { AppConfig } from "../config"
import {
  type ConfigEncodeError,
  DatabaseError,
  type HealthCheckError,
  type OpenCodeClientError,
  type SandboxCreateError,
  type SandboxExecError,
  SandboxDeadError,
  type SandboxNotFoundError,
  type SandboxStartError,
} from "../errors"
import { ActorMap } from "../lib/actors/keyed"
import { logIgnore } from "../lib/log"
import { SessionStore } from "../sessions/store"
import { ChannelId, GuildId, PreviewAccess, SessionInfo, ThreadId } from "../types"
import { OpenCodeClient } from "./opencode-client"
import { SandboxProvisioner } from "./provisioner"

/** Per-thread handle returned by ThreadAgentPool.resolve. */
export interface ThreadAgent {
  readonly threadId: ThreadId
  /** Snapshot from when this agent handle was created. Prefer `current()` for live state. */
  readonly session: SessionInfo
  readonly current: () => Effect.Effect<SessionInfo, DatabaseError>
  readonly send: (text: string) => Effect.Effect<string, OpenCodeClientError | SandboxDeadError | DatabaseError>
  readonly pause: (reason?: string) => Effect.Effect<void, DatabaseError>
  readonly destroy: () => Effect.Effect<void, DatabaseError>
}

type Runtime = {
  readonly current: () => Effect.Effect<SessionInfo, DatabaseError>
  readonly ensure: (
    channelId: ChannelId,
    guildId: GuildId,
  ) => Effect.Effect<
    SessionInfo,
    | SandboxCreateError
    | SandboxExecError
    | SandboxNotFoundError
    | SandboxStartError
    | HealthCheckError
    | OpenCodeClientError
    | ConfigEncodeError
    | SandboxDeadError
    | DatabaseError
  >
  readonly send: (text: string) => Effect.Effect<string, OpenCodeClientError | SandboxDeadError | DatabaseError>
  readonly pause: (reason: string) => Effect.Effect<void, DatabaseError>
  readonly destroy: (reason: string) => Effect.Effect<void, DatabaseError>
}

export declare namespace ThreadAgentPool {
  export interface Service {
    /** Get an existing healthy ThreadAgent or create one. */
    readonly getOrCreate: (
      threadId: ThreadId,
      channelId: ChannelId,
      guildId: GuildId,
    ) => Effect.Effect<
      ThreadAgent,
      | SandboxCreateError
      | SandboxExecError
      | SandboxNotFoundError
      | SandboxStartError
      | HealthCheckError
      | OpenCodeClientError
      | ConfigEncodeError
      | SandboxDeadError
      | DatabaseError
    >
    readonly hasTrackedThread: (threadId: ThreadId) => Effect.Effect<boolean, DatabaseError>
    readonly getTrackedSession: (threadId: ThreadId) => Effect.Effect<Option.Option<SessionInfo>, DatabaseError>
    readonly getActiveSessionCount: () => Effect.Effect<number, DatabaseError>
    readonly pauseSession: (threadId: ThreadId, reason?: string) => Effect.Effect<void, DatabaseError>
    readonly destroySession: (threadId: ThreadId) => Effect.Effect<void, DatabaseError>
  }
}

export class ThreadAgentPool extends Context.Tag("@discord/ThreadAgentPool")<
  ThreadAgentPool,
  ThreadAgentPool.Service
>() {
  static readonly layer = Layer.scoped(
    ThreadAgentPool,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const provisioner = yield* SandboxProvisioner
      const oc = yield* OpenCodeClient
      const store = yield* SessionStore

      const runtime = (
        threadId: ThreadId,
        state: Ref.Ref<Option.Option<SessionInfo>>,
      ): Runtime => {
        const dead = (error: OpenCodeClientError) => {
          if (error.statusCode === 404) return true
          if (error.statusCode === 0 || error.statusCode >= 500) return true
          const body = error.body.toLowerCase()
          if (body.includes("sandbox not found")) return true
          if (body.includes("is the sandbox started")) return true
          return false
        }

        const lookup = Effect.fnUntraced(function* () {
          const loaded = yield* Ref.get(state)
          if (Option.isSome(loaded)) return loaded
          return Option.none<SessionInfo>()
        })

        const current = Effect.fnUntraced(function* () {
          const session = yield* lookup()
          if (Option.isSome(session)) return session.value
          return yield* new DatabaseError({
            cause: new Error(`missing session for thread ${threadId}`),
          })
        })

        const ensure = (channelId: ChannelId, guildId: GuildId) =>
          Effect.gen(function* () {
            const next = yield* provisioner.ensureActive({
              threadId,
              channelId,
              guildId,
              current: yield* Ref.get(state),
            })
            yield* Ref.set(state, Option.some(next))
            return next
          })

        const send = (text: string) =>
          Effect.gen(function* () {
            yield* store.markActivity(threadId)
            const session = yield* current()
            return yield* oc.sendPrompt(PreviewAccess.from(session), session.sessionId, text).pipe(
              Effect.catchTag("OpenCodeClientError", (error) =>
                provisioner.recoverSendFailure(threadId, session, error).pipe(
                  Effect.flatMap((next) =>
                    Ref.set(state, Option.some(next)),
                  ),
                  Effect.flatMap(() => {
                    const failure: OpenCodeClientError | SandboxDeadError = dead(error)
                      ? new SandboxDeadError({
                        threadId,
                        reason: `OpenCode send failed (${error.statusCode})`,
                      })
                      : error
                    return Effect.fail(failure)
                  }),
                ),
              ),
            )
          })

        const pause = (reason: string) =>
          Effect.gen(function* () {
            const session = yield* lookup()
            if (Option.isNone(session)) return
            const next = yield* provisioner.pause(threadId, session.value, reason)
            yield* Ref.set(state, Option.some(next))
          })

        const destroy = (reason: string) =>
          Effect.gen(function* () {
            const session = yield* lookup()
            if (Option.isNone(session)) return
            const next = yield* provisioner.destroy(threadId, session.value, reason)
            yield* Ref.set(state, Option.some(next))
          })

        return { current, ensure, send, pause, destroy }
      }

      const actors: ActorMap.ActorMap<ThreadId, SessionInfo> = yield* ActorMap.make<ThreadId, SessionInfo>({
        idleTimeout: config.sandboxTimeout,
        onIdle: (threadId) =>
          logIgnore(
            runRuntime(
              threadId,
              (rt) => rt.pause("inactivity-timeout"),
              { touch: false },
            ).pipe(
              Effect.tap(() => actors.remove(threadId)),
            ),
            "idle-pause",
          ),
        load: (threadId) => store.getByThread(threadId).pipe(Effect.catchAll(() => Effect.succeed(Option.none()))),
        save: (_threadId, session) => logIgnore(store.upsert(session), "save-session").pipe(Effect.asVoid),
      })

      const runRuntime = <A, E>(
        threadId: ThreadId,
        f: (rt: Runtime) => Effect.Effect<A, E>,
        options?: { touch?: boolean },
      ) =>
        actors.run(
          threadId,
          (state) => f(runtime(threadId, state)),
          options,
        )

      const pauseNow = (threadId: ThreadId, reason: string) =>
        runRuntime(threadId, (rt) => rt.pause(reason), { touch: false }).pipe(
          Effect.tap(() => actors.remove(threadId)),
        )

      const destroyNow = (threadId: ThreadId, reason: string) =>
        runRuntime(threadId, (rt) => rt.destroy(reason), { touch: false }).pipe(
          Effect.tap(() => actors.remove(threadId)),
        )

      const makeAgent = (threadId: ThreadId, session: SessionInfo): ThreadAgent => ({
        threadId,
        session,
        current: () =>
          runRuntime(threadId, (rt) => rt.current(), { touch: false }),
        send: (text: string) =>
          runRuntime(threadId, (rt) => rt.send(text)),
        pause: (reason = "manual") => pauseNow(threadId, reason),
        destroy: () => destroyNow(threadId, "agent-destroy"),
      })

      const getOrCreate = Effect.fn("ThreadAgentPool.getOrCreate")(function* (
        threadId: ThreadId,
        channelId: ChannelId,
        guildId: GuildId,
      ) {
        const session = yield* runRuntime(
          threadId,
          (rt) => rt.ensure(channelId, guildId),
        )
        return makeAgent(threadId, session)
      })

      const hasTrackedThread = Effect.fn("ThreadAgentPool.hasTrackedThread")(function* (threadId: ThreadId) {
        return yield* store.hasTrackedThread(threadId)
      })

      const getTrackedSession = Effect.fn("ThreadAgentPool.getTrackedSession")(function* (threadId: ThreadId) {
        return yield* store.getByThread(threadId)
      })

      const getActiveSessionCount = Effect.fn("ThreadAgentPool.getActiveSessionCount")(function* () {
        return (yield* store.listActive()).length
      })

      const pauseSession = Effect.fn("ThreadAgentPool.pauseSession")(function* (
        threadId: ThreadId,
        reason = "manual",
      ) {
        yield* pauseNow(threadId, reason)
      })

      const destroySession = Effect.fn("ThreadAgentPool.destroySession")(function* (threadId: ThreadId) {
        yield* destroyNow(threadId, "manual-destroy")
      })

      const cleanupPass = Effect.fnUntraced(function* () {
        const stale = yield* store.listStaleActive(
          Math.ceil(Duration.toMinutes(config.sandboxTimeout)) + config.staleActiveGraceMinutes,
        )
        yield* Effect.forEach(
          stale,
          (row) =>
            logIgnore(
              pauseNow(row.threadId, "cleanup-stale-active"),
              "cleanup-pause",
            ),
          { concurrency: "unbounded", discard: true },
        )

        const expired = yield* store.listExpiredPaused(config.pausedTtlMinutes)
        yield* Effect.forEach(
          expired,
          (row) =>
            logIgnore(
              destroyNow(row.threadId, "cleanup-expired-paused"),
              "cleanup-destroy",
            ),
          { concurrency: "unbounded", discard: true },
        )
      })

      yield* cleanupPass().pipe(
        Effect.catchAll((error) =>
          Effect.logError("Cleanup loop failed").pipe(
            Effect.annotateLogs({ event: "cleanup.loop.failed", error: String(error) }),
          ),
        ),
        Effect.repeat(Schedule.spaced(config.cleanupInterval)),
        Effect.forkScoped,
      )

      return ThreadAgentPool.of({
        getOrCreate,
        hasTrackedThread,
        getTrackedSession,
        getActiveSessionCount,
        pauseSession,
        destroySession,
      })
    }),
  )
}
