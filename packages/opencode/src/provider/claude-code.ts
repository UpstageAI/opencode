import type { ModelMessage, Tool } from "ai"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import { Plugin } from "../plugin"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { SessionStatus } from "../session/status"
import { Snapshot } from "../snapshot"
import { Log } from "../util/log"
import type { Provider } from "./provider"

export namespace ClaudeCode {
  const log = Log.create({ service: "provider.claude-code" })
  const sessions = new Map<string, string>()
  const TIMEOUT = 300_000
  let subscribed = false

  function subscribe() {
    if (subscribed) return
    subscribed = true
    Bus.subscribe(Session.Event.Deleted, (evt) => {
      sessions.delete(evt.properties.info.id)
    })
  }

  type Usage = {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }

  type Block = {
    type: string
    text?: MessageV2.TextPart
    reasoning?: MessageV2.ReasoningPart
    toolId?: string
    toolName?: string
    json?: string
    tool?: MessageV2.ToolPart
  }

  const MODELS: Record<string, Provider.Model> = {
    sonnet: {
      id: "sonnet",
      providerID: "claude-code",
      name: "Claude Code Sonnet",
      family: "claude",
      api: { id: "sonnet", url: "", npm: "" },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: true,
      },
      cost: { input: 3, output: 15, cache: { read: 0.3, write: 3.75 } },
      limit: { context: 200000, output: 16000 },
      status: "beta",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    },
    opus: {
      id: "opus",
      providerID: "claude-code",
      name: "Claude Code Opus",
      family: "claude",
      api: { id: "opus", url: "", npm: "" },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: true,
      },
      cost: { input: 15, output: 75, cache: { read: 1.5, write: 18.75 } },
      limit: { context: 200000, output: 16000 },
      status: "beta",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    },
    haiku: {
      id: "haiku",
      providerID: "claude-code",
      name: "Claude Code Haiku",
      family: "claude",
      api: { id: "haiku", url: "", npm: "" },
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: { text: true, audio: false, image: true, video: false, pdf: true },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: true,
      },
      cost: { input: 0.8, output: 4, cache: { read: 0.08, write: 1 } },
      limit: { context: 200000, output: 16000 },
      status: "beta",
      options: {},
      headers: {},
      release_date: "2025-01-01",
    },
  }

  function available(): boolean {
    return Boolean(Bun.which("claude"))
  }

  export function enabled(model: Provider.Model): boolean {
    return model.providerID === "claude-code"
  }

  export function provider(): Provider.Info | undefined {
    if (!available()) return undefined
    return {
      id: "claude-code",
      name: "Claude Code",
      source: "custom",
      env: [],
      options: {},
      models: MODELS,
    }
  }

  function prompt(messages: ModelMessage[]): string {
    const list = messages.filter((msg) => msg.role === "user")
    const last = list.at(-1)
    if (!last) return ""
    if (typeof last.content === "string") return last.content
    if (!Array.isArray(last.content)) return ""
    return last.content
      .map((part) => {
        if (typeof part !== "object" || !part) return ""
        if (!("type" in part)) return ""
        if (part.type !== "text") return ""
        if (!("text" in part)) return ""
        if (typeof part.text !== "string") return ""
        return part.text
      })
      .join("\n")
  }

  function tokens(usage: Usage | undefined) {
    const input = Number(usage?.input_tokens ?? 0)
    const output = Number(usage?.output_tokens ?? 0)
    const write = Number(usage?.cache_creation_input_tokens ?? 0)
    const read = Number(usage?.cache_read_input_tokens ?? 0)
    return {
      total: input + output + write + read,
      input,
      output,
      reasoning: 0,
      cache: {
        write,
        read,
      },
    }
  }

  export function clearSession(id: string) {
    sessions.delete(id)
  }

  export async function process(input: {
    sessionID: string
    assistantMessage: MessageV2.Assistant
    model: Provider.Model
    abort: AbortSignal
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
  }): Promise<"continue" | "stop" | "compact"> {
    subscribe()
    const snap = await Snapshot.track()
    const model = input.model.api.id || input.model.id
    const resumed = sessions.get(input.sessionID)
    const args = [
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      model,
    ]
    if (resumed) {
      args.push("--resume", resumed)
    }
    if (!resumed) {
      for (const item of input.system) {
        if (!item.trim()) continue
        args.push("--append-system-prompt", item)
      }
    }
    args.push(prompt(input.messages))

    void input.tools

    const signal = AbortSignal.any([input.abort, AbortSignal.timeout(TIMEOUT)])
    const blocks: Record<number, Block> = {}
    const tracked: Record<string, MessageV2.ToolPart> = {}
    let usage: Usage | undefined
    let cost = 0
    let seen = false

    SessionStatus.set(input.sessionID, { type: "busy" })

    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: input.assistantMessage.id,
      sessionID: input.assistantMessage.sessionID,
      snapshot: snap,
      type: "step-start",
    })

    const handle = async (line: Record<string, unknown>) => {
      // System init — capture CLI session ID for --resume
      if (line.type === "system" && line.subtype === "init" && typeof line.session_id === "string") {
        sessions.set(input.sessionID, line.session_id)
      }

      // Stream events — low-latency deltas for text, thinking, and tool_use
      if (line.type === "stream_event" && typeof line.event === "object" && line.event) {
        const ev = line.event as Record<string, unknown>

        if (ev.type === "content_block_start" && typeof ev.content_block === "object" && ev.content_block) {
          const cb = ev.content_block as Record<string, unknown>
          const idx = ev.index as number

          if (cb.type === "text") {
            const part: MessageV2.TextPart = {
              id: Identifier.ascending("part"),
              messageID: input.assistantMessage.id,
              sessionID: input.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
            }
            await Session.updatePart(part)
            blocks[idx] = { type: "text", text: part }
          }

          if (cb.type === "thinking") {
            const part: MessageV2.ReasoningPart = {
              id: Identifier.ascending("part"),
              messageID: input.assistantMessage.id,
              sessionID: input.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
            }
            await Session.updatePart(part)
            blocks[idx] = { type: "thinking", reasoning: part }
          }

          if (cb.type === "tool_use" && typeof cb.id === "string" && typeof cb.name === "string") {
            const part: MessageV2.ToolPart = {
              id: Identifier.ascending("part"),
              messageID: input.assistantMessage.id,
              sessionID: input.assistantMessage.sessionID,
              type: "tool",
              callID: cb.id,
              tool: cb.name,
              state: { status: "pending", input: {}, raw: "" },
            }
            await Session.updatePart(part)
            blocks[idx] = { type: "tool_use", toolId: cb.id, toolName: cb.name, json: "", tool: part }
            tracked[cb.id] = part
          }
        }

        if (ev.type === "content_block_delta" && typeof ev.delta === "object" && ev.delta) {
          const delta = ev.delta as Record<string, unknown>
          const block = blocks[ev.index as number]
          if (!block) return

          if (delta.type === "text_delta" && typeof delta.text === "string" && block.text) {
            block.text.text += delta.text
            await Session.updatePartDelta({
              sessionID: block.text.sessionID,
              messageID: block.text.messageID,
              partID: block.text.id,
              field: "text",
              delta: delta.text,
            })
          }

          if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && block.reasoning) {
            block.reasoning.text += delta.thinking
            await Session.updatePartDelta({
              sessionID: block.reasoning.sessionID,
              messageID: block.reasoning.messageID,
              partID: block.reasoning.id,
              field: "text",
              delta: delta.thinking,
            })
          }

          if (
            delta.type === "input_json_delta" &&
            typeof delta.partial_json === "string" &&
            block.type === "tool_use"
          ) {
            block.json = (block.json ?? "") + delta.partial_json
          }
        }

        if (ev.type === "content_block_stop") {
          const idx = ev.index as number
          const block = blocks[idx]
          if (!block) return

          if (block.type === "text" && block.text) {
            block.text.text = block.text.text.trimEnd()
            const out = await Plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: input.assistantMessage.sessionID,
                messageID: input.assistantMessage.id,
                partID: block.text.id,
              },
              { text: block.text.text },
            )
            block.text.text = out.text
            block.text.time = { start: block.text.time?.start ?? Date.now(), end: Date.now() }
            await Session.updatePart(block.text)
          }

          if (block.type === "thinking" && block.reasoning) {
            block.reasoning.text = block.reasoning.text.trimEnd()
            block.reasoning.time = { start: block.reasoning.time.start, end: Date.now() }
            await Session.updatePart(block.reasoning)
          }

          if (block.type === "tool_use" && block.tool) {
            let parsed: Record<string, unknown> = {}
            try {
              if (block.json) parsed = JSON.parse(block.json)
            } catch {
              log.warn("failed to parse tool input", { json: block.json?.slice(0, 200) })
            }
            block.tool.state = {
              status: "running",
              input: parsed as Record<string, any>,
              time: { start: Date.now() },
            }
            await Session.updatePart(block.tool)
          }

          delete blocks[idx]
        }

        if (ev.type === "message_start" && typeof ev.message === "object" && ev.message) {
          const msg = ev.message as Record<string, unknown>
          if (typeof msg.usage === "object" && msg.usage) usage = msg.usage as Usage
        }

        if (ev.type === "message_delta") {
          if (typeof ev.usage === "object" && ev.usage) usage = ev.usage as Usage
        }
      }

      // Assistant events — track usage from cumulative messages
      if (line.type === "assistant" && typeof line.message === "object" && line.message) {
        const msg = line.message as Record<string, unknown>
        if (typeof msg.usage === "object" && msg.usage) usage = msg.usage as Usage
      }

      // User events — CLI-internal tool results
      if (line.type === "user" && typeof line.message === "object" && line.message) {
        const msg = line.message as Record<string, unknown>
        if (!Array.isArray(msg.content)) return
        for (const item of msg.content) {
          if (typeof item !== "object" || !item) continue
          const c = item as Record<string, unknown>
          if (c.type !== "tool_result" || typeof c.tool_use_id !== "string") continue
          const part = tracked[c.tool_use_id]
          if (!part || part.state.status !== "running") continue
          const output = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "")
          if (c.is_error === true) {
            part.state = {
              status: "error",
              input: part.state.input,
              error: output.slice(0, 10000),
              time: { start: part.state.time.start, end: Date.now() },
            }
          } else {
            part.state = {
              status: "completed",
              input: part.state.input,
              output: output.slice(0, 50000),
              title: part.tool,
              metadata: {},
              time: { start: part.state.time.start, end: Date.now() },
            }
          }
          await Session.updatePart(part)
          delete tracked[c.tool_use_id]
        }
      }

      // Result event — final cost and completion status
      if (line.type === "result") {
        seen = true
        if (typeof line.cost_usd === "number") cost = line.cost_usd
      }
    }

    try {
      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        signal,
      })
      const stderrTask = new Response(proc.stderr).text().catch(() => "")
      const out = proc.stdout.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      while (true) {
        const read = await out.read()
        if (read.done) break
        buf += decoder.decode(read.value, { stream: true })
        const rows = buf.split("\n")
        buf = rows.pop() ?? ""
        for (const row of rows) {
          if (!row.trim()) continue
          try {
            const parsed = JSON.parse(row)
            if (typeof parsed === "object" && parsed) await handle(parsed)
          } catch {
            log.warn("invalid json line", { row: row.slice(0, 200) })
          }
        }
      }

      if (buf.trim()) {
        try {
          const parsed = JSON.parse(buf)
          if (typeof parsed === "object" && parsed) await handle(parsed)
        } catch {
          log.warn("invalid trailing json", { row: buf.slice(0, 200) })
        }
      }

      const code = await proc.exited
      const stderr = await stderrTask
      if (code !== 0 && !signal.aborted) {
        throw new Error(stderr || "claude cli exited with non-zero code")
      }
      if (signal.aborted && !input.abort.aborted) {
        throw new Error("claude cli timed out")
      }

      // Finalize any unclosed content blocks
      for (const block of Object.values(blocks)) {
        if (block.text) {
          block.text.text = block.text.text.trimEnd()
          block.text.time = { start: block.text.time?.start ?? Date.now(), end: Date.now() }
          await Session.updatePart(block.text)
        }
        if (block.reasoning) {
          block.reasoning.text = block.reasoning.text.trimEnd()
          block.reasoning.time = { start: block.reasoning.time.start, end: Date.now() }
          await Session.updatePart(block.reasoning)
        }
        if (block.tool && (block.tool.state.status === "pending" || block.tool.state.status === "running")) {
          const ts = block.tool.state.status === "running" ? block.tool.state.time.start : Date.now()
          block.tool.state = {
            status: "error",
            input: block.tool.state.input,
            error: "Tool execution interrupted",
            time: { start: ts, end: Date.now() },
          }
          await Session.updatePart(block.tool)
        }
      }

      // Finalize any tool parts still tracked (pending or running)
      for (const part of Object.values(tracked)) {
        if (part.state.status !== "pending" && part.state.status !== "running") continue
        const ts = part.state.status === "running" ? part.state.time.start : Date.now()
        part.state = {
          status: "error",
          input: part.state.input,
          error: "Tool execution interrupted",
          time: { start: ts, end: Date.now() },
        }
        await Session.updatePart(part)
      }

      const t = tokens(usage)
      input.assistantMessage.finish = seen ? "stop" : "error"
      input.assistantMessage.cost += cost
      input.assistantMessage.tokens = t

      await Session.updatePart({
        id: Identifier.ascending("part"),
        reason: seen ? "stop" : "error",
        snapshot: await Snapshot.track(),
        messageID: input.assistantMessage.id,
        sessionID: input.assistantMessage.sessionID,
        type: "step-finish",
        tokens: t,
        cost,
      })

      const patch = await Snapshot.patch(snap)
      if (patch.files.length) {
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: input.assistantMessage.id,
          sessionID: input.sessionID,
          type: "patch",
          hash: patch.hash,
          files: patch.files,
        })
      }

      input.assistantMessage.time.completed = Date.now()
      await Session.updateMessage(input.assistantMessage)
      SessionStatus.set(input.sessionID, { type: "idle" })
      return "stop"
    } catch (error) {
      const parsed = MessageV2.fromError(error, { providerID: input.model.providerID })
      input.assistantMessage.error = parsed
      input.assistantMessage.time.completed = Date.now()
      await Session.updateMessage(input.assistantMessage)
      Bus.publish(Session.Event.Error, {
        sessionID: input.assistantMessage.sessionID,
        error: parsed,
      })
      SessionStatus.set(input.sessionID, { type: "idle" })
      return "stop"
    }
  }
}
