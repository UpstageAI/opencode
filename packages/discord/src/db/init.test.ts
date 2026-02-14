import * as Client from "@effect/sql/SqlClient"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { initializeSchema } from "./init"
import { effectTest, withSqlite, withTempSqliteFile } from "../test/effect"

const columns = [
  "thread_id",
  "channel_id",
  "guild_id",
  "sandbox_id",
  "session_id",
  "preview_url",
  "preview_token",
  "status",
  "last_activity",
  "pause_requested_at",
  "paused_at",
  "resume_attempted_at",
  "resumed_at",
  "destroyed_at",
  "last_health_ok_at",
  "last_error",
  "resume_fail_count",
  "created_at",
  "updated_at",
]

const indexes = [
  "discord_sessions_status_last_activity_idx",
  "discord_sessions_status_updated_at_idx",
]

const inboxColumns = [
  "message_id",
  "kind",
  "payload_json",
  "status",
  "thread_id",
  "channel_id",
  "prompt_text",
  "session_id",
  "response_text",
  "attempts",
  "processing_started_at",
  "completed_at",
  "last_error",
  "created_at",
  "updated_at",
]

const inboxIndexes = [
  "conversation_inbox_status_created_at_idx",
  "conversation_inbox_completed_at_idx",
]

const offsetColumns = [
  "source_id",
  "last_message_id",
  "updated_at",
]

const offsetIndexes = [
  "conversation_offsets_updated_at_idx",
]

const getColumns = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA table_info(discord_sessions)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

const getInboxColumns = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA table_info(conversation_inbox)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

const getIndexes = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA index_list(discord_sessions)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

const getInboxIndexes = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA index_list(conversation_inbox)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

const getOffsetColumns = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA table_info(conversation_offsets)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

const getOffsetIndexes = (db: Client.SqlClient) =>
  db<{ name: string }>`PRAGMA index_list(conversation_offsets)`.pipe(
    Effect.map((rows) => rows.map((row: { name: string }) => row.name)),
  )

describe("initializeSchema", () => {
  effectTest("creates schema and is idempotent", () =>
    withTempSqliteFile((filename) =>
      Effect.gen(function* () {
        yield* withSqlite(filename, (db) => initializeSchema.pipe(Effect.provideService(Client.SqlClient, db)))
        const one = yield* withSqlite(filename, getColumns)
        const inboxOne = yield* withSqlite(filename, getInboxColumns)
        const offsetOne = yield* withSqlite(filename, getOffsetColumns)
        expect(one).toEqual(columns)
        expect(inboxOne).toEqual(inboxColumns)
        expect(offsetOne).toEqual(offsetColumns)

        yield* withSqlite(filename, (db) => initializeSchema.pipe(Effect.provideService(Client.SqlClient, db)))
        const two = yield* withSqlite(filename, getColumns)
        const inboxTwo = yield* withSqlite(filename, getInboxColumns)
        const offsetTwo = yield* withSqlite(filename, getOffsetColumns)
        expect(two).toEqual(one)
        expect(inboxTwo).toEqual(inboxOne)
        expect(offsetTwo).toEqual(offsetOne)

        const seen = new Set(two)
        expect(seen.size).toBe(two.length)
        const actual = (yield* withSqlite(filename, getIndexes)).filter((name) => !name.startsWith("sqlite_"))
        const inboxActual = (yield* withSqlite(filename, getInboxIndexes)).filter((name) => !name.startsWith("sqlite_"))
        const offsetActual = (yield* withSqlite(filename, getOffsetIndexes)).filter((name) => !name.startsWith("sqlite_"))
        expect(new Set(actual)).toEqual(new Set(indexes))
        expect(new Set(inboxActual)).toEqual(new Set(inboxIndexes))
        expect(new Set(offsetActual)).toEqual(new Set(offsetIndexes))
      }),
      "discord-sessions-",
    ),
  )
})
