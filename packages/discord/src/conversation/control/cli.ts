import { stdin, stdout } from "node:process"
import readline from "node:readline/promises"
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { FetchHttpClient } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer, LogLevel, Logger, Option, Stream } from "effect"
import { AppConfig } from "../../config"
import { TurnRouter } from "../../discord/turn-routing"
import { SqliteDb } from "../../db/client"
import { DaytonaService } from "../../sandbox/daytona"
import { OpenCodeClient } from "../../sandbox/opencode-client"
import { ThreadAgentPool } from "../../sandbox/pool"
import { SandboxProvisioner } from "../../sandbox/provisioner"
import { SessionStore } from "../../sessions/store"
import { PreviewAccess, ThreadId } from "../../types"
import type { Action } from "../model/schema"
import { makeTui } from "../implementations/local"
import { Conversation } from "../services/conversation"
import { ConversationLedger } from "../services/ledger"
import { autoThread, base, channelFrom, parse, prompt, scopeText, threadFrom } from "./state"

const AnthropicLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return AnthropicLanguageModel.layer({ model: config.turnRoutingModel }).pipe(
      Layer.provide(AnthropicClient.layer({
        apiKey: config.openCodeZenApiKey,
        apiUrl: "https://opencode.ai/zen",
      })),
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)

const BaseLayer = Layer.mergeAll(
  AppConfig.layer,
  FetchHttpClient.layer,
  BunContext.layer,
  Logger.minimumLogLevel(LogLevel.Warning),
)
const WithSqlite = Layer.provideMerge(SqliteDb.layer, BaseLayer)
const WithAnthropic = Layer.provideMerge(AnthropicLayer, WithSqlite)
const WithDaytona = Layer.provideMerge(DaytonaService.layer, WithAnthropic)
const WithOpenCode = Layer.provideMerge(OpenCodeClient.layer, WithDaytona)
const WithRouting = Layer.provideMerge(TurnRouter.layer, WithOpenCode)
const WithSessions = Layer.provideMerge(SessionStore.layer, WithRouting)
const WithProvisioner = Layer.provideMerge(SandboxProvisioner.layer, WithSessions)
const CoreLayer = Layer.provideMerge(ThreadAgentPool.layer, WithProvisioner)

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
} as const

const now = () => new Date().toLocaleTimeString("en-US", { hour12: false })

const run = Effect.gen(function* () {
  const tui = yield* makeTui
  const layer = Conversation.layer.pipe(
    Layer.provideMerge(tui.layer),
    Layer.provideMerge(ConversationLedger.noop),
    Layer.provideMerge(CoreLayer),
  )

    yield* Effect.gen(function* () {
      const conversation = yield* Conversation
      const config = yield* AppConfig
      const pool = yield* ThreadAgentPool
      const daytona = yield* DaytonaService
      const oc = yield* OpenCodeClient
    const sessions = yield* SessionStore
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true })
    const restart =
      'pkill -f \'opencode serve --port 4096\' >/dev/null 2>&1 || true; for d in "$HOME/opencode" "/home/daytona/opencode" "/root/opencode"; do if [ -d "$d" ]; then cd "$d" && setsid opencode serve --port 4096 --hostname 0.0.0.0 > /tmp/opencode.log 2>&1 & exit 0; fi; done; exit 1'
    let scope = base()
    let pending = 0
    let last: ThreadId | null = null
    const seen = new Set<ThreadId>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        rl.close()
      }),
    )

    const draw = (line: string, keep = true): Effect.Effect<void> =>
      Effect.sync(() => {
        stdout.write(`\r\x1b[2K${line}\n`)
        if (keep) {
          stdout.write(`${prompt(scope)}${rl.line}`)
        }
      })

    const stamp = (label: string, color: string, text: string) =>
      `${colors.dim}${now()}${colors.reset} ${color}${label}${colors.reset} ${text}`

    const info = (text: string): Effect.Effect<void> => draw(stamp("info", colors.blue, text), false)

    const block = (head: string, body: string): Effect.Effect<void> =>
      Effect.sync(() => {
        stdout.write(`\r\x1b[2K${head}\n${body}\n`)
        stdout.write(`${prompt(scope)}${rl.line}`)
      })

    const noteThread = (thread_id: ThreadId): Effect.Effect<void> =>
      Effect.sync(() => {
        seen.add(thread_id)
        last = thread_id
      })

    const pick = (thread_id: ThreadId | null): ThreadId | null => {
      if (thread_id) return thread_id
      if (scope.kind === "thread") return scope.thread_id
      return last
    }
    const list = () => Array.from(seen)
    const byIndex = (index: number) => list().at(index - 1) ?? null
    const fromRef = (thread_id: ThreadId | null) => {
      if (!thread_id) return null
      const raw = `${thread_id}`.trim()
      if (!/^\d+$/.test(raw)) return thread_id
      const index = Number(raw)
      if (!Number.isInteger(index) || index <= 0) return null
      return byIndex(index)
    }

    const tracked = (thread_id: ThreadId) =>
      pool.getTrackedSession(thread_id).pipe(
        Effect.map((row) => Option.isSome(row) ? row.value : null),
        Effect.catchAll(() => Effect.succeed(null)),
      )

    const sessionText = (thread_id: ThreadId, session: {
      status: string
      sandboxId: string
      sessionId: string
      resumeFailCount: number
      lastError: string | null
    }) =>
      `${colors.dim}${thread_id}${colors.reset} status=${session.status} sandbox=${session.sandboxId} session=${session.sessionId} resume_failures=${session.resumeFailCount}${session.lastError ? ` error=${session.lastError.slice(0, 120)}` : ""}`

    const render = (action: Action) => {
      if (action.kind === "typing") {
        return stamp("typing", colors.yellow, `${colors.dim}[${action.thread_id}]${colors.reset}`)
      }
      return stamp("assistant", colors.cyan, `${colors.dim}[${action.thread_id}]${colors.reset} ${action.text}`)
    }

    yield* draw(
      stamp(
        "ready",
        colors.yellow,
        `${colors.dim}Type messages. /thread [id|n], /pick [n], /channel, /threads, /status, /logs, /restart, /pause, /destroy, /resume, /active, /help, /exit${colors.reset}`,
      ),
      false,
    )

    yield* Effect.forkScoped(
      Stream.runForEach(
        tui.actions,
        (action) =>
          Effect.gen(function* () {
            const known = seen.has(action.thread_id)
            yield* noteThread(action.thread_id)
            const next = autoThread(scope, action, known)
            const switched = scope.kind === "channel" && next.kind === "thread"
            scope = next
            if (switched) {
              yield* info(`${colors.dim}using ${scopeText(scope)} (/channel to go back)${colors.reset}`)
            }
            if ((action.kind === "send" || action.kind === "reply") && pending > 0) {
              pending -= 1
            }
            yield* draw(render(action))
          }),
      ),
    )

    yield* Effect.forkScoped(conversation.run)

    const queue = (text: string) =>
      Effect.gen(function* () {
        const target = scopeText(scope)
        if (scope.kind === "channel") {
          yield* tui.send(text)
        } else {
          yield* tui.sendTo(scope.thread_id, text)
        }
        pending += 1
        yield* draw(stamp("queued", colors.green, `${colors.dim}[${target}]${colors.reset} ${text}`), false)
        yield* Effect.fork(
          Effect.suspend(() =>
            pending > 0
              ? draw(stamp("waiting", colors.yellow, `${colors.dim}[${target}] preparing sandbox/session...${colors.reset}`), false)
              : Effect.void,
          ).pipe(
            Effect.delay("2 seconds"),
          ),
        )
      })

    const command = (text: string) =>
      Effect.gen(function* () {
        const cmd = parse(text)
        if (!cmd) return false

        if (cmd.kind === "help") {
          yield* info(
            `${colors.dim}/thread [id|n], /pick [n], /channel, /threads, /status [thread], /logs [lines] [thread], /restart [thread], /pause [thread], /destroy [thread], /resume [thread], /active, /exit${colors.reset}`,
          )
          return true
        }

        if (cmd.kind === "threads") {
          if (seen.size === 0) {
            yield* info(`${colors.dim}no known threads yet${colors.reset}`)
            return true
          }
          yield* info(`${colors.dim}${list().map((id, i) => `${i + 1}:${id}`).join(", ")}${colors.reset}`)
          return true
        }

        if (cmd.kind === "pick") {
          if (seen.size === 0) {
            yield* info(`${colors.dim}no known threads yet${colors.reset}`)
            return true
          }
          if (!cmd.index) {
            yield* info(`${colors.dim}${list().map((id, i) => `${i + 1}:${id}`).join(", ")}${colors.reset}`)
            yield* info(`${colors.dim}pick one with /pick <n>${colors.reset}`)
            return true
          }
          const thread_id = byIndex(cmd.index)
          if (!thread_id) {
            yield* info(`${colors.dim}invalid thread index ${cmd.index}${colors.reset}`)
            return true
          }
          scope = threadFrom(scope, thread_id)
          yield* info(`${colors.dim}using ${scopeText(scope)}${colors.reset}`)
          return true
        }

        if (cmd.kind === "active") {
          yield* sessions.listActive().pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                info(`${colors.red}active query failed${colors.reset} ${String(error)}`),
              onSuccess: (active) =>
                active.length === 0
                  ? info(`${colors.dim}no active sessions${colors.reset}`)
                  : info(`${colors.dim}${active.map((s) => `${s.threadId}(${s.status})`).join(", ")}${colors.reset}`),
            }),
          )
          return true
        }

        if (cmd.kind === "channel") {
          scope = channelFrom(scope)
          yield* info(`${colors.dim}using ${scopeText(scope)}${colors.reset}`)
          return true
        }

        if (cmd.kind === "thread") {
          const selected = fromRef(cmd.thread_id)
          if (selected) {
            scope = threadFrom(scope, selected)
            yield* noteThread(selected)
            yield* info(`${colors.dim}using ${scopeText(scope)}${colors.reset}`)
            return true
          }
          if (cmd.thread_id) {
            yield* info(`${colors.dim}invalid thread id/index${colors.reset}`)
            return true
          }
          if (last) {
            scope = threadFrom(scope, last)
            yield* info(`${colors.dim}using ${scopeText(scope)}${colors.reset}`)
            return true
          }
          yield* info(`${colors.dim}no thread id yet. use /thread <id>${colors.reset}`)
          return true
        }

        if (cmd.kind === "status") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          const session = yield* tracked(thread_id)
          if (!session) {
            yield* info(`${colors.dim}no tracked session for ${thread_id}${colors.reset}`)
            return true
          }
          yield* info(sessionText(thread_id, session))
          return true
        }

        if (cmd.kind === "logs") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          const session = yield* tracked(thread_id)
          if (!session) {
            yield* info(`${colors.dim}no tracked session for ${thread_id}${colors.reset}`)
            return true
          }
          yield* daytona.exec(
            session.sandboxId,
            "read-opencode-log",
            `cat /tmp/opencode.log 2>/dev/null | tail -${cmd.lines}`,
          ).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                info(`${colors.red}log read failed${colors.reset} ${String(error)}`),
              onSuccess: (result) =>
                block(
                  stamp("logs", colors.blue, `${colors.dim}[${thread_id}]${colors.reset}`),
                  result.output.trim() || "(empty log)",
                ),
            }),
          )
          return true
        }

        if (cmd.kind === "pause") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          yield* pool.pauseSession(thread_id, "manual-cli").pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                info(`${colors.red}pause failed${colors.reset} ${String(error)}`),
              onSuccess: () =>
                info(`${colors.dim}paused ${thread_id}${colors.reset}`),
            }),
          )
          return true
        }

        if (cmd.kind === "destroy") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          yield* pool.destroySession(thread_id).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                info(`${colors.red}destroy failed${colors.reset} ${String(error)}`),
              onSuccess: () =>
                info(`${colors.dim}destroyed ${thread_id}${colors.reset}`),
            }),
          )
          return true
        }

        if (cmd.kind === "resume") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          const session = yield* tracked(thread_id)
          if (!session) {
            yield* info(`${colors.dim}no tracked session for ${thread_id}${colors.reset}`)
            return true
          }
          yield* pool.getOrCreate(thread_id, session.channelId, session.guildId).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                info(`${colors.red}resume failed${colors.reset} ${String(error)}`),
              onSuccess: (agent) =>
                agent.current().pipe(
                  Effect.flatMap((current) =>
                    info(
                      `${colors.dim}resumed ${thread_id} sandbox=${current.sandboxId} session=${current.sessionId}${colors.reset}`,
                    ),
                  ),
                  Effect.catchAll((error) =>
                    info(`${colors.red}resume failed${colors.reset} ${String(error)}`),
                  ),
                ),
            }),
          )
          return true
        }

        if (cmd.kind === "restart") {
          const thread_id = pick(cmd.thread_id)
          if (!thread_id) {
            yield* info(`${colors.dim}no thread selected. use /thread <id>${colors.reset}`)
            return true
          }
          yield* noteThread(thread_id)
          const session = yield* tracked(thread_id)
          if (!session) {
            yield* info(`${colors.dim}no tracked session for ${thread_id}${colors.reset}`)
            return true
          }
          const restarted = yield* daytona.exec(session.sandboxId, "restart-opencode-serve", restart).pipe(
            Effect.as(true),
            Effect.catchAll((error) =>
              info(`${colors.red}restart failed${colors.reset} ${String(error)}`).pipe(Effect.as(false)),
            ),
          )
          if (!restarted) return true
          const healthy = yield* oc.waitForHealthy(PreviewAccess.from(session), config.activeHealthCheckTimeoutMs).pipe(
            Effect.catchAll(() => Effect.succeed(false)),
          )
          if (!healthy) {
            yield* info(`${colors.red}restart ran, but health check failed${colors.reset}`)
            return true
          }
          yield* info(`${colors.dim}restart complete and healthy${colors.reset}`)
          return true
        }

        yield* info(`${colors.dim}unknown command: /${cmd.name}${colors.reset}`)
        return true
      })

    const loop: Effect.Effect<void> = Effect.gen(function* () {
      const text = (yield* Effect.promise(() => rl.question(prompt(scope)))).trim()
      if (!text) return yield* loop
      if (text === "/exit" || text === "exit" || text === "quit") return
      const handled = yield* command(text)
      if (handled) return yield* loop
      yield* queue(text)
      return yield* loop
    })

    yield* loop
  }).pipe(
    Effect.provide(layer),
    Effect.scoped,
  )
})

run.pipe(
  Logger.withMinimumLogLevel(LogLevel.Warning),
  BunRuntime.runMain,
)
