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
      onError: () => {},
    })

    // AI SDK tool type doesn't expose id, but we set it internally
    expect((tool as any).id).toBe("StructuredOutput")
  })

  test("creates tool with description", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
      onError: () => {},
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
      onError: () => {},
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
      onError: () => {},
    })

    // AI SDK wraps schema in { jsonSchema: {...} }
    const inputSchema = tool.inputSchema as any
    expect(inputSchema.jsonSchema?.$schema).toBeUndefined()
  })

  test("execute calls onSuccess with valid args", async () => {
    let capturedOutput: unknown

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object", properties: { name: { type: "string" } } },
      onSuccess: (output) => {
        capturedOutput = output
      },
      onError: () => {},
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

  test("execute calls onError when validation fails - missing required field", async () => {
    let capturedError: string | undefined
    let successCalled = false

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      },
      onSuccess: () => {
        successCalled = true
      },
      onError: (error) => {
        capturedError = error
      },
    })

    // Missing required 'age' field
    const result = await tool.execute!({ name: "Test" }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(successCalled).toBe(false)
    expect(capturedError).toBeDefined()
    expect(capturedError).toContain("age")
    expect(result.output).toContain("Validation failed")
    expect(result.metadata.valid).toBe(false)
    expect(result.metadata.error).toBeDefined()
  })

  test("execute calls onError when validation fails - wrong type", async () => {
    let capturedError: string | undefined
    let successCalled = false

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          count: { type: "number" },
        },
        required: ["count"],
      },
      onSuccess: () => {
        successCalled = true
      },
      onError: (error) => {
        capturedError = error
      },
    })

    // Wrong type - string instead of number
    const result = await tool.execute!({ count: "not a number" }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(successCalled).toBe(false)
    expect(capturedError).toBeDefined()
    expect(result.output).toContain("Validation failed")
    expect(result.metadata.valid).toBe(false)
  })

  test("execute validates nested objects", async () => {
    let capturedOutput: unknown
    let capturedError: string | undefined

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["name"],
          },
        },
        required: ["user"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
      onError: (error) => {
        capturedError = error
      },
    })

    // Valid nested object
    const validResult = await tool.execute!({ user: { name: "John", email: "john@test.com" } }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toEqual({ user: { name: "John", email: "john@test.com" } })
    expect(validResult.metadata.valid).toBe(true)

    // Invalid nested object - missing required 'name'
    capturedOutput = undefined
    const invalidResult = await tool.execute!({ user: { email: "john@test.com" } }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toBeUndefined()
    expect(capturedError).toBeDefined()
    expect(invalidResult.metadata.valid).toBe(false)
  })

  test("execute validates arrays", async () => {
    let capturedOutput: unknown
    let capturedError: string | undefined

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["tags"],
      },
      onSuccess: (output) => {
        capturedOutput = output
      },
      onError: (error) => {
        capturedError = error
      },
    })

    // Valid array
    const validResult = await tool.execute!({ tags: ["a", "b", "c"] }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toEqual({ tags: ["a", "b", "c"] })
    expect(validResult.metadata.valid).toBe(true)

    // Invalid array - contains non-string
    capturedOutput = undefined
    const invalidResult = await tool.execute!({ tags: ["a", 123, "c"] }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedOutput).toBeUndefined()
    expect(capturedError).toBeDefined()
    expect(invalidResult.metadata.valid).toBe(false)
  })

  test("error message includes path for nested validation errors", async () => {
    let capturedError: string | undefined

    const tool = SessionPrompt.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: {
          company: {
            type: "object",
            properties: {
              details: {
                type: "object",
                properties: {
                  foundedYear: { type: "number" },
                },
                required: ["foundedYear"],
              },
            },
            required: ["details"],
          },
        },
        required: ["company"],
      },
      onSuccess: () => {},
      onError: (error) => {
        capturedError = error
      },
    })

    // Missing deeply nested required field
    await tool.execute!({ company: { details: {} } }, {
      toolCallId: "test-call-id",
      messages: [],
      abortSignal: undefined as any,
    })

    expect(capturedError).toBeDefined()
    // Error path should indicate the nested location
    expect(capturedError).toContain("foundedYear")
  })

  test("toModelOutput returns text value", () => {
    const tool = SessionPrompt.createStructuredOutputTool({
      schema: { type: "object" },
      onSuccess: () => {},
      onError: () => {},
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

  // Tests for retry behavior simulation
  describe("retry behavior", () => {
    test("multiple validation failures trigger multiple onError calls", async () => {
      let errorCount = 0
      const errors: string[] = []

      const tool = SessionPrompt.createStructuredOutputTool({
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name", "age"],
        },
        onSuccess: () => {},
        onError: (error) => {
          errorCount++
          errors.push(error)
        },
      })

      // First attempt - missing both required fields
      await tool.execute!({}, {
        toolCallId: "call-1",
        messages: [],
        abortSignal: undefined as any,
      })
      expect(errorCount).toBe(1)

      // Second attempt - still missing age
      await tool.execute!({ name: "Test" }, {
        toolCallId: "call-2",
        messages: [],
        abortSignal: undefined as any,
      })
      expect(errorCount).toBe(2)

      // Third attempt - wrong type for age
      await tool.execute!({ name: "Test", age: "not a number" }, {
        toolCallId: "call-3",
        messages: [],
        abortSignal: undefined as any,
      })
      expect(errorCount).toBe(3)

      // Verify each error is descriptive
      expect(errors.length).toBe(3)
      errors.forEach(error => {
        expect(error.length).toBeGreaterThan(0)
      })
    })

    test("success after failures calls onSuccess (not onError)", async () => {
      let successCalled = false
      let errorCount = 0
      let capturedOutput: unknown

      const tool = SessionPrompt.createStructuredOutputTool({
        schema: {
          type: "object",
          properties: {
            value: { type: "number" },
          },
          required: ["value"],
        },
        onSuccess: (output) => {
          successCalled = true
          capturedOutput = output
        },
        onError: () => {
          errorCount++
        },
      })

      // First attempt - wrong type
      const result1 = await tool.execute!({ value: "wrong" }, {
        toolCallId: "call-1",
        messages: [],
        abortSignal: undefined as any,
      })
      expect(errorCount).toBe(1)
      expect(successCalled).toBe(false)
      expect(result1.output).toContain("Validation failed")

      // Second attempt - correct
      const result2 = await tool.execute!({ value: 42 }, {
        toolCallId: "call-2",
        messages: [],
        abortSignal: undefined as any,
      })
      expect(errorCount).toBe(1) // Should not increment
      expect(successCalled).toBe(true)
      expect(capturedOutput).toEqual({ value: 42 })
      expect(result2.output).toBe("Structured output captured successfully.")
    })

    test("error messages guide model to fix issues", async () => {
      const tool = SessionPrompt.createStructuredOutputTool({
        schema: {
          type: "object",
          properties: {
            count: { type: "integer" },
            items: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["count", "items"],
        },
        onSuccess: () => {},
        onError: () => {},
      })

      // Invalid input
      const result = await tool.execute!({ count: 3.5, items: [1, 2, 3] }, {
        toolCallId: "call-1",
        messages: [],
        abortSignal: undefined as any,
      })

      // Error message should tell model to fix and retry
      expect(result.output).toContain("Validation failed")
      expect(result.output).toContain("call StructuredOutput again")
    })

    test("simulates retry state tracking (like prompt.ts does)", async () => {
      // This test simulates how prompt.ts tracks retry state
      let structuredOutput: unknown | undefined
      let structuredOutputError: string | undefined
      let structuredOutputRetries = 0
      const maxRetries = 2

      const tool = SessionPrompt.createStructuredOutputTool({
        schema: {
          type: "object",
          properties: { answer: { type: "number" } },
          required: ["answer"],
        },
        onSuccess: (output) => {
          structuredOutput = output
        },
        onError: (error) => {
          structuredOutputError = error
          structuredOutputRetries++
        },
      })

      // Simulate retry loop like in prompt.ts
      const attempts: Array<{ input: unknown; shouldRetry: boolean }> = [
        { input: { answer: "wrong" }, shouldRetry: true },  // Attempt 1: fails
        { input: { answer: "still wrong" }, shouldRetry: true },  // Attempt 2: fails
        { input: { answer: "nope" }, shouldRetry: false },  // Attempt 3: fails, max exceeded
      ]

      for (const { input, shouldRetry } of attempts) {
        await tool.execute!(input, {
          toolCallId: `call-${structuredOutputRetries + 1}`,
          messages: [],
          abortSignal: undefined as any,
        })

        // Check if we should continue (like prompt.ts loop logic)
        if (structuredOutput !== undefined) {
          break // Success - exit loop
        }

        if (structuredOutputError) {
          if (structuredOutputRetries <= maxRetries) {
            expect(shouldRetry).toBe(true)
            structuredOutputError = undefined // Reset for next attempt
          } else {
            expect(shouldRetry).toBe(false)
            // Max retries exceeded - would set StructuredOutputError in prompt.ts
            break
          }
        }
      }

      // Verify final state after max retries exceeded
      expect(structuredOutputRetries).toBe(3)
      expect(structuredOutput).toBeUndefined()
    })

    test("simulates successful retry after initial failures", async () => {
      let structuredOutput: unknown | undefined
      let structuredOutputError: string | undefined
      let structuredOutputRetries = 0
      const maxRetries = 2

      const tool = SessionPrompt.createStructuredOutputTool({
        schema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
        onSuccess: (output) => {
          structuredOutput = output
        },
        onError: (error) => {
          structuredOutputError = error
          structuredOutputRetries++
        },
      })

      // Simulate: fail twice, then succeed on third attempt
      const attempts = [
        { value: "wrong" },      // Fails
        { value: "also wrong" }, // Fails
        { value: 42 },           // Succeeds
      ]

      for (const input of attempts) {
        await tool.execute!(input, {
          toolCallId: `call-${structuredOutputRetries + 1}`,
          messages: [],
          abortSignal: undefined as any,
        })

        if (structuredOutput !== undefined) {
          break // Success
        }

        if (structuredOutputError && structuredOutputRetries <= maxRetries) {
          structuredOutputError = undefined
        }
      }

      // Should have succeeded on retry 2 (within maxRetries)
      expect(structuredOutput).toEqual({ value: 42 })
      expect(structuredOutputRetries).toBe(2) // Two failures before success
    })
  })
})
