import { describe, expect } from "bun:test"
import { ConfigProvider, Duration, Effect, Redacted } from "effect"
import { AppConfig } from "./config"
import { effectTest } from "./test/effect"

const provider = (input?: ReadonlyArray<readonly [string, string]>) =>
  ConfigProvider.fromMap(
    new Map([
      ["DISCORD_TOKEN", "discord-token"],
      ["DAYTONA_API_KEY", "daytona-token"],
      ["OPENCODE_ZEN_API_KEY", "zen-token"],
      ...(input ?? []),
    ]),
  )

const load = (input?: ReadonlyArray<readonly [string, string]>) =>
  Effect.gen(function* () {
    const config = yield* AppConfig
    return config
  }).pipe(
    Effect.provide(AppConfig.layer),
    Effect.withConfigProvider(provider(input)),
  )

describe("AppConfig", () => {
  effectTest("parses SANDBOX_TIMEOUT as Duration", () =>
    Effect.gen(function* () {
      const config = yield* load([["SANDBOX_TIMEOUT", "45 minutes"]])
      expect(Duration.toMinutes(config.sandboxTimeout)).toBe(45)
      expect(Redacted.value(config.discordToken)).toBe("discord-token")
    }),
  )

  effectTest("falls back to SANDBOX_TIMEOUT_MINUTES", () =>
    Effect.gen(function* () {
      const config = yield* load([["SANDBOX_TIMEOUT_MINUTES", "31"]])
      expect(Duration.toMinutes(config.sandboxTimeout)).toBe(31)
    }),
  )
})
