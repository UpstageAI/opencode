import { Schema } from "effect"

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"))
export type ThreadId = typeof ThreadId.Type

export const ChannelId = Schema.String.pipe(Schema.brand("ChannelId"))
export type ChannelId = typeof ChannelId.Type

export const GuildId = Schema.String.pipe(Schema.brand("GuildId"))
export type GuildId = typeof GuildId.Type

export const SandboxId = Schema.String.pipe(Schema.brand("SandboxId"))
export type SandboxId = typeof SandboxId.Type

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

export const SessionStatus = Schema.Literal(
  "creating",
  "active",
  "pausing",
  "paused",
  "resuming",
  "destroying",
  "destroyed",
  "error",
)
export type SessionStatus = typeof SessionStatus.Type

/**
 * Daytona preview link — the URL + token from `sandbox.getPreviewLink()`.
 *
 * This is Daytona's canonical way to reach a port inside a sandbox over HTTP.
 * Used by {@link OpenCodeClient} to talk to the OpenCode server on port 4096.
 */
export class PreviewAccess extends Schema.Class<PreviewAccess>("PreviewAccess")({
  /** Daytona preview URL (HTTP tunnel into the sandbox). */
  previewUrl: Schema.String,
  /** Auth token for the preview link. May be embedded in the URL as `?tkn=`. */
  previewToken: Schema.Union(Schema.Null, Schema.String),
}) {
  /** Derive from anything carrying `previewUrl` + `previewToken` (e.g. SandboxHandle, SessionInfo). */
  static from(source: { previewUrl: string; previewToken: string | null }) {
    return PreviewAccess.make({ previewUrl: source.previewUrl, previewToken: source.previewToken })
  }
}

export class SessionInfo extends Schema.Class<SessionInfo>("SessionInfo")({
  threadId: ThreadId,
  channelId: ChannelId,
  guildId: GuildId,
  sandboxId: SandboxId,
  sessionId: SessionId,
  previewUrl: Schema.String,
  previewToken: Schema.Union(Schema.Null, Schema.String),
  status: SessionStatus,
  lastError: Schema.Union(Schema.Null, Schema.String),
  resumeFailCount: Schema.Number,
}) {
  withStatus(status: SessionStatus) {
    return SessionInfo.make({ ...this, status })
  }
}
