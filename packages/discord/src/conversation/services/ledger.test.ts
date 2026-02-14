import * as Client from "@effect/sql/SqlClient"
import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Option, Redacted } from "effect"
import { AppConfig } from "../../config"
import { SqliteDb } from "../../db/client"
import { initializeSchema } from "../../db/init"
import { effectTest, withTempSqliteFile } from "../../test/effect"
import { ChannelId, GuildId, SessionId, ThreadId } from "../../types"
import { Mention, ThreadMessage, type Inbound } from "../model/schema"
import { ConversationLedger } from "./ledger"

const makeConfig = (databasePath: string) =>
  AppConfig.of({
    discordToken: Redacted.make("token"),
    allowedChannelIds: [],
    discordCategoryId: "",
    discordRoleId: "",
    discordRequiredRoleId: "",
    discordCommandGuildId: "",
    databasePath,
    daytonaApiKey: Redacted.make("daytona"),
    openCodeZenApiKey: Redacted.make("zen"),
    githubToken: "",
    logLevel: "info",
    healthHost: "127.0.0.1",
    healthPort: 8787,
    turnRoutingMode: "off",
    turnRoutingModel: "claude-haiku-4-5",
    sandboxReusePolicy: "resume_preferred",
    sandboxTimeout: Duration.minutes(30),
    cleanupInterval: Duration.minutes(5),
    staleActiveGraceMinutes: 5 as AppConfig.Service["staleActiveGraceMinutes"],
    pausedTtlMinutes: 180 as AppConfig.Service["pausedTtlMinutes"],
    activeHealthCheckTimeoutMs: 15000 as AppConfig.Service["activeHealthCheckTimeoutMs"],
    startupHealthTimeoutMs: 120000 as AppConfig.Service["startupHealthTimeoutMs"],
    resumeHealthTimeoutMs: 120000 as AppConfig.Service["resumeHealthTimeoutMs"],
    sandboxCreationTimeout: 180 as AppConfig.Service["sandboxCreationTimeout"],
    openCodeModel: "opencode/claude-sonnet-4-5",
  })

const event = (message_id: string, content: string): Inbound =>
  ThreadMessage.make({
    kind: "thread_message",
    thread_id: ThreadId.make("t1"),
    channel_id: ChannelId.make("c1"),
    message_id,
    guild_id: GuildId.make("g1"),
    bot_user_id: "bot-1",
    bot_role_id: "role-1",
    author_id: "u1",
    author_is_bot: false,
    mentions_everyone: false,
    mentions: Mention.make({ user_ids: ["bot-1"], role_ids: [] }),
    content,
  })

const withLedger = <A, E, R>(
  run: (ledger: ConversationLedger.Service, sql: Client.SqlClient) => Effect.Effect<A, E, R>,
) =>
  withTempSqliteFile((databasePath) =>
    Effect.gen(function* () {
      const config = Layer.succeed(AppConfig, makeConfig(databasePath))
      const sqlite = SqliteDb.layer.pipe(Layer.provide(config))
      const deps = Layer.merge(sqlite, config)
      const live = Layer.merge(
        ConversationLedger.layer.pipe(Layer.provide(deps)),
        sqlite,
      )
      const program = Effect.all([ConversationLedger, SqliteDb]).pipe(
        Effect.flatMap(([ledger, sql]) =>
          initializeSchema.pipe(
            Effect.provideService(Client.SqlClient, sql),
            Effect.zipRight(run(ledger, sql)),
          )),
      )
      return yield* program.pipe(Effect.provide(live))
    }),
    "discord-ledger-",
  )

describe("ConversationLedger", () => {
  effectTest("deduplicates by message id and tracks completion", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const m = event("m1", "hello")
        expect(yield* ledger.admit(m)).toBe(true)
        expect(yield* ledger.admit(m)).toBe(false)

        const started = yield* ledger.start(m.message_id)
        expect(Option.isSome(started)).toBe(true)
        if (Option.isNone(started)) return

        yield* ledger.setTarget(m.message_id, ThreadId.make("t1"), ChannelId.make("c1"))
        yield* ledger.setPrompt(m.message_id, "prompt:hello", SessionId.make("s1"))
        yield* ledger.setResponse(m.message_id, "reply:hello")
        yield* ledger.complete(m.message_id)

        const next = yield* ledger.start(m.message_id)
        expect(Option.isNone(next)).toBe(true)
      }),
    ),
  )

  effectTest("replays pending rows and recovers processing rows", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const a = event("m-a", "one")
        const b = event("m-b", "two")
        yield* ledger.admit(a)
        yield* ledger.admit(b)

        const started = yield* ledger.start(a.message_id)
        expect(Option.isSome(started)).toBe(true)

        const replay = yield* ledger.replayPending()
        expect(replay.map((x) => x.message_id)).toEqual(["m-a", "m-b"])

        const again = yield* ledger.start(a.message_id)
        expect(Option.isSome(again)).toBe(true)
      }),
    ),
  )

  effectTest("retains cached response across retry and prunes old completed rows", () =>
    withLedger((ledger, sql) =>
      Effect.gen(function* () {
        const m = event("m-cache", "cache")
        yield* ledger.admit(m)
        yield* ledger.start(m.message_id)
        yield* ledger.setTarget(m.message_id, ThreadId.make("t1"), ChannelId.make("c1"))
        yield* ledger.setPrompt(m.message_id, "prompt:cache", SessionId.make("s1"))
        yield* ledger.setResponse(m.message_id, "reply:cache")
        yield* ledger.retry(m.message_id, "send failed")

        const resumed = yield* ledger.start(m.message_id)
        expect(Option.isSome(resumed)).toBe(true)
        if (Option.isSome(resumed)) {
          expect(resumed.value.response_text).toBe("reply:cache")
          expect(resumed.value.thread_id).toBe(ThreadId.make("t1"))
          expect(resumed.value.channel_id).toBe(ChannelId.make("c1"))
        }

        yield* ledger.complete(m.message_id)
        yield* sql`UPDATE conversation_inbox
            SET completed_at = datetime('now', '-10 minutes')
            WHERE message_id = ${m.message_id}`
        yield* ledger.prune()

        const rows = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM conversation_inbox WHERE message_id = ${m.message_id}`
        expect(rows[0]?.n ?? 0).toBe(0)
      }),
    ),
  )

  effectTest("stores and updates source offsets", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        expect(Option.isNone(yield* ledger.getOffset("thread:t1"))).toBe(true)
        yield* ledger.setOffset("thread:t1", "m1")
        expect(yield* ledger.getOffset("thread:t1")).toEqual(Option.some("m1"))
        yield* ledger.setOffset("thread:t1", "m9")
        expect(yield* ledger.getOffset("thread:t1")).toEqual(Option.some("m9"))
      }),
    ),
  )
})
