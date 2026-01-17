import { Database as SqliteDatabase } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { migrations } from "./migrations.generated"
import { migrateFromJson } from "./json-migration"
import { NamedError } from "@opencode-ai/util/error"
import { Context } from "../util/context"
import z from "zod"
import path from "path"

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export type DB = BunSQLiteDatabase

  const connection = lazy(() => {
    const dbPath = path.join(Global.Path.data, "opencode.db")
    log.info("opening database", { path: dbPath })

    const sqlite = new SqliteDatabase(dbPath, { create: true })

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")

    migrate(sqlite)

    // Run JSON migration after schema is ready
    try {
      migrateFromJson(sqlite)
    } catch (e) {
      log.error("json migration failed", { error: e })
    }

    return drizzle(sqlite)
  })

  function migrate(sqlite: SqliteDatabase) {
    sqlite.run(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)

    const applied = new Set(
      sqlite
        .query<{ name: string }, []>("SELECT name FROM _migrations")
        .all()
        .map((r) => r.name),
    )

    for (const migration of migrations) {
      if (applied.has(migration.name)) continue
      log.info("applying migration", { name: migration.name })
      sqlite.exec(migration.sql)
      sqlite.run("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [migration.name, Date.now()])
    }
  }

  const TransactionContext = Context.create<{
    db: DB
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (db: DB) => T): T {
    try {
      const ctx = TransactionContext.use()
      return callback(ctx.db)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = TransactionContext.provide({ db: connection(), effects }, () => callback(connection()))
        for (const fx of effects) fx()
        return result
      }
      throw err
    }
  }

  export function fn<Input, T>(callback: (input: Input, db: DB) => T) {
    return (input: Input) => use((db) => callback(input, db))
  }

  export function effect(fx: () => void | Promise<void>) {
    try {
      const ctx = TransactionContext.use()
      ctx.effects.push(fx)
    } catch {
      fx()
    }
  }

  export function transaction<T>(callback: (db: DB) => T): T {
    try {
      const ctx = TransactionContext.use()
      return callback(ctx.db)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = connection().transaction((tx) => {
          return TransactionContext.provide({ db: tx as unknown as DB, effects }, () => callback(tx as unknown as DB))
        })
        for (const fx of effects) fx()
        return result
      }
      throw err
    }
  }
}
