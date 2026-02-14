# Discord Bot Package

Discord bot that provisions Daytona sandboxes running OpenCode sessions in threads.

## Architecture

Bun + TypeScript (ESM, strict mode) with Effect for all business logic. SQLite persistence via `@effect/sql`.

- `src/index.ts` — startup, layer composition, graceful shutdown
- `src/config.ts` — env schema (Effect Schema + branded types)
- `src/conversation/` — pure conversation service (Inbox/Outbox ports, turn logic, ConversationLedger for dedup/replay)
- `src/discord/` — Discord.js adapter (message handler, turn routing, formatting)
- `src/sandbox/` — sandbox lifecycle (SandboxProvisioner, OpenCode client, ThreadAgentPool)
- `src/sessions/store.ts` — SQLite-backed session store
- `src/lib/actors/` — ActorMap (per-key serialized execution with idle timeouts)
- `src/db/` — database client, schema init, migrations
- `src/http/health.ts` — health/readiness HTTP server
- `src/types.ts` — shared branded types and data classes

## Effect Conventions

- Services use `Context.Tag("@discord/<Name>")`
- Errors use `Schema.TaggedError` with `Schema.Defect` for defect-like causes
- Use `Effect.gen(function*() { ... })` for composition
- Use `Effect.fn("ServiceName.method")` for named/traced effects
- Layer composition: `Layer.mergeAll`, `Layer.provide`, `Layer.provideMerge`
- Use `Schema.Class` for data types with multiple fields
- Use branded schemas (`Schema.brand`) for single-value IDs
- Construct branded values and Schema.Class instances with `.make()`
- Module pattern for utilities: namespace for types, const for implementation (e.g. `ActorMap.make()`, `ActorMap.ActorMap<K>`)

## Type Safety

- **No `any`** — use `unknown` at untrusted boundaries, narrow with Schema decoding
- **No `as` casts** — prefer Schema decode, type guards, or restructuring
- **Non-null assertions (`!`) are banned** — use Option, optional chaining, or early returns
- **Use `Option<T>` instead of `T | null`** — Effect's Option type for absent values from stores/lookups
- **Branded types everywhere** — `ThreadId`, `ChannelId`, `GuildId`, `SandboxId`, `SessionId` from `src/types.ts`
- **Accept branded types in function signatures** — don't accept `string` and `.make()` inside; push branding to the boundary
- `as const` is fine (const assertion, not a cast)

## Branded Types

All branded ID schemas live in `src/types.ts`:
- `ThreadId`, `ChannelId`, `GuildId` — Discord identifiers
- `SandboxId` — Daytona sandbox identifier
- `SessionId` — OpenCode session identifier

Brand at the system boundary (Discord event parsing, schema classes), then pass branded types through all internal code.

## Testing

- `bun test` — run all tests
- `bun test path/to/file.test.ts` — single file
- Test helpers in `src/test/effect.ts`
- Colocate tests as `*.test.ts` next to implementation

## Build & Check

- `bun run typecheck` — type checking
- `bun run build` — production build
- `bun run check` — combined

## Local Debug CLIs

- `bun run conversation:cli` — interactive local conversation shell
  - `/channel` to return to channel mode
  - `/threads` to list known threads with indexes
  - `/pick [n]` to select a thread by index
  - `/thread [id|n]` to jump to a thread by id or index
  - channel auto-switch only follows newly seen threads (prevents jumping to old active threads)

- `bun run conversation:ctl` — non-interactive JSON CLI for agents/automation
  - `active`
  - `status --thread <id>`
  - `logs --thread <id> [--lines 120]`
  - `pause --thread <id>`
  - `destroy --thread <id>`
  - `resume --thread <id> [--channel <id> --guild <id>]`
  - `restart --thread <id>`
  - `send --thread <id> --text "<message>" [--follow --wait-ms 180000 --logs-every-ms 2000 --lines 80]`

## Session Lifecycle

- Session mapping (`threadId` -> `sandboxId` -> `sessionId`) is authoritative
- Resume existing sandbox/session before creating replacements
- Recreate only when sandbox is truly unavailable/destroyed
- If session changes, replay Discord thread history as context
