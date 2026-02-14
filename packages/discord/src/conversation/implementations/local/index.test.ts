import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Option } from "effect"
import { TurnRouter, TurnRoutingDecision } from "../../../discord/turn-routing"
import { ThreadAgentPool, type ThreadAgent } from "../../../sandbox/pool"
import { effectTest, testConfigLayer } from "../../../test/effect"
import { ChannelId, GuildId, SandboxId, SessionId, SessionInfo, ThreadId } from "../../../types"
import { Conversation } from "../../services/conversation"
import { ConversationLedger } from "../../services/ledger"
import { makeTui } from "./index"

const makeSession = (id: string) =>
  SessionInfo.make({
    threadId: ThreadId.make("thread-local-channel"),
    channelId: ChannelId.make("local-channel"),
    guildId: GuildId.make("local"),
    sandboxId: SandboxId.make("sb1"),
    sessionId: SessionId.make(id),
    previewUrl: "https://preview",
    previewToken: null,
    status: "active",
    lastError: null,
    resumeFailCount: 0,
  })

const routerLayer = Layer.succeed(
  TurnRouter,
  TurnRouter.of({
    shouldRespond: () =>
      Effect.succeed(TurnRoutingDecision.make({ shouldRespond: true, reason: "test" })),
    generateThreadName: () => Effect.succeed("unused"),
  }),
)

const makePoolLayer = (opts: {
  getOrCreate?: ThreadAgentPool.Service["getOrCreate"]
  send?: (prompt: string) => string
  seen?: Array<string>
  gate?: Deferred.Deferred<void>
}) => {
  const session = makeSession("s1")
  const seen = opts.seen ?? []
  const defaultGetOrCreate: ThreadAgentPool.Service["getOrCreate"] = () =>
    Effect.gen(function* () {
      if (opts.gate) yield* Deferred.await(opts.gate)
      return {
        threadId: session.threadId,
        session,
        current: () => Effect.succeed(session),
        send: (prompt: string) =>
          Effect.sync(() => {
            seen.push(prompt)
            return opts.send ? opts.send(prompt) : `local:${prompt}`
          }),
        pause: () => Effect.void,
        destroy: () => Effect.void,
      } satisfies ThreadAgent
    })

  return Layer.succeed(
    ThreadAgentPool,
    ThreadAgentPool.of({
      getOrCreate: opts.getOrCreate ?? defaultGetOrCreate,
      hasTrackedThread: () => Effect.succeed(true),
      getTrackedSession: () => Effect.succeed(Option.none()),
      getActiveSessionCount: () => Effect.succeed(0),
      pauseSession: () => Effect.void,
      destroySession: () => Effect.void,
    }),
  )
}

describe("makeTui", () => {
  effectTest("drives conversation locally without Discord", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const tui = yield* makeTui
      const poolLayer = makePoolLayer({ seen })

      const live = Conversation.layer.pipe(
        Layer.provideMerge(tui.layer),
        Layer.provideMerge(ConversationLedger.noop),
        Layer.provideMerge(routerLayer),
        Layer.provideMerge(poolLayer),
        Layer.provideMerge(testConfigLayer),
      )

      yield* Effect.gen(function* () {
        const conversation = yield* Conversation
        yield* Effect.forkScoped(conversation.run)

        yield* tui.send("hello local")

        const first = yield* tui.take
        const second = yield* tui.take

        expect(seen).toEqual(["hello local"])
        expect(first.kind).toBe("typing")
        expect(second.kind).toBe("send")
        expect(/^thread-[a-z]+-[a-z]+-\d+$/.test(String(second.thread_id))).toBe(true)
        if (second.kind === "send") expect(second.text).toBe("local:hello local")
      }).pipe(Effect.provide(live))
    }),
  )

  effectTest("publishes typing before session resolution completes", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>()
      const tui = yield* makeTui
      const poolLayer = makePoolLayer({ gate })

      const live = Conversation.layer.pipe(
        Layer.provideMerge(tui.layer),
        Layer.provideMerge(ConversationLedger.noop),
        Layer.provideMerge(routerLayer),
        Layer.provideMerge(poolLayer),
        Layer.provideMerge(testConfigLayer),
      )

      yield* Effect.gen(function* () {
        const conversation = yield* Conversation
        yield* Effect.forkScoped(conversation.run)

        yield* tui.send("hello local")
        const first = yield* tui.take
        expect(first.kind).toBe("typing")

        yield* Deferred.succeed(gate, undefined)
        const second = yield* tui.take
        expect(second.kind).toBe("send")
      }).pipe(Effect.provide(live))
    }),
  )

  effectTest("channel messages create distinct threads", () =>
    Effect.gen(function* () {
      const tui = yield* makeTui
      const poolLayer = makePoolLayer({})

      const live = Conversation.layer.pipe(
        Layer.provideMerge(tui.layer),
        Layer.provideMerge(ConversationLedger.noop),
        Layer.provideMerge(routerLayer),
        Layer.provideMerge(poolLayer),
        Layer.provideMerge(testConfigLayer),
      )

      yield* Effect.gen(function* () {
        const conversation = yield* Conversation
        yield* Effect.forkScoped(conversation.run)

        yield* tui.send("one")
        const firstTyping = yield* tui.take
        const firstSend = yield* tui.take

        yield* tui.send("two")
        const secondTyping = yield* tui.take
        const secondSend = yield* tui.take

        expect(firstTyping.kind).toBe("typing")
        expect(firstSend.kind).toBe("send")
        expect(secondTyping.kind).toBe("typing")
        expect(secondSend.kind).toBe("send")
        if (firstTyping.kind === "typing" && secondTyping.kind === "typing") {
          expect(firstTyping.thread_id === secondTyping.thread_id).toBe(false)
        }
      }).pipe(Effect.provide(live))
    }),
  )
})
