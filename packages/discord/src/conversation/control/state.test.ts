import { describe, expect, it } from "bun:test"
import { ThreadId } from "../../types"
import { Send, Typing } from "../model/schema"
import { autoThread, base, channelFrom, parse, prompt, queueTarget, scopeText, threadFrom } from "./state"

describe("cli-state", () => {
  it("parses commands", () => {
    expect(parse("hello")).toBeNull()
    expect(parse("/help")).toEqual({ kind: "help" })
    expect(parse("/channel")).toEqual({ kind: "channel" })
    expect(parse("/threads")).toEqual({ kind: "threads" })
    expect(parse("/pick")).toEqual({ kind: "pick", index: null })
    expect(parse("/pick 2")).toEqual({ kind: "pick", index: 2 })
    expect(parse("/active")).toEqual({ kind: "active" })
    expect(parse("/thread")).toEqual({ kind: "thread", thread_id: null })
    expect(parse("/thread abc")).toEqual({ kind: "thread", thread_id: ThreadId.make("abc") })
    expect(parse("/status")).toEqual({ kind: "status", thread_id: null })
    expect(parse("/status abc")).toEqual({ kind: "status", thread_id: ThreadId.make("abc") })
    expect(parse("/logs")).toEqual({ kind: "logs", lines: 120, thread_id: null })
    expect(parse("/logs 80")).toEqual({ kind: "logs", lines: 80, thread_id: null })
    expect(parse("/logs abc")).toEqual({ kind: "logs", lines: 120, thread_id: ThreadId.make("abc") })
    expect(parse("/logs 80 abc")).toEqual({ kind: "logs", lines: 80, thread_id: ThreadId.make("abc") })
    expect(parse("/pause")).toEqual({ kind: "pause", thread_id: null })
    expect(parse("/destroy")).toEqual({ kind: "destroy", thread_id: null })
    expect(parse("/resume")).toEqual({ kind: "resume", thread_id: null })
    expect(parse("/restart")).toEqual({ kind: "restart", thread_id: null })
    expect(parse("/nope")).toEqual({ kind: "unknown", name: "nope" })
  })

  it("formats scope and prompt", () => {
    const a = base()
    const b = threadFrom(a, ThreadId.make("t1"))
    expect(scopeText(a)).toBe("channel:local-channel")
    expect(scopeText(b)).toBe("thread:t1")
    expect(prompt(a)).toBe("channel> ")
    expect(prompt(b)).toBe("thread:t1> ")
    expect(queueTarget(a)).toBe("channel")
    expect(queueTarget(b)).toBe("thread")
    expect(channelFrom(b)).toEqual(a)
  })

  it("auto switches from channel to thread on action", () => {
    const a = base()
    const typing = Typing.make({ kind: "typing", thread_id: ThreadId.make("t-a") })
    const send = Send.make({ kind: "send", thread_id: ThreadId.make("t-b"), text: "ok" })

    expect(autoThread(a, typing)).toEqual(threadFrom(a, ThreadId.make("t-a")))
    expect(autoThread(a, send)).toEqual(threadFrom(a, ThreadId.make("t-b")))
    expect(autoThread(a, send, true)).toEqual(a)
    expect(autoThread(threadFrom(a, ThreadId.make("t0")), send)).toEqual(threadFrom(a, ThreadId.make("t0")))
  })
})
