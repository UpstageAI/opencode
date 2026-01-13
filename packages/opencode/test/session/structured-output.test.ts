import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"

describe("structured-output.OutputFormat", () => {
  test("parses text format", () => {
    const result = MessageV2.OutputFormat.safeParse({ type: "text" })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("text")
    }
  })

  test("parses json_schema format with defaults", () => {
    const result = MessageV2.OutputFormat.safeParse({
      type: "json_schema",
      schema: { type: "object", properties: { name: { type: "string" } } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe("json_schema")
      if (result.data.type === "json_schema") {
        expect(result.data.retryCount).toBe(2) // default value
      }
    }
  })

  test("parses json_schema format with custom retryCount", () => {
    const result = MessageV2.OutputFormat.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: 5,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === "json_schema") {
      expect(result.data.retryCount).toBe(5)
    }
  })

  test("rejects invalid type", () => {
    const result = MessageV2.OutputFormat.safeParse({ type: "invalid" })
    expect(result.success).toBe(false)
  })

  test("rejects json_schema without schema", () => {
    const result = MessageV2.OutputFormat.safeParse({ type: "json_schema" })
    expect(result.success).toBe(false)
  })

  test("rejects negative retryCount", () => {
    const result = MessageV2.OutputFormat.safeParse({
      type: "json_schema",
      schema: { type: "object" },
      retryCount: -1,
    })
    expect(result.success).toBe(false)
  })
})

describe("structured-output.StructuredOutputError", () => {
  test("creates error with message and retries", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Failed to validate",
      retries: 3,
    })

    expect(error.name).toBe("StructuredOutputError")
    expect(error.data.message).toBe("Failed to validate")
    expect(error.data.retries).toBe(3)
  })

  test("converts to object correctly", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test error",
      retries: 2,
    })

    const obj = error.toObject()
    expect(obj.name).toBe("StructuredOutputError")
    expect(obj.data.message).toBe("Test error")
    expect(obj.data.retries).toBe(2)
  })

  test("isInstance correctly identifies error", () => {
    const error = new MessageV2.StructuredOutputError({
      message: "Test",
      retries: 1,
    })

    expect(MessageV2.StructuredOutputError.isInstance(error)).toBe(true)
    expect(MessageV2.StructuredOutputError.isInstance({ name: "other" })).toBe(false)
  })
})

describe("structured-output.UserMessage", () => {
  test("user message accepts outputFormat", () => {
    const result = MessageV2.User.safeParse({
      id: "test-id",
      sessionID: "test-session",
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
      outputFormat: {
        type: "json_schema",
        schema: { type: "object" },
      },
    })
    expect(result.success).toBe(true)
  })

  test("user message works without outputFormat (optional)", () => {
    const result = MessageV2.User.safeParse({
      id: "test-id",
      sessionID: "test-session",
      role: "user",
      time: { created: Date.now() },
      agent: "default",
      model: { providerID: "anthropic", modelID: "claude-3" },
    })
    expect(result.success).toBe(true)
  })
})

describe("structured-output.AssistantMessage", () => {
  const baseAssistantMessage = {
    id: "test-id",
    sessionID: "test-session",
    role: "assistant" as const,
    parentID: "parent-id",
    modelID: "claude-3",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/test", root: "/test" },
    cost: 0.001,
    tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
  }

  test("assistant message accepts structured_output", () => {
    const result = MessageV2.Assistant.safeParse({
      ...baseAssistantMessage,
      structured_output: { company: "Anthropic", founded: 2021 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.structured_output).toEqual({ company: "Anthropic", founded: 2021 })
    }
  })

  test("assistant message works without structured_output (optional)", () => {
    const result = MessageV2.Assistant.safeParse(baseAssistantMessage)
    expect(result.success).toBe(true)
  })
})

describe("structured-output.createStructuredOutputTool", () => {
  test("creates tool with correct id", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: () => {},
    })

    // AI SDK tool type doesn't expose id, but we set it internally
    expect((tool as any).id).toBe("StructuredOutput")
  })

  test("creates tool with description", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    expect(tool.description).toContain("structured format")
  })

  test("creates tool with schema as inputSchema", () => {
    const schema = {
      type: "object",
      properties: {
        company: { type: "string" },
        founded: { type: "number" },
      },
      required: ["company"],
    }

    const tool = SessionPrompt.createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    expect(tool.inputSchema).toBeDefined()
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.properties?.company).toBeDefined()
    expect(inputSchema.jsonSchema?.properties?.founded).toBeDefined()
  })

  test("strips $schema property from inputSchema", () => {
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { name: { type: "string" } },
    }

    const tool = SessionPrompt.createStructuredOutputTool({
      schema,
      onSuccess: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.$schema).toBeUndefined()
  })

  test("execute calls onSuccess with args", async () => {
    let capturedOutput: unknown

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: (output) => {
        capturedOutput = output
      },
    })

    expect(tool.execute).toBeDefined()
    const testArgs = { name: "Test Company" }
    const result = await tool.execute!(testArgs, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toEqual(testArgs)
    expect(result.output).toBe("Structured output captured successfully.")
    expect(result.metadata.valid).toBe(true)
  })

  test("toModelOutput returns text value", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
    })

    expect(tool.toModelOutput).toBeDefined()
    const modelOutput = tool.toModelOutput!({
      output: "Test output",
      title: "Test",
      metadata: { valid: true },
    })

    expect(modelOutput.type).toBe("text")
    expect(modelOutput.value).toBe("Test output")
  })
})
