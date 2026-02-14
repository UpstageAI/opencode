import { SqliteClient } from "@effect/sql-sqlite-bun"
import * as Client from "@effect/sql/SqlClient"
import { Context, Effect, Layer } from "effect"
import { AppConfig } from "../config"

export class SqliteDb extends Context.Tag("@discord/SqliteDb")<SqliteDb, Client.SqlClient>() {
  static readonly layer = Layer.effect(
    SqliteDb,
    Effect.gen(function* () {
      const db = yield* Client.SqlClient
      yield* db`PRAGMA busy_timeout = 5000`
      return db
    }),
  ).pipe(
    Layer.provide(
      Layer.unwrapEffect(
        Effect.map(AppConfig, (config) => SqliteClient.layer({ filename: config.databasePath })),
      ),
    ),
    Layer.orDie,
  )
}
