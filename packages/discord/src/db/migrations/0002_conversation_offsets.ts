import * as Client from "@effect/sql/SqlClient"
import { Effect } from "effect"

const TABLE = `CREATE TABLE IF NOT EXISTS conversation_offsets (
  source_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`

const COLUMNS = [
  ["last_message_id", "TEXT NOT NULL"],
  ["updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"],
] as const

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS conversation_offsets_updated_at_idx
    ON conversation_offsets (updated_at)`,
] as const

export default Effect.gen(function* () {
  const db = yield* Client.SqlClient
  yield* db.unsafe(TABLE)

  const names = new Set((yield* db<{ name: string }>`PRAGMA table_info(conversation_offsets)`).map((row) => row.name))
  const missing = COLUMNS.filter(([name]) => !names.has(name))
  yield* Effect.forEach(missing, ([name, definition]) => db.unsafe(`ALTER TABLE conversation_offsets ADD COLUMN ${name} ${definition}`), {
    discard: true,
  })

  yield* Effect.forEach(INDEXES, (index) => db.unsafe(index), { discard: true })
})
