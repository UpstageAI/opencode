import { FetchHttpClient } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Duration, Effect, Exit, Fiber, Layer, LogLevel, Logger, Option, Ref, Schema } from "effect"
import { AppConfig } from "../../config"
import { SqliteDb } from "../../db/client"
import { DaytonaService } from "../../sandbox/daytona"
import { OpenCodeClient } from "../../sandbox/opencode-client"
import { ThreadAgentPool } from "../../sandbox/pool"
import { SandboxProvisioner } from "../../sandbox/provisioner"
import { SessionStore } from "../../sessions/store"
import { ChannelId, GuildId, PreviewAccess, SandboxId, SessionInfo, ThreadId } from "../../types"

const BaseLayer = Layer.mergeAll(
  AppConfig.layer,
  FetchHttpClient.layer,
  BunContext.layer,
  Logger.minimumLogLevel(LogLevel.None),
)
const WithSqlite = Layer.provideMerge(SqliteDb.layer, BaseLayer)
const WithDaytona = Layer.provideMerge(DaytonaService.layer, WithSqlite)
const WithOpenCode = Layer.provideMerge(OpenCodeClient.layer, WithDaytona)
const WithSessions = Layer.provideMerge(SessionStore.layer, WithOpenCode)
const WithProvisioner = Layer.provideMerge(SandboxProvisioner.layer, WithSessions)
const CoreLayer = Layer.provideMerge(ThreadAgentPool.layer, WithProvisioner)

const restart =
  'pkill -f \'opencode serve --port 4096\' >/dev/null 2>&1 || true; for d in "$HOME/opencode" "/home/daytona/opencode" "/root/opencode"; do if [ -d "$d" ]; then cd "$d" && setsid opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 & exit 0; fi; done; exit 1'

type Opt = Record<string, string | boolean>

class CtlUsageError extends Schema.TaggedError<CtlUsageError>()("CtlUsageError", {
  message: Schema.String,
}) {}

class CtlInternalError extends Schema.TaggedError<CtlInternalError>()("CtlInternalError", {
  message: Schema.String,
  cause: Schema.Defect,
}) {}

const usage = (message: string) => CtlUsageError.make({ message })
const internal = (cause: unknown, message = text(cause)) => CtlInternalError.make({ message, cause })

const text = (cause: unknown) => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === "object" && cause !== null && "_tag" in cause && "message" in cause) {
    const tag = (cause as { _tag?: unknown })._tag
    const message = (cause as { message?: unknown }).message
    if (typeof tag === "string" && typeof message === "string") return `${tag}: ${message}`
  }
  if (typeof cause === "object" && cause !== null) return String(cause)
  return String(cause)
}

const parse = (argv: ReadonlyArray<string>) => {
  const input = argv.slice(2)
  const cmd = input.at(0)?.toLowerCase() ?? "help"
  const scan = input.slice(1).reduce(
    (state: { opts: Opt; args: ReadonlyArray<string>; key: string | null }, token) => {
      if (token.startsWith("--")) {
        const key = token.slice(2)
        if (key.length === 0) return state
        if (state.key) {
          return {
            opts: { ...state.opts, [state.key]: true },
            args: state.args,
            key,
          }
        }
        return { ...state, key }
      }
      if (state.key) {
        return {
          opts: { ...state.opts, [state.key]: token },
          args: state.args,
          key: null,
        }
      }
      return { ...state, args: [...state.args, token] }
    },
    { opts: {} as Opt, args: [] as ReadonlyArray<string>, key: null as string | null },
  )
  if (!scan.key) return { cmd, opts: scan.opts, args: scan.args }
  return {
    cmd,
    opts: { ...scan.opts, [scan.key]: true },
    args: scan.args,
  }
}

const value = (opts: Opt, key: string) => {
  const raw = opts[key]
  if (typeof raw !== "string") return null
  const out = raw.trim()
  if (!out) return null
  return out
}

const number = (opts: Opt, key: string, fallback: number) => {
  const raw = value(opts, key)
  if (!raw) return fallback
  const out = Number(raw)
  if (!Number.isInteger(out) || out <= 0) return fallback
  return out
}

const flag = (opts: Opt, key: string) => {
  const raw = opts[key]
  if (raw === true) return true
  if (typeof raw !== "string") return false
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes"
}

let ctlSeq = 0
const pick = (opts: Opt, active: ReadonlyArray<{ threadId: ThreadId }>) => {
  const raw = value(opts, "thread")
  if (raw) return Effect.succeed(ThreadId.make(raw))
  if (active.length === 1) return Effect.succeed(active[0].threadId)
  if (active.length > 1) return Effect.fail(usage("missing --thread (multiple active sessions)"))
  ctlSeq += 1
  return Effect.succeed(ThreadId.make(`ctl-${ctlSeq}`))
}

const print = (ok: boolean, command: string, payload: Record<string, unknown>) =>
  Effect.sync(() => {
    process.stdout.write(
      `${JSON.stringify({
        ok,
        command,
        ...payload,
      }, null, 2)}\n`,
    )
  })

const event = (command: string, name: string, payload: Record<string, unknown>) =>
  Effect.sync(() => {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        command,
        event: name,
        ...payload,
      })}\n`,
    )
  })

const run = Effect.gen(function* () {
  const ctl = parse(process.argv)
  const config = yield* AppConfig
  const pool = yield* ThreadAgentPool
  const sessions = yield* SessionStore
  const daytona = yield* DaytonaService
  const oc = yield* OpenCodeClient
  const active = yield* sessions.listActive()
  const tracked = (thread_id: ThreadId) =>
    Effect.gen(function* () {
      const row = yield* pool.getTrackedSession(thread_id)
      if (Option.isSome(row)) return row.value
      return yield* usage(`no tracked session for thread ${thread_id}`)
    })
  const resolve = (thread_id: ThreadId, opts: Opt): Effect.Effect<SessionInfo, CtlUsageError | CtlInternalError> =>
    Effect.gen(function* () {
      const row = yield* pool.getTrackedSession(thread_id).pipe(
        Effect.catchAll((cause) =>
          internal(cause),
        ),
      )
      if (Option.isSome(row)) {
        const agent = yield* pool.getOrCreate(thread_id, row.value.channelId, row.value.guildId).pipe(
          Effect.catchAll((cause) =>
            internal(cause),
          ),
        )
        return yield* agent.current().pipe(
          Effect.catchAll((cause) =>
            internal(cause),
          ),
        )
      }
      const channel = value(opts, "channel") ?? "ctl"
      const guild = value(opts, "guild") ?? "local"
      const agent = yield* pool.getOrCreate(thread_id, ChannelId.make(channel), GuildId.make(guild)).pipe(
        Effect.catchAll((cause) =>
          internal(cause),
        ),
      )
      return yield* agent.current().pipe(
        Effect.catchAll((cause) =>
          internal(cause),
        ),
      )
    })

  if (ctl.cmd === "help") {
    return yield* print(true, ctl.cmd, {
      usage: [
        "conversation:ctl active",
        "conversation:ctl status --thread <id>",
        "conversation:ctl logs --thread <id> [--lines 120]",
        "conversation:ctl pause --thread <id>",
        "conversation:ctl destroy --thread <id>",
        "conversation:ctl resume --thread <id> [--channel <id> --guild <id>]",
        "conversation:ctl restart --thread <id>",
        "conversation:ctl send --thread <id> --text <message> [--follow --wait-ms 180000 --logs-every-ms 2000 --lines 80]",
      ],
    })
  }

  if (ctl.cmd === "active") {
    return yield* print(true, ctl.cmd, {
      count: active.length,
      sessions: active.map((row) => ({
        threadId: row.threadId,
        channelId: row.channelId,
        guildId: row.guildId,
        sandboxId: row.sandboxId,
        sessionId: row.sessionId,
        status: row.status,
        resumeFailCount: row.resumeFailCount,
        lastError: row.lastError,
      })),
    })
  }

  if (ctl.cmd === "status") {
    const thread_id = yield* pick(ctl.opts, active)
    return yield* pool.getTrackedSession(thread_id).pipe(
      Effect.flatMap((row) =>
        print(true, ctl.cmd, {
          threadId: thread_id,
          tracked: Option.isSome(row),
          session: Option.isSome(row)
            ? {
                threadId: row.value.threadId,
                channelId: row.value.channelId,
                guildId: row.value.guildId,
                sandboxId: row.value.sandboxId,
                sessionId: row.value.sessionId,
                status: row.value.status,
                resumeFailCount: row.value.resumeFailCount,
                lastError: row.value.lastError,
              }
            : null,
        })),
    )
  }

  if (ctl.cmd === "logs") {
    const thread_id = yield* pick(ctl.opts, active)
    const lines = number(ctl.opts, "lines", 120)
    const row = yield* tracked(thread_id)
    const out = yield* daytona.exec(
      row.sandboxId,
      "read-opencode-log",
      `cat /tmp/opencode.log 2>/dev/null | tail -${lines}`,
    )
    return yield* print(true, ctl.cmd, {
      threadId: thread_id,
      sandboxId: row.sandboxId,
      lines,
      output: out.output,
    })
  }

  if (ctl.cmd === "pause") {
    const thread_id = yield* pick(ctl.opts, active)
    yield* pool.pauseSession(thread_id, "manual-ctl")
    return yield* print(true, ctl.cmd, { threadId: thread_id })
  }

  if (ctl.cmd === "destroy") {
    const thread_id = yield* pick(ctl.opts, active)
    yield* pool.destroySession(thread_id)
    return yield* print(true, ctl.cmd, { threadId: thread_id })
  }

  if (ctl.cmd === "resume") {
    const thread_id = yield* pick(ctl.opts, active)
    const row = yield* resolve(thread_id, ctl.opts)
    return yield* print(true, ctl.cmd, {
      threadId: thread_id,
      session: {
        sandboxId: row.sandboxId,
        sessionId: row.sessionId,
        status: row.status,
      },
    })
  }

  if (ctl.cmd === "restart") {
    const thread_id = yield* pick(ctl.opts, active)
    const row = yield* resolve(thread_id, ctl.opts)
    yield* daytona.exec(row.sandboxId, "restart-opencode-serve", restart)
    const healthy = yield* oc.waitForHealthy(PreviewAccess.from(row), config.activeHealthCheckTimeoutMs).pipe(
      Effect.catchAll(() => Effect.succeed(false)),
    )
    return yield* print(true, ctl.cmd, {
      threadId: thread_id,
      sandboxId: row.sandboxId,
      healthy,
    })
  }

  if (ctl.cmd === "send") {
    const thread_id = yield* pick(ctl.opts, active)
    const message = value(ctl.opts, "text") ?? ctl.args.join(" ").trim()
    if (!message) {
      return yield* usage("missing message text (pass --text \"...\")")
    }
    const wait = number(ctl.opts, "wait-ms", 0)
    const every = number(ctl.opts, "logs-every-ms", 2000)
    const lines = number(ctl.opts, "lines", 80)
    const follow = flag(ctl.opts, "follow") || wait > 0

    if (!follow) {
      const row = yield* resolve(thread_id, ctl.opts)
      const agent = yield* pool.getOrCreate(thread_id, row.channelId, row.guildId)
      const reply = yield* agent.send(message)
      const current = yield* agent.current()
      return yield* print(true, ctl.cmd, {
        threadId: thread_id,
        sandboxId: current.sandboxId,
        sessionId: current.sessionId,
        reply,
      })
    }

    const known = yield* pool.getTrackedSession(thread_id).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none())),
    )
    const sandbox = yield* Ref.make<SandboxId | null>(Option.isSome(known) ? known.value.sandboxId : null)
    const last = yield* Ref.make<string>("")
    const started = Date.now()

    const fiber = yield* Effect.fork(
      Effect.gen(function* () {
        const row = yield* resolve(thread_id, ctl.opts)
        yield* Ref.set(sandbox, row.sandboxId)
        const agent = yield* pool.getOrCreate(thread_id, row.channelId, row.guildId)
        const reply = yield* agent.send(message)
        const current = yield* agent.current()
        return { row: current, reply }
      }),
    )

    yield* event(ctl.cmd, "started", {
      threadId: thread_id,
      waitMs: wait,
      logsEveryMs: every,
      lines,
    })

    const waitTick = Effect.void.pipe(Effect.delay(Duration.millis(every)))
    const loop = (): Effect.Effect<{ row: SessionInfo; reply: string }, unknown> =>
      Effect.gen(function* () {
        const done = yield* Fiber.poll(fiber)
        if (Option.isSome(done)) {
          if (Exit.isSuccess(done.value)) return done.value.value
          return yield* Effect.failCause(done.value.cause)
        }

        const elapsed = Date.now() - started
        if (wait > 0 && elapsed >= wait) {
          yield* Fiber.interrupt(fiber)
          return yield* usage(`send timed out after ${wait}ms`)
        }

        const sandboxId = yield* Ref.get(sandbox)
        if (!sandboxId) {
          yield* event(ctl.cmd, "progress", {
            threadId: thread_id,
            elapsedMs: elapsed,
            stage: "resolving-session",
          })
          yield* waitTick
          return yield* loop()
        }

        const output = yield* daytona.exec(
          sandboxId,
          "read-opencode-log",
          `cat /tmp/opencode.log 2>/dev/null | tail -${lines}`,
        ).pipe(
          Effect.map((row) => row.output),
          Effect.catchAll((cause) =>
            Effect.succeed(`(log read failed: ${text(cause)})`),
          ),
        )

        const previous = yield* Ref.get(last)
        if (output !== previous) {
          yield* Ref.set(last, output)
          yield* event(ctl.cmd, "progress", {
            threadId: thread_id,
            elapsedMs: elapsed,
            sandboxId,
            logs: output,
          })
        } else {
          yield* event(ctl.cmd, "progress", {
            threadId: thread_id,
            elapsedMs: elapsed,
            sandboxId,
            logs: "(no change)",
          })
        }

        yield* waitTick
        return yield* loop()
      })

    const result = yield* loop()
    return yield* print(true, ctl.cmd, {
      threadId: thread_id,
      sandboxId: result.row.sandboxId,
      sessionId: result.row.sessionId,
      reply: result.reply,
    })
  }

  return yield* usage(`unknown command: ${ctl.cmd}`)
}).pipe(
  Effect.catchAll((cause) => {
    const command = parse(process.argv).cmd
    return print(false, command, { error: text(cause) }).pipe(
      Effect.zipRight(Effect.sync(() => {
        process.exitCode = 1
      })),
    )
  }),
)

run.pipe(
  Effect.provide(CoreLayer),
  Effect.scoped,
  BunRuntime.runMain,
)
