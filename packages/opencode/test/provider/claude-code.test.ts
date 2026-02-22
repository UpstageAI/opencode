import { describe, expect, test } from "bun:test"
import path from "path"
import { ClaudeCode } from "../../src/provider/claude-code"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const HAS_CLI = Boolean(Bun.which("claude"))

describe("claude-code.enabled", () => {
  test("returns true for claude-code provider", () => {
    const model = { providerID: "claude-code" } as Provider.Model
    expect(ClaudeCode.enabled(model)).toBe(true)
  })

  test("returns false for other providers", () => {
    const model = { providerID: "anthropic" } as Provider.Model
    expect(ClaudeCode.enabled(model)).toBe(false)
  })
})

describe("claude-code.provider", () => {
  test.skipIf(!HAS_CLI)("returns provider info when CLI available", () => {
    const info = ClaudeCode.provider()
    expect(info).toBeDefined()
    expect(info!.id).toBe("claude-code")
    expect(info!.name).toBe("Claude Code")
    expect(info!.source).toBe("custom")
    expect(Object.keys(info!.models)).toEqual(["sonnet", "opus", "haiku"])
  })

  test.skipIf(!HAS_CLI)("models have correct capabilities", () => {
    const info = ClaudeCode.provider()!
    for (const model of Object.values(info.models)) {
      expect(model.providerID).toBe("claude-code")
      expect(model.capabilities.reasoning).toBe(true)
      expect(model.capabilities.toolcall).toBe(true)
      expect(model.capabilities.temperature).toBe(false)
      expect(model.family).toBe("claude")
    }
  })

  test.skipIf(!HAS_CLI)("sonnet model has expected cost", () => {
    const info = ClaudeCode.provider()!
    expect(info.models["sonnet"].cost.input).toBe(3)
    expect(info.models["sonnet"].cost.output).toBe(15)
  })
})

describe("claude-code.clearSession", () => {
  test("does not throw for unknown session", () => {
    expect(() => ClaudeCode.clearSession("nonexistent")).not.toThrow()
  })
})

describe("claude-code provider registration", () => {
  test.skipIf(!HAS_CLI)("appears in Provider.list", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["claude-code"]).toBeDefined()
        expect(providers["claude-code"].name).toBe("Claude Code")
        expect(providers["claude-code"].models["sonnet"]).toBeDefined()
        expect(providers["claude-code"].models["opus"]).toBeDefined()
        expect(providers["claude-code"].models["haiku"]).toBeDefined()
      },
    })
  })

  test.skipIf(!HAS_CLI)("disabled_providers excludes claude-code", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            disabled_providers: ["claude-code"],
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["claude-code"]).toBeUndefined()
      },
    })
  })
})

describe("claude-code CLI stream-json", () => {
  test.skipIf(!HAS_CLI)(
    "text response produces expected events",
    async () => {
      const proc = Bun.spawn(
        [
          "claude",
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          "sonnet",
          "Reply with exactly: test123",
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const raw = await new Response(proc.stdout).text()
      await proc.exited

      const lines = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))

      const types = lines.map((l: Record<string, unknown>) => l.type)
      expect(types).toContain("system")
      expect(types).toContain("stream_event")
      expect(types).toContain("result")

      const init = lines.find((l: Record<string, unknown>) => l.type === "system" && l.subtype === "init")
      expect(init).toBeDefined()
      expect(typeof init.session_id).toBe("string")

      const result = lines.find((l: Record<string, unknown>) => l.type === "result")
      expect(result.subtype).toBe("success")
      expect(typeof result.total_cost_usd).toBe("number")
    },
    30_000,
  )

  test.skipIf(!HAS_CLI)(
    "tool use produces content_block_start with tool_use type",
    async () => {
      const proc = Bun.spawn(
        [
          "claude",
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          "sonnet",
          "Run: echo hello123",
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const raw = await new Response(proc.stdout).text()
      await proc.exited

      const lines = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))

      const toolStart = lines.find((l: Record<string, unknown>) => {
        if (l.type !== "stream_event") return false
        const ev = l.event as Record<string, unknown>
        if (ev.type !== "content_block_start") return false
        const cb = ev.content_block as Record<string, unknown>
        return cb.type === "tool_use"
      })
      expect(toolStart).toBeDefined()

      const toolResult = lines.find((l: Record<string, unknown>) => {
        if (l.type !== "user") return false
        const msg = l.message as Record<string, unknown>
        if (!Array.isArray(msg.content)) return false
        return msg.content.some((c: Record<string, unknown>) => c.type === "tool_result")
      })
      expect(toolResult).toBeDefined()
    },
    60_000,
  )

  test.skipIf(!HAS_CLI)(
    "--resume maintains conversation context",
    async () => {
      const proc1 = Bun.spawn(
        [
          "claude",
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          "sonnet",
          "Remember the word: pineapple42",
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const raw1 = await new Response(proc1.stdout).text()
      await proc1.exited

      const lines1 = raw1
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
      const init = lines1.find((l: Record<string, unknown>) => l.type === "system" && l.subtype === "init")
      const sid = init.session_id as string
      expect(sid).toBeTruthy()

      const proc2 = Bun.spawn(
        [
          "claude",
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          "sonnet",
          "--resume",
          sid,
          "What word did I ask you to remember?",
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const raw2 = await new Response(proc2.stdout).text()
      await proc2.exited

      const result = raw2
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l))
        .find((l: Record<string, unknown>) => l.type === "result")

      expect(result.subtype).toBe("success")
      expect((result.result as string).toLowerCase()).toContain("pineapple42")
    },
    60_000,
  )
})
