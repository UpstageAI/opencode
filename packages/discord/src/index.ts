import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { FetchHttpClient } from "@effect/platform"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { DiscordConversationServicesLive } from "./conversation/implementations/discord"
import { Conversation } from "./conversation/services/conversation"
import { ConversationLedger } from "./conversation/services/ledger"
import { AppConfig } from "./config"
import { SqliteDb } from "./db/client"
import { DiscordClient } from "./discord/client"
import { TurnRouter } from "./discord/turn-routing"
import { HealthServer } from "./http/health"
import { LoggerLive } from "./observability/logger"
import { DaytonaService } from "./sandbox/daytona"
import { OpenCodeClient } from "./sandbox/opencode-client"
import { ThreadAgentPool } from "./sandbox/pool"
import { SandboxProvisioner } from "./sandbox/provisioner"
import { SessionStore } from "./sessions/store"

const AnthropicLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return AnthropicLanguageModel.layer({ model: config.turnRoutingModel }).pipe(
      Layer.provide(AnthropicClient.layer({
        apiKey: config.openCodeZenApiKey,
        apiUrl: "https://opencode.ai/zen",
      })),
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)

type AppServices =
  | AppConfig
  | DiscordClient
  | HealthServer
  | OpenCodeClient
  | SessionStore
  | DaytonaService
  | TurnRouter
  | SandboxProvisioner
  | ThreadAgentPool
  | ConversationLedger
  | Conversation

const BaseLayer = Layer.mergeAll(AppConfig.layer, FetchHttpClient.layer, BunContext.layer, LoggerLive)
const WithSqlite = Layer.provideMerge(SqliteDb.layer, BaseLayer)
const WithAnthropic = Layer.provideMerge(AnthropicLayer, WithSqlite)
const WithDaytona = Layer.provideMerge(DaytonaService.layer, WithAnthropic)
const WithOpenCode = Layer.provideMerge(OpenCodeClient.layer, WithDaytona)
const WithRouting = Layer.provideMerge(TurnRouter.layer, WithOpenCode)
const WithSessions = Layer.provideMerge(SessionStore.layer, WithRouting)
const WithProvisioner = Layer.provideMerge(SandboxProvisioner.layer, WithSessions)
const WithSandbox = Layer.provideMerge(ThreadAgentPool.layer, WithProvisioner)
const WithLedger = Layer.provideMerge(ConversationLedger.layer, WithSandbox)
const WithDiscord = Layer.provideMerge(DiscordClient.layer, WithLedger)
const WithDiscordConversation = Layer.provideMerge(DiscordConversationServicesLive, WithDiscord)
const WithConversation = Layer.provideMerge(Conversation.layer, WithDiscordConversation)
const AppLayer = Layer.provideMerge(HealthServer.layer, WithConversation) as Layer.Layer<AppServices | SqliteDb, never, never>

const main = Effect.gen(function* () {
  const client = yield* DiscordClient
  const conversation = yield* Conversation
  yield* ThreadAgentPool
  yield* HealthServer

  yield* Effect.forkScoped(conversation.run)
  yield* Effect.logInfo("Discord bot ready").pipe(
    Effect.annotateLogs({ event: "discord.ready", tag: client.user?.tag }),
  )

  yield* Effect.logInfo("Discord bot started")
  return yield* Effect.never
})

main.pipe(
  Effect.provide(AppLayer),
  Effect.scoped,
  BunRuntime.runMain,
)
