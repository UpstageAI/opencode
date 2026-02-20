import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable } from "../../session/session.sql"
import { Project } from "../../project/project"
import { Instance } from "../../project/instance"

interface SessionStats {
  totalSessions: number
  totalMessages: number
  totalCost: number
  totalTokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
  toolUsage: Record<string, { calls: number; errors: number }>
  modelUsage: Record<
    string,
    {
      messages: number
      tokens: {
        input: number
        output: number
        cache: {
          read: number
          write: number
        }
      }
      cost: number
      toolUsage: Record<string, { calls: number; errors: number }>
    }
  >
  dateRange: {
    earliest: number
    latest: number
  }
  days: number
  costPerDay: number
  tokensPerSession: number
  medianTokensPerSession: number
}

export const StatsCommand = cmd({
  command: "stats",
  describe: "show token usage and cost statistics",
  builder: (yargs: Argv) => {
    return yargs
      .option("days", {
        describe: "show stats for the last N days (default: all time)",
        type: "number",
      })
      .option("tools", {
        describe: "number of tools to show (default: all)",
        type: "number",
      })
      .option("models", {
        describe: "show model statistics (default: hidden). Pass a number to show top N, otherwise shows all",
      })
      .option("model", {
        describe: "filter models to show (can be used multiple times)",
        type: "array",
        string: true,
      })
      .option("project", {
        describe: "filter by project (default: all projects, empty string: current project)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const stats = await aggregateSessionStats(args.days, args.project)

      let modelLimit: number | undefined
      let modelFilter: string[] | undefined

      if (args.models === true) {
        modelLimit = Infinity
      } else if (typeof args.models === "number") {
        modelLimit = args.models
      }

      if (args.model && args.model.length > 0) {
        modelFilter = args.model as string[]
        modelLimit = modelLimit ?? Infinity
      }

      displayStats(stats, args.tools, modelLimit, modelFilter)
    })
  },
})

async function getCurrentProject(): Promise<Project.Info> {
  return Instance.project
}

import { inArray } from "drizzle-orm"
import { MessageTable, PartTable } from "../../session/session.sql"
import type { MessageV2 } from "../../session/message-v2"
import { and, eq, gte } from "drizzle-orm"

export async function aggregateSessionStats(days?: number, projectFilter?: string): Promise<SessionStats> {
  const MS_IN_DAY = 24 * 60 * 60 * 1000

  const cutoffTime = (() => {
    if (days === undefined) return 0
    if (days === 0) {
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      return now.getTime()
    }
    return Date.now() - days * MS_IN_DAY
  })()

  const windowDays = (() => {
    if (days === undefined) return
    if (days === 0) return 1
    return days
  })()

  let projectID: string | undefined
  if (projectFilter !== undefined) {
    if (projectFilter === "") {
      const currentProject = await getCurrentProject()
      projectID = currentProject.id
    } else {
      projectID = projectFilter
    }
  }

  const rows = Database.use((db) => {
    const conditions = []
    if (cutoffTime > 0) {
      conditions.push(gte(SessionTable.time_updated, cutoffTime))
    }
    if (projectID !== undefined) {
      conditions.push(eq(SessionTable.project_id, projectID))
    }

    const baseQuery = db.select().from(SessionTable)
    if (conditions.length > 0) {
      return baseQuery.where(and(...conditions)).all()
    }
    return baseQuery.all()
  })

  const filteredSessions = rows.map((row) => Session.fromRow(row))

  const stats: SessionStats = {
    totalSessions: filteredSessions.length,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    toolUsage: {},
    modelUsage: {},
    dateRange: {
      earliest: Date.now(),
      latest: Date.now(),
    },
    days: 0,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }

  if (filteredSessions.length > 1000) {
    console.log(`Large dataset detected (${filteredSessions.length} sessions). This may take a while...`)
  }

  if (filteredSessions.length === 0) {
    stats.days = windowDays ?? 0
    return stats
  }

  let earliestTime = Date.now()
  let latestTime = 0

  const sessionTotalTokens: number[] = []

  const BATCH_SIZE = 100
  for (let i = 0; i < filteredSessions.length; i += BATCH_SIZE) {
    const batch = filteredSessions.slice(i, i + BATCH_SIZE)
    const sessionIds = batch.map((s) => s.id)

    // Bulk fetch messages for this batch of sessions
    const messageRows = Database.use((db) => db.select().from(MessageTable).where(inArray(MessageTable.session_id, sessionIds)).all())
    
    // Group messages by session_id
    const messagesBySession = new Map<string, typeof messageRows>()
    const messageIds = messageRows.map((r) => r.id)
    
    for (const row of messageRows) {
      const msgs = messagesBySession.get(row.session_id) || []
      msgs.push(row)
      messagesBySession.set(row.session_id, msgs)
    }

    // Bulk fetch parts for all these messages
    let partRows: typeof PartTable.$inferSelect[] = []
    if (messageIds.length > 0) {
      // Chunk message IDs if there are too many for a single IN clause (SQLite has limits)
      const PART_BATCH_SIZE = 500
      for (let j = 0; j < messageIds.length; j += PART_BATCH_SIZE) {
        const idBatch = messageIds.slice(j, j + PART_BATCH_SIZE)
        const parts = Database.use((db) => db.select().from(PartTable).where(inArray(PartTable.message_id, idBatch)).all())
        partRows.push(...parts)
      }
    }

    // Group parts by message_id
    const partsByMessage = new Map<string, MessageV2.Part[]>()
    for (const row of partRows) {
      const parts = partsByMessage.get(row.message_id) || []
      parts.push({ ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id } as MessageV2.Part)
      partsByMessage.set(row.message_id, parts)
    }

    for (const session of batch) {
      const rawMessages = messagesBySession.get(session.id) || []
      // Construct the MessageV2 objects locally instead of doing another N queries
      const messages = rawMessages.map(
        (row) =>
          ({
            id: row.id,
            sessionID: row.session_id,
            info: row.data,
            parts: partsByMessage.get(row.id) || [],
          }) as MessageV2.WithParts,
      )

      let sessionCost = 0
      let sessionTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      let sessionToolUsage: Record<string, { calls: number; errors: number }> = {}
      let sessionModelUsage: Record<
        string,
        {
          messages: number
          tokens: {
            input: number
            output: number
            cache: {
              read: number
              write: number
            }
          }
          cost: number
          toolUsage: Record<string, { calls: number; errors: number }>
        }
      > = {}

      for (const message of messages) {
        if (message.info.role === "assistant") {
          sessionCost += message.info.cost || 0

          const modelKey = `${message.info.providerID}/${message.info.modelID}`
          if (!sessionModelUsage[modelKey]) {
            sessionModelUsage[modelKey] = {
              messages: 0,
              tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              cost: 0,
              toolUsage: {},
            }
          }
          sessionModelUsage[modelKey].messages++
          sessionModelUsage[modelKey].cost += message.info.cost || 0

          if (message.info.tokens) {
            sessionTokens.input += message.info.tokens.input || 0
            sessionTokens.output += message.info.tokens.output || 0
            sessionTokens.reasoning += message.info.tokens.reasoning || 0
            sessionTokens.cache.read += message.info.tokens.cache?.read || 0
            sessionTokens.cache.write += message.info.tokens.cache?.write || 0

            sessionModelUsage[modelKey].tokens.input += message.info.tokens.input || 0
            sessionModelUsage[modelKey].tokens.output +=
              (message.info.tokens.output || 0) + (message.info.tokens.reasoning || 0)
            sessionModelUsage[modelKey].tokens.cache.read += message.info.tokens.cache?.read || 0
            sessionModelUsage[modelKey].tokens.cache.write += message.info.tokens.cache?.write || 0
          }

          for (const part of message.parts) {
            if (part.type === "tool" && part.tool) {
              const isError =
                part.state && part.state.status === "error" && part.state.error !== "Tool execution aborted"

              if (!sessionToolUsage[part.tool]) sessionToolUsage[part.tool] = { calls: 0, errors: 0 }
              sessionToolUsage[part.tool].calls++
              if (isError) sessionToolUsage[part.tool].errors++

              if (!sessionModelUsage[modelKey].toolUsage[part.tool]) {
                sessionModelUsage[modelKey].toolUsage[part.tool] = { calls: 0, errors: 0 }
              }
              sessionModelUsage[modelKey].toolUsage[part.tool].calls++
              if (isError) sessionModelUsage[modelKey].toolUsage[part.tool].errors++
            }
          }
        }
      }

      return {
        messageCount: messages.length,
        sessionCost,
        sessionTokens,
        sessionTotalTokens:
          sessionTokens.input +
          sessionTokens.output +
          sessionTokens.reasoning +
          sessionTokens.cache.read +
          sessionTokens.cache.write,
        sessionToolUsage,
        sessionModelUsage,
        earliestTime: cutoffTime > 0 ? session.time.updated : session.time.created,
        latestTime: session.time.updated,
      }
    })

    const batchResults = await Promise.all(batchPromises)

    for (const result of batchResults) {
      earliestTime = Math.min(earliestTime, result.earliestTime)
      latestTime = Math.max(latestTime, result.latestTime)
      sessionTotalTokens.push(result.sessionTotalTokens)

      stats.totalMessages += result.messageCount
      stats.totalCost += result.sessionCost
      stats.totalTokens.input += result.sessionTokens.input
      stats.totalTokens.output += result.sessionTokens.output
      stats.totalTokens.reasoning += result.sessionTokens.reasoning
      stats.totalTokens.cache.read += result.sessionTokens.cache.read
      stats.totalTokens.cache.write += result.sessionTokens.cache.write

      for (const [tool, count] of Object.entries(result.sessionToolUsage)) {
        if (!stats.toolUsage[tool]) stats.toolUsage[tool] = { calls: 0, errors: 0 }
        stats.toolUsage[tool].calls += count.calls
        stats.toolUsage[tool].errors += count.errors
      }

      for (const [model, usage] of Object.entries(result.sessionModelUsage)) {
        if (!stats.modelUsage[model]) {
          stats.modelUsage[model] = {
            messages: 0,
            tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            cost: 0,
            toolUsage: {},
          }
        }
        stats.modelUsage[model].messages += usage.messages
        stats.modelUsage[model].tokens.input += usage.tokens.input
        stats.modelUsage[model].tokens.output += usage.tokens.output
        stats.modelUsage[model].tokens.cache.read += usage.tokens.cache.read
        stats.modelUsage[model].tokens.cache.write += usage.tokens.cache.write
        stats.modelUsage[model].cost += usage.cost

        for (const [tool, toolUsage] of Object.entries(usage.toolUsage)) {
          if (!stats.modelUsage[model].toolUsage[tool]) {
            stats.modelUsage[model].toolUsage[tool] = { calls: 0, errors: 0 }
          }
          stats.modelUsage[model].toolUsage[tool].calls += toolUsage.calls
          stats.modelUsage[model].toolUsage[tool].errors += toolUsage.errors
        }
      }
    }
  }

  const rangeDays = Math.max(1, Math.ceil((latestTime - earliestTime) / MS_IN_DAY))
  const effectiveDays = windowDays ?? rangeDays
  stats.dateRange = {
    earliest: earliestTime,
    latest: latestTime,
  }
  stats.days = effectiveDays
  stats.costPerDay = stats.totalCost / effectiveDays
  const totalTokens =
    stats.totalTokens.input +
    stats.totalTokens.output +
    stats.totalTokens.reasoning +
    stats.totalTokens.cache.read +
    stats.totalTokens.cache.write
  stats.tokensPerSession = filteredSessions.length > 0 ? totalTokens / filteredSessions.length : 0
  sessionTotalTokens.sort((a, b) => a - b)
  const mid = Math.floor(sessionTotalTokens.length / 2)
  stats.medianTokensPerSession =
    sessionTotalTokens.length === 0
      ? 0
      : sessionTotalTokens.length % 2 === 0
        ? (sessionTotalTokens[mid - 1] + sessionTotalTokens[mid]) / 2
        : sessionTotalTokens[mid]

  return stats
}

export function displayStats(stats: SessionStats, toolLimit?: number, modelLimit?: number, modelFilter?: string[]) {
  const width = 56

  function renderRow(label: string, value: string): string {
    const availableWidth = width - 1
    const paddingNeeded = availableWidth - label.length - value.length
    const padding = Math.max(0, paddingNeeded)
    return `│${label}${" ".repeat(padding)}${value} │`
  }

  // Overview section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                       OVERVIEW                         │")
  console.log("├────────────────────────────────────────────────────────┤")
  console.log(renderRow("Sessions", stats.totalSessions.toLocaleString()))
  console.log(renderRow("Messages", stats.totalMessages.toLocaleString()))
  console.log(renderRow("Days", stats.days.toString()))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Cost & Tokens section
  console.log("┌────────────────────────────────────────────────────────┐")
  console.log("│                    COST & TOKENS                       │")
  console.log("├────────────────────────────────────────────────────────┤")
  const cost = isNaN(stats.totalCost) ? 0 : stats.totalCost
  const costPerDay = isNaN(stats.costPerDay) ? 0 : stats.costPerDay
  const tokensPerSession = isNaN(stats.tokensPerSession) ? 0 : stats.tokensPerSession
  console.log(renderRow("Total Cost", `$${cost.toFixed(2)}`))
  console.log(renderRow("Avg Cost/Day", `$${costPerDay.toFixed(2)}`))
  console.log(renderRow("Avg Tokens/Session", formatNumber(Math.round(tokensPerSession))))
  const medianTokensPerSession = isNaN(stats.medianTokensPerSession) ? 0 : stats.medianTokensPerSession
  console.log(renderRow("Median Tokens/Session", formatNumber(Math.round(medianTokensPerSession))))
  console.log(renderRow("Input", formatNumber(stats.totalTokens.input)))
  console.log(renderRow("Output", formatNumber(stats.totalTokens.output)))
  console.log(renderRow("Cache Read", formatNumber(stats.totalTokens.cache.read)))
  console.log(renderRow("Cache Write", formatNumber(stats.totalTokens.cache.write)))
  console.log("└────────────────────────────────────────────────────────┘")
  console.log()

  // Model Usage section
  if ((modelLimit !== undefined || modelFilter !== undefined) && Object.keys(stats.modelUsage).length > 0) {
    let sortedModels = Object.entries(stats.modelUsage).sort(([, a], [, b]) => b.messages - a.messages)

    if (modelFilter && modelFilter.length > 0) {
      sortedModels = sortedModels.filter(([model]) => modelFilter.some((filter) => model.includes(filter)))
    }

    const modelsToDisplay =
      modelLimit === Infinity || modelLimit === undefined ? sortedModels : sortedModels.slice(0, modelLimit)

    if (modelsToDisplay.length > 0) {
      console.log("┌────────────────────────────────────────────────────────┐")
      console.log("│                      MODEL USAGE                       │")
      console.log("├────────────────────────────────────────────────────────┤")

      for (const [model, usage] of modelsToDisplay) {
        console.log(`│ ${model.padEnd(54)} │`)
        console.log(renderRow("  Messages", usage.messages.toLocaleString()))
        console.log(renderRow("  Input Tokens", formatNumber(usage.tokens.input)))
        console.log(renderRow("  Output Tokens", formatNumber(usage.tokens.output)))
        console.log(renderRow("  Cache Read", formatNumber(usage.tokens.cache.read)))
        console.log(renderRow("  Cache Write", formatNumber(usage.tokens.cache.write)))
        console.log(renderRow("  Cost", `$${usage.cost.toFixed(4)}`))

        if (Object.keys(usage.toolUsage).length > 0) {
          console.log(`│                                                        │`)
          console.log(`│   Tool                        Call Rate     Error Rate │`)

          const totalModelTools = Object.values(usage.toolUsage).reduce((sum, t) => sum + t.calls, 0)
          const sortedTools = Object.entries(usage.toolUsage).sort((a, b) => b[1].calls - a[1].calls)

          for (const [tool, toolStats] of sortedTools) {
            const callRate = ((toolStats.calls / totalModelTools) * 100).toFixed(1) + "%"
            const errorRate = toolStats.calls > 0 ? ((toolStats.errors / toolStats.calls) * 100).toFixed(1) + "%" : "0%"

            const toolName = tool.length > 22 ? tool.substring(0, 20) + ".." : tool
            const paddedTool = toolName.padEnd(24)
            const callStr = callRate.padStart(13)
            const errStr = errorRate.padStart(15)

            console.log(`│   ${paddedTool}${callStr}${errStr} │`)
          }
        }

        console.log("├────────────────────────────────────────────────────────┤")
      }
      // Remove last separator and add bottom border
      process.stdout.write("\x1B[1A") // Move up one line
      console.log("└────────────────────────────────────────────────────────┘")
    }
  }
  console.log()

  // Tool Usage section
  if (Object.keys(stats.toolUsage).length > 0) {
    const sortedTools = Object.entries(stats.toolUsage).sort(([, a], [, b]) => b.calls - a.calls)
    const toolsToDisplay = toolLimit ? sortedTools.slice(0, toolLimit) : sortedTools

    console.log("┌────────────────────────────────────────────────────────┐")
    console.log("│                      TOOL USAGE                        │")
    console.log("├────────────────────────────────────────────────────────┤")

    const maxCount = Math.max(...toolsToDisplay.map(([, toolStats]) => toolStats.calls))
    const totalToolUsage = Object.values(stats.toolUsage).reduce((a, b) => a + b.calls, 0)

    for (const [tool, toolStats] of toolsToDisplay) {
      const count = toolStats.calls
      const barLength = Math.max(1, Math.floor((count / maxCount) * 20))
      const bar = "█".repeat(barLength)
      const percentage = ((count / totalToolUsage) * 100).toFixed(1)

      const maxToolLength = 18
      const truncatedTool = tool.length > maxToolLength ? tool.substring(0, maxToolLength - 2) + ".." : tool
      const toolName = truncatedTool.padEnd(maxToolLength)

      const content = ` ${toolName} ${bar.padEnd(20)} ${count.toString().padStart(3)} (${percentage.padStart(4)}%)`
      const padding = Math.max(0, width - content.length - 1)
      console.log(`│${content}${" ".repeat(padding)} │`)
    }
    console.log("└────────────────────────────────────────────────────────┘")
  }
  console.log()
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}
