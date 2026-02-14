import { Client, GatewayIntentBits, Partials } from "discord.js"
import { Context, Effect, Layer, Redacted } from "effect"
import { AppConfig } from "../config"

export class DiscordClient extends Context.Tag("@discord/DiscordClient")<DiscordClient, Client>() {
  static readonly layer = Layer.scoped(
    DiscordClient,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel],
      })

      yield* Effect.tryPromise(() => client.login(Redacted.value(config.discordToken)))
      yield* Effect.logInfo("Discord client logged in").pipe(
        Effect.annotateLogs({ event: "discord.login", tag: client.user?.tag ?? "unknown" }),
      )

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          client.destroy()
        }),
      )

      return client
    }),
  )
}
