import { $ } from "bun"
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const PullRequest = z
  .object({
    number: z.number(),
    state: z.string(),
    headRefName: z.string(),
    url: z.string(),
    mergedAt: z.string().nullable(),
  })
  .meta({ ref: "PullRequest" })

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(await ToolRegistry.ids())
      },
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools({ providerID: provider, modelID: model })
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            // Handle both Zod schemas and plain JSON schemas
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await Worktree.create(body)
        return c.json(worktree)
      },
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await Project.sandboxes(Instance.project.id)
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.remove.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.remove(body)
        await Project.removeSandbox(Instance.project.id, body.directory)
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.reset.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.reset(body)
        return c.json(true)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.resources())
      },
    )
    .get(
      "/git-remote",
      describeRoute({
        summary: "Get git remote URL",
        description: "Get the origin remote URL for the current project.",
        operationId: "git.remote",
        responses: {
          200: {
            description: "Git remote URL",
            content: {
              "application/json": {
                schema: resolver(z.object({ url: z.string() }).meta({ ref: "GitRemote" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = await $`git remote get-url origin`.quiet().nothrow().cwd(Instance.worktree)
        if (result.exitCode !== 0) return c.json({ url: "" })
        const raw = new TextDecoder().decode(result.stdout).trim()
        // normalize git@github.com:org/repo.git → org/repo
        const cleaned = raw
          .replace(/\.git$/, "")
          .replace(/^git@github\.com:/, "")
          .replace(/^https?:\/\/github\.com\//, "")
        return c.json({ url: cleaned })
      },
    )
    .get(
      "/pr",
      describeRoute({
        summary: "List pull requests",
        description: "List pull requests for specific branches via gh CLI.",
        operationId: "pr.list",
        responses: {
          200: {
            description: "Pull requests",
            content: {
              "application/json": {
                schema: resolver(z.array(PullRequest)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          branches: z.string().optional(),
          directory: z.string().optional(),
        }),
      ),
      async (c) => {
        const { branches, directory } = c.req.valid("query")
        if (!branches) return c.json([])
        const names = branches.split(",").filter(Boolean)
        if (!names.length) return c.json([])
        const cwd = directory || Instance.worktree
        const results = await Promise.all(
          names.map(async (branch) => {
            const result =
              await $`gh pr list --head ${branch} --json number,state,headRefName,url,mergedAt --state all --limit 1`
                .quiet()
                .nothrow()
                .cwd(cwd)
            if (result.exitCode !== 0) return []
            const text = new TextDecoder().decode(result.stdout).trim()
            if (!text) return []
            const parsed = z.array(PullRequest).safeParse(JSON.parse(text))
            return parsed.success ? parsed.data : []
          }),
        )
        return c.json(results.flat())
      },
    ),
)
