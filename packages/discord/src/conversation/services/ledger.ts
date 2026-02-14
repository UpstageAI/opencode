import * as Client from "@effect/sql/SqlClient"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import { AppConfig } from "../../config"
import { SqliteDb } from "../../db/client"
import { initializeSchema } from "../../db/init"
import { DatabaseError } from "../../errors"
import { ChannelId, SessionId, ThreadId } from "../../types"
import { Inbound } from "../model/schema"

const DEDUP_TTL_MINUTES = 5
const PRUNE_BATCH_SIZE = 500

type Snapshot = {
  thread_id: ThreadId | null
  channel_id: ChannelId | null
  response_text: string | null
  prompt_text: string | null
  session_id: SessionId | null
}

export class MessageState extends Schema.Class<MessageState>("MessageState")({
  thread_id: Schema.NullOr(ThreadId),
  channel_id: Schema.NullOr(ChannelId),
  response_text: Schema.NullOr(Schema.String),
  prompt_text: Schema.NullOr(Schema.String),
  session_id: Schema.NullOr(SessionId),
}) {}

const InboundJson = Schema.parseJson(Inbound)
const decode = Schema.decodeUnknown(InboundJson)
const encode = Schema.encode(InboundJson)

const db = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError((cause) => new DatabaseError({ cause })))

const changes = (sql: Client.SqlClient) =>
  db(
    sql<{ n: number }>`SELECT changes() AS n`.pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
    ),
  )

const toState = (row: Snapshot) =>
  MessageState.make({
    thread_id: row.thread_id,
    channel_id: row.channel_id,
    response_text: row.response_text,
    prompt_text: row.prompt_text,
    session_id: row.session_id,
  })

export declare namespace ConversationLedger {
  export interface Service {
    readonly admit: (event: Inbound) => Effect.Effect<boolean, DatabaseError>
    readonly replayPending: () => Effect.Effect<ReadonlyArray<Inbound>, DatabaseError>
    readonly start: (message_id: string) => Effect.Effect<Option.Option<MessageState>, DatabaseError>
    readonly setTarget: (message_id: string, thread_id: ThreadId, channel_id: ChannelId) => Effect.Effect<void, DatabaseError>
    readonly setPrompt: (message_id: string, prompt: string, session_id: SessionId) => Effect.Effect<void, DatabaseError>
    readonly setResponse: (message_id: string, response: string) => Effect.Effect<void, DatabaseError>
    readonly complete: (message_id: string) => Effect.Effect<void, DatabaseError>
    readonly retry: (message_id: string, error: string) => Effect.Effect<void, DatabaseError>
    readonly prune: () => Effect.Effect<void, DatabaseError>
    readonly getOffset: (source_id: string) => Effect.Effect<Option.Option<string>, DatabaseError>
    readonly setOffset: (source_id: string, message_id: string) => Effect.Effect<void, DatabaseError>
  }
}

export class ConversationLedger extends Context.Tag("@discord/conversation/ConversationLedger")<
  ConversationLedger,
  ConversationLedger.Service
>() {
  static readonly noop = Layer.effect(
    ConversationLedger,
    Effect.sync(() => {
      const pending = new Set<string>()
      const completed = new Set<string>()
      return ConversationLedger.of({
        admit: (event) =>
          Effect.sync(() => {
            if (pending.has(event.message_id) || completed.has(event.message_id)) return false
            pending.add(event.message_id)
            return true
          }),
        replayPending: () => Effect.succeed([]),
        start: (message_id) =>
          Effect.sync(() => {
            if (!pending.has(message_id)) return Option.none()
            pending.delete(message_id)
            return Option.some(MessageState.make({
              thread_id: null,
              channel_id: null,
              response_text: null,
              prompt_text: null,
              session_id: null,
            }))
          }),
        setTarget: () => Effect.void,
        setPrompt: () => Effect.void,
        setResponse: () => Effect.void,
        complete: (message_id) => Effect.sync(() => { completed.add(message_id) }),
        retry: (message_id) => Effect.sync(() => { pending.add(message_id) }),
        prune: () => Effect.void,
        getOffset: () => Effect.succeed(Option.none()),
        setOffset: () => Effect.void,
      })
    }),
  )

  static readonly layer = Layer.scoped(
    ConversationLedger,
    Effect.gen(function* () {
      const sql = yield* SqliteDb
      const config = yield* AppConfig
      yield* db(initializeSchema.pipe(Effect.provideService(Client.SqlClient, sql)))

      const admit = Effect.fn("ConversationLedger.admit")(function* (event: Inbound) {
        const payload = yield* encode(event).pipe(
          Effect.mapError((cause) => new DatabaseError({ cause })),
        )
        yield* db(
          sql`INSERT OR IGNORE INTO conversation_inbox (message_id, kind, payload_json, status, created_at, updated_at)
              VALUES (${event.message_id}, ${event.kind}, ${payload}, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        return (yield* changes(sql)) > 0
      })

      const replayPending = Effect.fn("ConversationLedger.replayPending")(function* () {
        yield* db(
          sql`UPDATE conversation_inbox
              SET status = 'pending', updated_at = CURRENT_TIMESTAMP
              WHERE status = 'processing'`,
        )
        const rows = yield* db(
          sql<{ payload_json: string }>`SELECT payload_json
              FROM conversation_inbox
              WHERE status = 'pending'
              ORDER BY created_at ASC`,
        )
        return yield* Effect.forEach(rows, (row) =>
          decode(row.payload_json).pipe(Effect.mapError((cause) => new DatabaseError({ cause }))),
        )
      })

      const start = Effect.fn("ConversationLedger.start")(function* (message_id: string) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET status = 'processing', attempts = attempts + 1,
                  processing_started_at = CURRENT_TIMESTAMP,
                  updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id} AND status = 'pending'`,
        )
        if ((yield* changes(sql)) === 0) return Option.none<MessageState>()
        const rows = yield* db(
          sql<Snapshot>`SELECT thread_id, channel_id, response_text, prompt_text, session_id
              FROM conversation_inbox
              WHERE message_id = ${message_id}
              LIMIT 1`,
        )
        const row = rows[0]
        if (!row) return Option.none<MessageState>()
        return Option.some(toState(row))
      })

      const setTarget = Effect.fn("ConversationLedger.setTarget")(function* (
        message_id: string,
        thread_id: ThreadId,
        channel_id: ChannelId,
      ) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET thread_id = ${thread_id}, channel_id = ${channel_id}, updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id}`,
        )
      })

      const setPrompt = Effect.fn("ConversationLedger.setPrompt")(function* (
        message_id: string,
        prompt: string,
        session_id: SessionId,
      ) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET prompt_text = ${prompt}, session_id = ${session_id}, updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id}`,
        )
      })

      const setResponse = Effect.fn("ConversationLedger.setResponse")(function* (message_id: string, response: string) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET response_text = ${response}, updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id}`,
        )
      })

      const complete = Effect.fn("ConversationLedger.complete")(function* (message_id: string) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                  processing_started_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id}`,
        )
      })

      const retry = Effect.fn("ConversationLedger.retry")(function* (message_id: string, error: string) {
        yield* db(
          sql`UPDATE conversation_inbox
              SET status = 'pending', last_error = ${error}, updated_at = CURRENT_TIMESTAMP
              WHERE message_id = ${message_id}`,
        )
      })

      const prune = Effect.fn("ConversationLedger.prune")(function* () {
        yield* db(
          sql`DELETE FROM conversation_inbox
              WHERE message_id IN (
                SELECT message_id
                FROM conversation_inbox
                WHERE status = 'completed'
                  AND completed_at IS NOT NULL
                  AND completed_at < datetime('now', '-' || ${DEDUP_TTL_MINUTES} || ' minutes')
                ORDER BY completed_at ASC
                LIMIT ${PRUNE_BATCH_SIZE}
              )`,
        )
      })

      const getOffset = Effect.fn("ConversationLedger.getOffset")(function* (source_id: string) {
        const rows = yield* db(
          sql<{ last_message_id: string }>`SELECT last_message_id
              FROM conversation_offsets
              WHERE source_id = ${source_id}
              LIMIT 1`,
        )
        const row = rows[0]
        if (!row) return Option.none<string>()
        return Option.some(row.last_message_id)
      })

      const setOffset = Effect.fn("ConversationLedger.setOffset")(function* (source_id: string, message_id: string) {
        yield* db(
          sql`INSERT INTO conversation_offsets (source_id, last_message_id, updated_at)
              VALUES (${source_id}, ${message_id}, CURRENT_TIMESTAMP)
              ON CONFLICT(source_id) DO UPDATE SET
                last_message_id = excluded.last_message_id,
                updated_at = CURRENT_TIMESTAMP`,
        )
      })

      yield* prune().pipe(
        Effect.catchAll((error) =>
          Effect.logError("Conversation ledger prune failed").pipe(
            Effect.annotateLogs({ event: "conversation.ledger.prune.failed", error: String(error) }),
          )),
        Effect.repeat(Schedule.spaced(config.cleanupInterval)),
        Effect.forkScoped,
      )

      return ConversationLedger.of({
        admit,
        replayPending,
        start,
        setTarget,
        setPrompt,
        setResponse,
        complete,
        retry,
        prune,
        getOffset,
        setOffset,
      })
    }),
  )
}
