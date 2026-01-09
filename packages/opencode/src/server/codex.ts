import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "./error"
import { Auth } from "@/auth"
import { CodexAuth } from "@/codex/auth"

export const CodexRoute = new Hono()
  .post(
    "/auth/authorize",
    describeRoute({
      summary: "Start Codex OAuth",
      description: "Initiate OAuth flow for Codex/ChatGPT authentication. Returns URL to open in browser.",
      operationId: "codex.auth.authorize",
      responses: {
        200: {
          description: "Authorization URL and state",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  url: z.string(),
                  state: z.string(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "query",
      z.object({
        port: z.coerce.number().optional(),
      }),
    ),
    async (c) => {
      // Get port from request URL since we can't import Server (circular dep)
      const url = new URL(c.req.url)
      const port = c.req.valid("query").port ?? url.port ?? 4096
      const redirectUri = `http://localhost:${port}/codex/auth/callback`
      const result = CodexAuth.authorize(redirectUri)
      return c.json(result)
    },
  )
  .get(
    "/auth/callback",
    describeRoute({
      summary: "Codex OAuth callback",
      description: "Handle OAuth callback from ChatGPT auth. Called by browser after user authenticates.",
      operationId: "codex.auth.callback",
      responses: {
        200: {
          description: "Success page",
          content: {
            "text/html": {},
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "query",
      z.object({
        code: z.string(),
        state: z.string(),
      }),
    ),
    async (c) => {
      const query = c.req.valid("query")
      const tokens = await CodexAuth.callback(query.code, query.state)

      await Auth.set("codex", {
        type: "oauth",
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
      })

      return c.html(`<!DOCTYPE html>
<html>
<head><title>Login Successful</title></head>
<body style="font-family: system-ui; text-align: center; padding: 50px; background: #1a1a1a; color: #fff;">
  <h1>Login Successful</h1>
  <p>You can close this window and return to OpenCode.</p>
</body>
</html>`)
    },
  )
  .post(
    "/auth/refresh",
    describeRoute({
      summary: "Refresh Codex tokens",
      description: "Refresh the Codex access token using the stored refresh token.",
      operationId: "codex.auth.refresh",
      responses: {
        200: {
          description: "Tokens refreshed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const existing = await Auth.get("codex")
      if (!existing || existing.type !== "oauth") {
        throw new Error("No Codex OAuth credentials found")
      }

      const tokens = await CodexAuth.refresh(existing.refresh)

      await Auth.set("codex", {
        type: "oauth",
        access: tokens.access,
        refresh: tokens.refresh,
        expires: tokens.expires,
      })

      return c.json(true)
    },
  )
  .get(
    "/auth/status",
    describeRoute({
      summary: "Get Codex auth status",
      description: "Check if Codex OAuth credentials exist and whether they're expired.",
      operationId: "codex.auth.status",
      responses: {
        200: {
          description: "Auth status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  authenticated: z.boolean(),
                  expired: z.boolean().optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const existing = await Auth.get("codex")
      if (!existing || existing.type !== "oauth") {
        return c.json({ authenticated: false })
      }
      return c.json({
        authenticated: true,
        expired: existing.expires < Date.now(),
      })
    },
  )
  .delete(
    "/auth",
    describeRoute({
      summary: "Remove Codex auth",
      description: "Remove stored Codex OAuth credentials.",
      operationId: "codex.auth.remove",
      responses: {
        200: {
          description: "Auth removed",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    async (c) => {
      await Auth.remove("codex")
      return c.json(true)
    },
  )
