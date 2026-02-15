import path from "path"
import { mkdir, stat } from "fs/promises"
import { createHash } from "crypto"
import { Global } from "../global"
import { Config } from "../config/config"
import { Log } from "../util/log"
import { git } from "../util/git"
import { Instance } from "../project/instance"

export namespace Reference {
  const log = Log.create({ service: "reference" })

  const STALE_THRESHOLD_MS = 60 * 60 * 1000

  export interface Info {
    url: string
    path: string
    branch?: string
    type: "git" | "local"
  }

  function hashUrl(url: string): string {
    return createHash("sha256").update(url).digest("hex").slice(0, 16)
  }

  export function parse(url: string): Info {
    if (url.startsWith("/") || url.startsWith("~") || url.startsWith(".")) {
      const resolved = url.startsWith("~")
        ? path.join(Global.Path.home, url.slice(1))
        : url.startsWith(".")
          ? path.resolve(Instance.worktree, url)
          : url
      return {
        url,
        path: resolved,
        type: "local",
      }
    }

    const branchMatch = url.match(/^(.+)#(.+)$/)
    const gitUrl = branchMatch ? branchMatch[1] : url
    const branch = branchMatch ? branchMatch[2] : undefined

    return {
      url: gitUrl,
      path: path.join(Global.Path.reference, hashUrl(gitUrl)),
      branch,
      type: "git",
    }
  }

  export async function isStale(ref: Info): Promise<boolean> {
    if (ref.type === "local") return false

    const fetchHead = path.join(ref.path, ".git", "FETCH_HEAD")
    const s = await stat(fetchHead).catch(() => null)
    if (!s) return true

    return Date.now() - s.mtime.getTime() > STALE_THRESHOLD_MS
  }

  export async function fetch(ref: Info): Promise<boolean> {
    if (ref.type === "local") {
      const exists = await stat(ref.path).catch(() => null)
      if (!exists?.isDirectory()) {
        log.error("local reference not found", { path: ref.path })
        return false
      }
      return true
    }

    await mkdir(path.dirname(ref.path), { recursive: true })

    const isCloned = await stat(path.join(ref.path, ".git")).catch(() => null)

    if (!isCloned) {
      log.info("cloning reference", { url: ref.url, branch: ref.branch })
      const args = ["clone", "--depth", "1"]
      if (ref.branch) {
        args.push("--branch", ref.branch)
      }
      args.push(ref.url, ref.path)

      const result = await git(args, { cwd: Global.Path.reference })
      if (result.exitCode !== 0) {
        log.error("failed to clone", { url: ref.url, stderr: result.stderr.toString() })
        return false
      }
      return true
    }

    log.info("fetching reference", { url: ref.url })
    const fetchResult = await git(["fetch"], { cwd: ref.path })
    if (fetchResult.exitCode !== 0) {
      log.warn("failed to fetch, using cached", { url: ref.url })
      return true
    }

    if (ref.branch) {
      const checkoutResult = await git(["checkout", ref.branch], { cwd: ref.path })
      if (checkoutResult.exitCode !== 0) {
        log.warn("failed to checkout branch, using current", { url: ref.url, branch: ref.branch })
      }
    }

    return true
  }

  export async function ensureFresh(ref: Info): Promise<Info | null> {
    if (await isStale(ref)) {
      const success = await fetch(ref)
      if (!success && ref.type === "git") {
        const exists = await stat(ref.path).catch(() => null)
        if (!exists) return null
      }
    }
    return ref
  }

  export async function list(): Promise<Info[]> {
    const cfg = await Config.get()
    const urls = cfg.references ?? []
    return urls.map(parse)
  }

  export async function directories(): Promise<string[]> {
    const refs = await list()
    const fresh = await Promise.all(refs.map(ensureFresh))
    return fresh.filter(Boolean).map((r) => r!.path)
  }
}
