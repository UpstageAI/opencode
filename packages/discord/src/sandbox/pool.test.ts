import { describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { OpenCodeClientError } from "../errors"
import { SessionStore } from "../sessions/store"
import { effectTest, testConfigLayer } from "../test/effect"
import { ChannelId, GuildId, SandboxId, SessionId, SessionInfo, ThreadId } from "../types"
import { OpenCodeClient } from "./opencode-client"
import { ResumeFailed, SandboxProvisioner } from "./provisioner"
import { ThreadAgentPool } from "./pool"

const threadId = ThreadId.make("t1")
const channelId = ChannelId.make("c1")
const guildId = GuildId.make("g1")

const session = SessionInfo.make({
  threadId,
  channelId,
  guildId,
  sandboxId: SandboxId.make("sb1"),
  sessionId: SessionId.make("s1"),
  previewUrl: "https://preview.example",
  previewToken: null,
  status: "active",
  lastError: null,
  resumeFailCount: 0,
})

const store = () => {
  let row = Option.some(session)
  return SessionStore.of({
    upsert: (next) =>
      Effect.sync(() => {
        row = Option.some(next)
      }),
    getByThread: () => Effect.succeed(row),
    hasTrackedThread: () => Effect.succeed(Option.isSome(row)),
    getActive: () =>
      Option.isSome(row) && row.value.status === "active"
        ? Effect.succeed(row)
        : Effect.succeed(Option.none()),
    markActivity: () => Effect.void,
    markHealthOk: () => Effect.void,
    updateStatus: (_threadId, status) =>
      Effect.sync(() => {
        if (Option.isNone(row)) return
        row = Option.some(row.value.withStatus(status))
      }),
    incrementResumeFailure: () => Effect.void,
    listActive: () =>
      Option.isSome(row) && row.value.status === "active"
        ? Effect.succeed([row.value] as const)
        : Effect.succeed([] as const),
    listTrackedThreads: () =>
      Option.isSome(row) && row.value.status !== "destroyed"
        ? Effect.succeed([row.value.threadId] as const)
        : Effect.succeed([] as const),
    listStaleActive: () => Effect.succeed([] as const),
    listExpiredPaused: () => Effect.succeed([] as const),
  })
}

const provisioner = SandboxProvisioner.of({
  provision: () => Effect.succeed(session),
  resume: () => Effect.succeed(ResumeFailed.make({ allowRecreate: true })),
  ensureActive: ({ current }) => Effect.succeed(Option.isSome(current) ? current.value : session),
  ensureHealthy: () => Effect.succeed(true),
  recoverSendFailure: (_threadId, next) => Effect.succeed(next.withStatus("paused")),
  pause: (_threadId, next) => Effect.succeed(next.withStatus("paused")),
  destroy: (_threadId, next) => Effect.succeed(next.withStatus("destroyed")),
})

const client = (statusCode: number, body: string) =>
  OpenCodeClient.of({
    waitForHealthy: () => Effect.succeed(true),
    createSession: () => Effect.succeed(SessionId.make("s2")),
    sessionExists: () => Effect.succeed(true),
    listSessions: () => Effect.succeed([]),
    sendPrompt: () => Effect.fail(new OpenCodeClientError({ operation: "sendPrompt", statusCode, body })),
    abortSession: () => Effect.void,
  })

const withPool = <A, E, R>(
  statusCode: number,
  body: string,
  run: Effect.Effect<A, E, R>,
) => {
  const deps = Layer.mergeAll(
    testConfigLayer,
    Layer.succeed(SessionStore, store()),
    Layer.succeed(SandboxProvisioner, provisioner),
    Layer.succeed(OpenCodeClient, client(statusCode, body)),
  )
  return run.pipe(
    Effect.provide(ThreadAgentPool.layer.pipe(Layer.provide(deps))),
  )
}

describe("ThreadAgentPool", () => {
  effectTest("maps recoverable send failures to SandboxDeadError", () =>
    withPool(
      502,
      "bad gateway",
      Effect.gen(function* () {
        const pool = yield* ThreadAgentPool
        const agent = yield* pool.getOrCreate(threadId, channelId, guildId)
        const error = yield* agent.send("hello").pipe(Effect.flip)
        expect(error._tag).toBe("SandboxDeadError")
      }),
    ),
  )

  effectTest("keeps non-recoverable send failures as OpenCodeClientError", () =>
    withPool(
      400,
      "bad request",
      Effect.gen(function* () {
        const pool = yield* ThreadAgentPool
        const agent = yield* pool.getOrCreate(threadId, channelId, guildId)
        const error = yield* agent.send("hello").pipe(Effect.flip)
        expect(error._tag).toBe("OpenCodeClientError")
      }),
    ),
  )
})
