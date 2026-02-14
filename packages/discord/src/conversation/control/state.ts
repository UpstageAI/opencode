import { ThreadId } from "../../types"
import type { Action } from "../model/schema"

const LOCAL_CHANNEL = "local-channel" as const

export type Scope =
  | { kind: "channel"; channel_id: typeof LOCAL_CHANNEL }
  | { kind: "thread"; thread_id: ThreadId; channel_id: typeof LOCAL_CHANNEL }

export type Command =
  | { kind: "channel" }
  | { kind: "help" }
  | { kind: "threads" }
  | { kind: "pick"; index: number | null }
  | { kind: "active" }
  | { kind: "thread"; thread_id: ThreadId | null }
  | { kind: "status"; thread_id: ThreadId | null }
  | { kind: "logs"; thread_id: ThreadId | null; lines: number }
  | { kind: "pause"; thread_id: ThreadId | null }
  | { kind: "destroy"; thread_id: ThreadId | null }
  | { kind: "resume"; thread_id: ThreadId | null }
  | { kind: "restart"; thread_id: ThreadId | null }
  | { kind: "unknown"; name: string }

export const base = (): Scope => ({ kind: "channel", channel_id: LOCAL_CHANNEL })

const target = (value: string | undefined) => {
  const raw = value?.trim() ?? ""
  if (!raw) return null
  return ThreadId.make(raw)
}

const parseLines = (raw: string | undefined) => {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (!Number.isInteger(n)) return null
  if (n <= 0) return null
  return n
}

const parseIndex = (raw: string | undefined) => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

export const parse = (line: string): Command | null => {
  const text = line.trim()
  if (!text.startsWith("/")) return null
  const parts = text.slice(1).split(/\s+/)
  const head = parts.at(0)?.toLowerCase() ?? ""
  const args = parts.slice(1)

  if (head === "channel") return { kind: "channel" }
  if (head === "help") return { kind: "help" }
  if (head === "threads") return { kind: "threads" }
  if (head === "pick") return { kind: "pick", index: parseIndex(args.at(0)) }
  if (head === "active") return { kind: "active" }
  if (head === "thread") return { kind: "thread", thread_id: target(args.at(0)) }
  if (head === "status") return { kind: "status", thread_id: target(args.at(0)) }

  if (head === "logs") {
    const lines = parseLines(args.at(0))
    if (lines === null) {
      return { kind: "logs", lines: 120, thread_id: target(args.at(0)) }
    }
    return { kind: "logs", lines, thread_id: target(args.at(1)) }
  }

  if (head === "pause") return { kind: "pause", thread_id: target(args.at(0)) }
  if (head === "destroy") return { kind: "destroy", thread_id: target(args.at(0)) }
  if (head === "resume") return { kind: "resume", thread_id: target(args.at(0)) }
  if (head === "restart") return { kind: "restart", thread_id: target(args.at(0)) }

  return { kind: "unknown", name: head }
}

export const scopeText = (scope: Scope) => scope.kind === "channel"
  ? `channel:${scope.channel_id}`
  : `thread:${scope.thread_id}`

export const prompt = (scope: Scope) => scope.kind === "channel"
  ? "channel> "
  : `thread:${scope.thread_id}> `

export const queueTarget = (scope: Scope) => scope.kind === "channel" ? "channel" : "thread"

export const threadFrom = (scope: Scope, thread_id: ThreadId): Scope => ({
  kind: "thread",
  channel_id: scope.channel_id,
  thread_id,
})

export const channelFrom = (scope: Scope): Scope => ({
  kind: "channel",
  channel_id: scope.channel_id,
})

export const autoThread = (scope: Scope, action: Action, known = false): Scope => {
  if (scope.kind === "thread") return scope
  if (action.kind !== "typing" && action.kind !== "send" && action.kind !== "reply") return scope
  if (known) return scope
  return threadFrom(scope, action.thread_id)
}
