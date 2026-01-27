import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Database } from "@/storage/db"

export const ProjectTable = sqliteTable("project", {
  id: text().primaryKey(),
  worktree: text().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_color: text(),
  ...Database.Timestamps,
  time_initialized: integer(),
  sandboxes: text({ mode: "json" }).notNull().$type<string[]>(),
})
