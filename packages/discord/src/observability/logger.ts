import { Layer, Logger, LogLevel } from "effect"

export const LoggerLive = Layer.merge(
  Logger.replace(Logger.defaultLogger, Logger.jsonLogger),
  Logger.minimumLogLevel(LogLevel.Debug),
)
