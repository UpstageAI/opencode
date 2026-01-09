import crypto from "crypto"

export namespace CodexAuth {
  const ISSUER = "https://auth.openai.com"
  const CLIENT_ID = "openai-codex-cli"

  // Pending OAuth sessions: state -> { verifier, redirectUri }
  const pending = new Map<string, { verifier: string; redirectUri: string }>()

  function generatePkce() {
    const verifier = crypto.randomBytes(64).toString("base64url")
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
    return { verifier, challenge }
  }

  function generateState() {
    return crypto.randomBytes(32).toString("base64url")
  }

  export function authorize(redirectUri: string) {
    const pkce = generatePkce()
    const state = generateState()

    pending.set(state, { verifier: pkce.verifier, redirectUri })

    // Clean up after 15 minutes
    setTimeout(() => pending.delete(state), 15 * 60 * 1000)

    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "opencode",
    })

    return { url: `${ISSUER}/oauth/authorize?${params}`, state }
  }

  export async function callback(code: string, state: string) {
    const session = pending.get(state)
    if (!session) throw new Error("Invalid or expired OAuth state")
    pending.delete(state)

    const resp = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: session.redirectUri,
        client_id: CLIENT_ID,
        code_verifier: session.verifier,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Token exchange failed: ${resp.status} ${text}`)
    }

    const tokens = (await resp.json()) as {
      id_token: string
      access_token: string
      refresh_token: string
      expires_in?: number
    }

    return {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    }
  }

  export async function refresh(refreshToken: string) {
    const resp = await fetch(`${ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Token refresh failed: ${resp.status} ${text}`)
    }

    const tokens = (await resp.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    return {
      access: tokens.access_token,
      refresh: tokens.refresh_token ?? refreshToken,
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    }
  }
}
