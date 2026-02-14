import { Effect, Layer, Queue, Schedule, Stream } from "effect"
import { TYPING_INTERVAL } from "../../../discord/constants"
import { ChannelId, GuildId, ThreadId } from "../../../types"
import { ChannelMessage, Mention, ThreadMessage, ThreadRef, Typing, type Action, type Inbound } from "../../model/schema"
import { History, Inbox, Outbox, Threads } from "../../services"

export type Tui = {
  layer: Layer.Layer<Inbox | Outbox | History | Threads, never, never>
  send: (text: string) => Effect.Effect<void>
  sendTo: (thread_id: ThreadId, text: string) => Effect.Effect<void>
  take: Effect.Effect<Action>
  actions: Stream.Stream<Action>
}

export const makeTui = Effect.gen(function* () {
  const input = yield* Queue.unbounded<Inbound>()
  const output = yield* Queue.unbounded<Action>()
  const history = new Map<string, Array<string>>()
  const roots = new Map<string, ThreadId>()
  const parents = new Map<string, ChannelId>()
  const words = {
    a: ["brisk", "calm", "dapper", "eager", "fuzzy", "gentle", "jolly", "mellow", "nimble", "sunny"],
    b: ["otter", "falcon", "panda", "badger", "fox", "heron", "lemur", "raven", "tiger", "whale"],
  } as const
  let seq = 0

  const name = () => {
    const i = seq
    seq += 1
    const x = words.a[i % words.a.length] ?? "brisk"
    const y = words.b[Math.floor(i / words.a.length) % words.b.length] ?? "otter"
    const z = Math.floor(i / (words.a.length * words.b.length)) + 1
    return ThreadId.make(`thread-${x}-${y}-${z}`)
  }

  const remember = (thread_id: ThreadId, line: string) => {
    const current = history.get(thread_id)
    if (current) {
      current.push(line)
      return
    }
    history.set(thread_id, [line])
  }

  const sendTo = (thread_id: ThreadId, text: string) =>
    Effect.gen(function* () {
      remember(thread_id, `user: ${text}`)
      const channel_id = parents.get(thread_id) ?? ChannelId.make(`channel-${thread_id}`)
      yield* input.offer(
        ThreadMessage.make({
          kind: "thread_message",
          thread_id,
          channel_id,
          message_id: crypto.randomUUID(),
          guild_id: GuildId.make("local"),
          bot_user_id: "local-bot",
          bot_role_id: "",
          author_id: "local-user",
          author_is_bot: false,
          mentions_everyone: false,
          mentions: Mention.make({ user_ids: [], role_ids: [] }),
          content: text,
        }),
      ).pipe(Effect.asVoid)
    })

  const send = (text: string) =>
    Effect.gen(function* () {
      const channel_id = ChannelId.make("local-channel")
      yield* input.offer(
        ChannelMessage.make({
          kind: "channel_message",
          channel_id,
          message_id: crypto.randomUUID(),
          guild_id: GuildId.make("local"),
          bot_user_id: "local-bot",
          bot_role_id: "",
          author_id: "local-user",
          author_is_bot: false,
          mentions_everyone: false,
          mentions: Mention.make({ user_ids: ["local-bot"], role_ids: [] }),
          content: text,
        }),
      ).pipe(Effect.asVoid)
    })

  const layer = Layer.mergeAll(
    Layer.succeed(
      Inbox,
      Inbox.of({
        events: Stream.fromQueue(input, { shutdown: false }),
      }),
    ),
    Layer.succeed(
      Outbox,
      Outbox.of({
        publish: (action) =>
          Effect.gen(function* () {
            if (action.kind === "send" || action.kind === "reply") {
              remember(action.thread_id, `assistant: ${action.text}`)
            }
            yield* output.offer(action).pipe(Effect.asVoid)
          }),
        withTyping: <A, E, R>(thread_id: ThreadId, self: Effect.Effect<A, E, R>) =>
          Effect.scoped(
            Effect.gen(function* () {
              const pulse = output.offer(
                Typing.make({
                  kind: "typing",
                  thread_id,
                }),
              ).pipe(Effect.asVoid)
              yield* pulse
              yield* Effect.forkScoped(
                Effect.repeat(pulse, Schedule.spaced(TYPING_INTERVAL)).pipe(
                  Effect.delay(TYPING_INTERVAL),
                ),
              )
              return yield* self
            }),
          ),
      }),
    ),
    Layer.succeed(
      History,
      History.of({
        rehydrate: (thread_id, latest: string) =>
          Effect.sync(() => {
            const lines = history.get(thread_id) ?? []
            const prior = lines.at(-1) === `user: ${latest}` ? lines.slice(0, -1) : lines
            if (prior.length === 0) return latest
            return [
              "Conversation history from this same thread (oldest to newest):",
              prior.join("\n"),
              "",
              "Continue the same conversation and respond to the latest user message:",
              latest,
            ].join("\n")
          }),
      }),
    ),
    Layer.succeed(
      Threads,
      Threads.of({
        ensure: (event) =>
          Effect.sync(() => {
            if (event.kind === "thread_message") {
              parents.set(event.thread_id, event.channel_id)
              return ThreadRef.make({ thread_id: event.thread_id, channel_id: event.channel_id })
            }
            const known = roots.get(event.message_id)
            if (known) return ThreadRef.make({ thread_id: known, channel_id: event.channel_id })
            const thread_id = name()
            roots.set(event.message_id, thread_id)
            parents.set(thread_id, event.channel_id)
            return ThreadRef.make({ thread_id, channel_id: event.channel_id })
          }),
      }),
    ),
  )

  return {
    layer,
    send,
    sendTo,
    take: output.take,
    actions: Stream.fromQueue(output, { shutdown: false }),
  } satisfies Tui
})
