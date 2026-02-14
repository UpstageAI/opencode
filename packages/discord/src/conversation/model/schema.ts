import { Schema } from "effect"
import { ThreadId, ChannelId, GuildId } from "../../types"

export class Mention extends Schema.Class<Mention>("Mention")({
  user_ids: Schema.Array(Schema.String),
  role_ids: Schema.Array(Schema.String),
}) {}

export class ThreadMessage extends Schema.Class<ThreadMessage>("ThreadMessage")({
  kind: Schema.Literal("thread_message"),
  thread_id: ThreadId,
  channel_id: ChannelId,
  message_id: Schema.String,
  guild_id: GuildId,
  bot_user_id: Schema.String,
  bot_role_id: Schema.String,
  author_id: Schema.String,
  author_is_bot: Schema.Boolean,
  mentions_everyone: Schema.Boolean,
  mentions: Mention,
  content: Schema.String,
}) {}

export class ChannelMessage extends Schema.Class<ChannelMessage>("ChannelMessage")({
  kind: Schema.Literal("channel_message"),
  channel_id: ChannelId,
  message_id: Schema.String,
  guild_id: GuildId,
  bot_user_id: Schema.String,
  bot_role_id: Schema.String,
  author_id: Schema.String,
  author_is_bot: Schema.Boolean,
  mentions_everyone: Schema.Boolean,
  mentions: Mention,
  content: Schema.String,
}) {}

export const Inbound = Schema.Union(
  ThreadMessage,
  ChannelMessage,
)

export type Inbound = typeof Inbound.Type

export class ThreadRef extends Schema.Class<ThreadRef>("ThreadRef")({
  thread_id: ThreadId,
  channel_id: ChannelId,
}) {}

export class Send extends Schema.Class<Send>("Send")({
  kind: Schema.Literal("send"),
  thread_id: ThreadId,
  text: Schema.String,
}) {}

export class Reply extends Schema.Class<Reply>("Reply")({
  kind: Schema.Literal("reply"),
  thread_id: ThreadId,
  text: Schema.String,
}) {}

export class Typing extends Schema.Class<Typing>("Typing")({
  kind: Schema.Literal("typing"),
  thread_id: ThreadId,
}) {}

export const Action = Schema.Union(
  Send,
  Reply,
  Typing,
)

export type Action = typeof Action.Type
