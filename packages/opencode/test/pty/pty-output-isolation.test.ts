import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const input = (connection: string, data: string) => {
  const channel = encoder.encode(connection)
  const body = encoder.encode(data)
  const out = new Uint8Array(2 + channel.length + body.length)
  out[0] = 2
  out[1] = channel.length
  out.set(channel, 2)
  out.set(body, 2 + channel.length)
  return out
}

const output = (connection: string, data: unknown) => {
  if (typeof data === "string") return data
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) return ""
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes[0] !== 1) return ""
  const size = bytes[1]
  if (!Number.isSafeInteger(size) || size < 0) return ""
  if (bytes.length < 2 + size) return ""
  const id = decoder.decode(bytes.subarray(2, 2 + size))
  if (id !== connection) return ""
  return decoder.decode(bytes.subarray(2 + size))
}

const spawn = () => {
  let pid = 1000
  return () => {
    const data = new Set<(chunk: string) => void>()
    const exit = new Set<(event: { exitCode: number }) => void>()
    let closed = false

    return {
      pid: ++pid,
      onData: (cb: (chunk: string) => void) => {
        data.add(cb)
      },
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exit.add(cb)
      },
      resize: () => {},
      write: (chunk: string) => {
        if (closed) return
        for (const cb of data) cb(chunk)
      },
      kill: () => {
        if (closed) return
        closed = true
        for (const cb of exit) cb({ exitCode: 0 })
      },
    }
  }
}

describe("pty", () => {
  beforeEach(() => {
    Pty.setSpawn(spawn() as unknown as Parameters<typeof Pty.setSpawn>[0])
  })

  afterEach(() => {
    Pty.setSpawn()
  })

  test("does not leak output when websocket objects are reused", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ command: "cat", title: "a" })
        const b = await Pty.create({ command: "cat", title: "b" })
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            send: (data: unknown) => {
              const text = output("conn-a", data)
              if (text) outA.push(text)
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first with ws.
          Pty.connect(a.id, ws as any, undefined, "conn-a")

          // Now "reuse" the same ws object for another connection.
          ws.send = (data: unknown) => {
            const text = output("conn-b", data)
            if (text) outB.push(text)
          }
          Pty.connect(b.id, ws as any, undefined, "conn-b")

          // Clear connect metadata writes.
          outA.length = 0
          outB.length = 0

          // Output from a must never show up in b.
          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
          await Pty.remove(b.id)
        }
      },
    })
  })

  test("does not leak output when websocket objects are recycled before re-connect", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ command: "cat", title: "a" })
        try {
          const outA: string[] = []
          const outB: string[] = []

          const ws = {
            readyState: 1,
            send: (data: unknown) => {
              const text = output("conn-a", data)
              if (text) outA.push(text)
            },
            close: () => {
              // no-op (simulate abrupt drop)
            },
          }

          // Connect "a" first.
          Pty.connect(a.id, ws as any, undefined, "conn-a")
          outA.length = 0

          // Simulate websocket object reuse for another connection before
          // the next onOpen calls Pty.connect.
          ws.send = (data: unknown) => {
            const text = output("conn-b", data)
            if (text) outB.push(text)
          }

          Pty.write(a.id, "AAA\n")
          await Bun.sleep(100)

          expect(outB.join("")).not.toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })

  test("drops input frames that carry a different connection id", async () => {
    await using dir = await tmpdir({ git: true })

    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const a = await Pty.create({ command: "cat", title: "a" })
        try {
          const out: string[] = []

          const ws = {
            readyState: 1,
            send: (data: unknown) => {
              const text = output("conn-a", data)
              if (text) out.push(text)
            },
            close: () => {
              // no-op
            },
          }

          const handler = Pty.connect(a.id, ws as any, undefined, "conn-a")
          out.length = 0

          handler?.onMessage(input("conn-b", "BBB\n"))
          await Bun.sleep(100)
          expect(out.join("")).not.toContain("BBB")

          handler?.onMessage(input("conn-a", "AAA\n"))
          await Bun.sleep(100)
          expect(out.join("")).toContain("AAA")
        } finally {
          await Pty.remove(a.id)
        }
      },
    })
  })
})
