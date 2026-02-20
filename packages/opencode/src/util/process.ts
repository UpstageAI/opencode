import { spawn as childSpawn } from "child_process"
import { Readable } from "stream"

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    signal?: AbortSignal
  }

  export interface Child {
    stdin: NodeJS.WritableStream | null
    stdout: ReadableStream<Uint8Array> | null
    stderr: ReadableStream<Uint8Array> | null
    exited: Promise<number>
    kill(signal?: NodeJS.Signals | number): boolean
    readonly exitCode: number | null
    readonly pid: number | undefined
  }

  export function spawn(cmd: string[], options: Options = {}): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    options.signal?.throwIfAborted()

    const proc = childSpawn(cmd[0], cmd.slice(1), {
      cwd: options.cwd,
      env: options.env,
      stdio: [options.stdin ?? "ignore", options.stdout ?? "inherit", options.stderr ?? "inherit"],
    })

    const abort = () => {
      if (proc.killed) return
      proc.kill()
    }

    const code = { value: null as number | null }
    const exited = new Promise<number>((resolve, reject) => {
      const done = () => options.signal?.removeEventListener("abort", abort)
      proc.once("exit", (exitCode, signal) => {
        done()
        code.value = exitCode ?? (signal ? 1 : 0)
        resolve(code.value)
      })
      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })

    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true })
    }

    return {
      stdin: proc.stdin,
      stdout: proc.stdout ? (Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>) : null,
      stderr: proc.stderr ? (Readable.toWeb(proc.stderr) as unknown as ReadableStream<Uint8Array>) : null,
      exited,
      kill: (signal) => proc.kill(signal),
      get exitCode() {
        return code.value ?? proc.exitCode
      },
      get pid() {
        return proc.pid
      },
    }
  }
}
