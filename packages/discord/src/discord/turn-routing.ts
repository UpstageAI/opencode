import { LanguageModel } from "@effect/ai"
import { AnthropicLanguageModel } from "@effect/ai-anthropic"
import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig } from "../config"

export class TurnRoutingDecision extends Schema.Class<TurnRoutingDecision>("TurnRoutingDecision")({
  shouldRespond: Schema.Boolean,
  reason: Schema.String,
}) {}

export class TurnRoutingInput extends Schema.Class<TurnRoutingInput>("TurnRoutingInput")({
  content: Schema.String,
  botUserId: Schema.String,
  botRoleId: Schema.String,
  mentionedUserIds: Schema.Array(Schema.String),
  mentionedRoleIds: Schema.Array(Schema.String),
}) {}

const QUICK_CHAT_RE = /^(ok|okay|k|kk|thanks|thank you|thx|lol|lmao|haha|nice|cool|yup|yep|nah|nope|got it|sgtm)[!. ]*$/i

const heuristicDecision = (input: TurnRoutingInput): TurnRoutingDecision | null => {
  const text = input.content.trim()
  const lower = text.toLowerCase()

  if (!text) return TurnRoutingDecision.make({ shouldRespond: false, reason: "empty-message" })

  if (input.mentionedUserIds.some((id) => id !== input.botUserId))
    return TurnRoutingDecision.make({ shouldRespond: false, reason: "mentions-other-user" })

  if (input.mentionedRoleIds.some((id) => id !== input.botRoleId))
    return TurnRoutingDecision.make({ shouldRespond: false, reason: "mentions-other-role" })

  if (text.length <= 40 && QUICK_CHAT_RE.test(text))
    return TurnRoutingDecision.make({ shouldRespond: false, reason: "quick-chat" })

  if (/\b(opencode|bot)\b/i.test(text))
    return TurnRoutingDecision.make({ shouldRespond: true, reason: "bot-keyword" })

  if (text.includes("?") && /\b(you|your|can you|could you|would you|please|help)\b/i.test(text))
    return TurnRoutingDecision.make({ shouldRespond: true, reason: "direct-question" })

  if (text.includes("?") && /\b(how|what|why|where|when|which)\b/i.test(text))
    return TurnRoutingDecision.make({ shouldRespond: true, reason: "general-question" })

  if (lower.startsWith("do this") || lower.startsWith("run ") || lower.startsWith("fix "))
    return TurnRoutingDecision.make({ shouldRespond: true, reason: "instruction" })

  return null
}

const fallbackThreadName = (message: string): string =>
  message.slice(0, 95) + (message.length > 95 ? "..." : "")

export declare namespace TurnRouter {
  export interface Service {
    readonly shouldRespond: (input: TurnRoutingInput) => Effect.Effect<TurnRoutingDecision>
    readonly generateThreadName: (userMessage: string) => Effect.Effect<string>
  }
}

export class TurnRouter extends Context.Tag("@discord/TurnRouter")<TurnRouter, TurnRouter.Service>() {
  static readonly layer = Layer.effect(
    TurnRouter,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const model = yield* LanguageModel.LanguageModel

      const aiDecision = (input: TurnRoutingInput): Effect.Effect<TurnRoutingDecision> => {
        const prompt = [
          "You route turns for an engineering Discord bot.",
          "Decide if the latest message is directed at the bot assistant or is side conversation.",
          "Return EXACTLY one token: RESPOND or SKIP.",
          "",
          `Message: ${input.content}`,
          `MentionsOtherUser: ${input.mentionedUserIds.some((id) => id !== input.botUserId)}`,
          `MentionsOtherRole: ${input.mentionedRoleIds.some((id) => id !== input.botRoleId)}`,
        ].join("\n")

        return AnthropicLanguageModel.withConfigOverride(
          model.generateText({ prompt }).pipe(
            Effect.map((response) => {
              const output = response.text.trim().toUpperCase()
              if (output.includes("SKIP")) return TurnRoutingDecision.make({ shouldRespond: false, reason: "ai-skip" })
              return TurnRoutingDecision.make({
                shouldRespond: true,
                reason: output.includes("RESPOND") ? "ai-respond" : "ai-default-respond",
              })
            }),
            Effect.catchAll(() =>
              Effect.succeed(TurnRoutingDecision.make({ shouldRespond: true, reason: "ai-error-default-respond" })),
            ),
          ),
          { model: config.turnRoutingModel, max_tokens: 10 },
        )
      }

      const shouldRespond = Effect.fn("TurnRouter.shouldRespond")(function* (input: TurnRoutingInput) {
        if (config.turnRoutingMode === "off") {
          return TurnRoutingDecision.make({ shouldRespond: true, reason: "routing-off" })
        }

        const heuristic = heuristicDecision(input)
        if (heuristic) return heuristic

        if (config.turnRoutingMode === "heuristic") {
          return TurnRoutingDecision.make({
            shouldRespond: true,
            reason: "heuristic-uncertain-default-respond",
          })
        }

        return yield* aiDecision(input)
      })

      const generateThreadName = Effect.fn("TurnRouter.generateThreadName")(function* (userMessage: string) {
        return yield* AnthropicLanguageModel.withConfigOverride(
          model.generateText({
            prompt: `Generate a short, descriptive thread title (max 90 chars) for this Discord question. Return ONLY the title, no quotes, no explanation.\n\nQuestion: ${userMessage}`,
          }).pipe(
            Effect.map((response) => {
              const title = response.text.trim()
              if (!title || title.length === 0) return fallbackThreadName(userMessage)
              return title.slice(0, 95) + (title.length > 95 ? "..." : "")
            }),
            Effect.catchAll(() => Effect.succeed(fallbackThreadName(userMessage))),
          ),
          { model: "claude-haiku-4-5", max_tokens: 60 },
        )
      })

      return TurnRouter.of({ shouldRespond, generateThreadName })
    }),
  )
}
