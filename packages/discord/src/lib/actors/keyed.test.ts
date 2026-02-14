import { describe, expect } from "bun:test"
import { Effect, Either, Exit, Option, Ref, Schema } from "effect"
import { effectTest } from "../../test/effect"
import { ActorMap } from "./keyed"

class LoadTestError extends Schema.TaggedError<LoadTestError>()("LoadTestError", {
  message: Schema.String,
}) {}

describe("ActorMap", () => {
  effectTest("serializes work for the same key", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const keyed = yield* ActorMap.make<string>()

      const one = keyed.run(
        "t1",
        Effect.gen(function* () {
          log.push("one:start")
          yield* Effect.sleep("40 millis")
          log.push("one:end")
          return "one"
        }),
      )
      const two = keyed.run(
        "t1",
        Effect.gen(function* () {
          log.push("two:start")
          log.push("two:end")
          return "two"
        }),
      )

      const out = yield* Effect.all([one, two], { concurrency: "unbounded" })
      expect(out).toEqual(["one", "two"])
      expect(log).toEqual(["one:start", "one:end", "two:start", "two:end"])
    }),
  )

  effectTest("allows different keys to run concurrently", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const keyed = yield* ActorMap.make<string>()

      const slow = keyed.run(
        "a",
        Effect.gen(function* () {
          log.push("a:start")
          yield* Effect.sleep("50 millis")
          log.push("a:end")
        }),
      )
      const fast = keyed.run(
        "b",
        Effect.gen(function* () {
          log.push("b:start")
          log.push("b:end")
        }),
      )

      yield* Effect.all([slow, fast], { concurrency: "unbounded" })
      expect(log.indexOf("b:end")).toBeLessThan(log.indexOf("a:end"))
    }),
  )

  effectTest("triggers idle callback once after inactivity", () =>
    Effect.gen(function* () {
      const n = yield* Ref.make(0)
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "30 millis",
        onIdle: () => Ref.update(n, (x) => x + 1),
      })

      yield* keyed.run("t1", Effect.void)
      yield* Effect.sleep("80 millis")
      expect(yield* Ref.get(n)).toBe(1)
    }),
  )

  effectTest("touch extends idle deadline", () =>
    Effect.gen(function* () {
      const n = yield* Ref.make(0)
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "40 millis",
        onIdle: () => Ref.update(n, (x) => x + 1),
      })

      yield* keyed.run("t1", Effect.void)
      yield* Effect.sleep("25 millis")
      yield* keyed.touch("t1")
      yield* Effect.sleep("25 millis")
      expect(yield* Ref.get(n)).toBe(0)
      yield* Effect.sleep("40 millis")
      expect(yield* Ref.get(n)).toBe(1)
    }),
  )

  effectTest("run can skip idle touch", () =>
    Effect.gen(function* () {
      const n = yield* Ref.make(0)
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "25 millis",
        onIdle: () => Ref.update(n, (x) => x + 1),
      })

      yield* keyed.run("t1", Effect.void, { touch: false })
      yield* Effect.sleep("40 millis")
      expect(yield* Ref.get(n)).toBe(0)
      yield* keyed.touch("t1")
      yield* Effect.sleep("40 millis")
      expect(yield* Ref.get(n)).toBe(1)
    }),
  )

  effectTest("remove clears entry and allows recreation", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string>()

      yield* keyed.run("t1", Effect.void)
      expect(yield* keyed.size).toBe(1)
      yield* keyed.remove("t1")
      expect(yield* keyed.size).toBe(0)
      yield* keyed.run("t1", Effect.succeed("ok"))
      expect(yield* keyed.size).toBe(1)
    }),
  )

  effectTest("failure does not poison the key queue", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string>()

      const first = yield* keyed.run("t1", Effect.fail("boom")).pipe(Effect.either)
      expect(Either.isLeft(first)).toBe(true)
      if (Either.isLeft(first)) {
        expect(first.left).toBe("boom")
      }

      const second = yield* keyed.run("t1", Effect.succeed("ok"))
      expect(second).toBe("ok")
    }),
  )

  effectTest("cancelIdle cancels the pending idle timer", () =>
    Effect.gen(function* () {
      const n = yield* Ref.make(0)
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "25 millis",
        onIdle: () => Ref.update(n, (x) => x + 1),
      })

      yield* keyed.run("t1", Effect.void)
      yield* keyed.cancelIdle("t1")
      yield* Effect.sleep("60 millis")
      expect(yield* Ref.get(n)).toBe(0)
    }),
  )

  effectTest("stop removes all keys and cancels all idle timers", () =>
    Effect.gen(function* () {
      const n = yield* Ref.make(0)
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "30 millis",
        onIdle: () => Ref.update(n, (x) => x + 1),
      })

      yield* Effect.all(
        [
          keyed.run("t1", Effect.void),
          keyed.run("t2", Effect.void),
        ],
        { concurrency: "unbounded" },
      )
      expect(yield* keyed.size).toBe(2)

      yield* keyed.stop
      expect(yield* keyed.size).toBe(0)
      yield* Effect.sleep("70 millis")
      expect(yield* Ref.get(n)).toBe(0)

      yield* keyed.run("t1", Effect.void)
      expect(yield* keyed.size).toBe(1)
    }),
  )

  effectTest("touch and cancelIdle on unknown key are no-ops", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string>({
        idleTimeout: "20 millis",
        onIdle: () => Effect.void,
      })

      yield* keyed.touch("missing")
      yield* keyed.cancelIdle("missing")
      expect(yield* keyed.size).toBe(0)
    }),
  )

  effectTest("remove on unknown key is a no-op", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string>()
      yield* keyed.remove("missing")
      expect(yield* keyed.size).toBe(0)
    }),
  )

  effectTest("remove interrupts in-flight run calls", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string>()

      const fiber = yield* keyed
        .run(
          "t1",
          Effect.gen(function* () {
            yield* Effect.sleep("5 seconds")
            return "should not reach"
          }),
        )
        .pipe(Effect.fork)

      // Give the job time to start executing on the worker fiber
      yield* Effect.sleep("20 millis")
      yield* keyed.remove("t1")
      expect(yield* keyed.size).toBe(0)

      const exit = yield* fiber.await
      expect(Exit.isInterrupted(exit)).toBe(true)
    }),
  )
})

describe("ActorMap (stateful)", () => {
  effectTest("load hydrates state on first activation", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, number>({
        load: (key) => Effect.succeed(key === "a" ? Option.some(42) : Option.none()),
      })

      const result = yield* keyed.run("a", (state) =>
        Ref.get(state).pipe(Effect.map((s) => Option.isSome(s) ? s.value : -1)),
      )
      expect(result).toBe(42)

      const result2 = yield* keyed.run("b", (state) =>
        Ref.get(state).pipe(Effect.map((s) => Option.isSome(s) ? s.value : -1)),
      )
      expect(result2).toBe(-1)
    }),
  )

  effectTest("save is called when state changes during run", () =>
    Effect.gen(function* () {
      const saved: Array<[string, number]> = []
      const keyed = yield* ActorMap.make<string, number>({
        save: (key, value) =>
          Effect.sync(() => {
            saved.push([key, value])
          }),
      })

      yield* keyed.run("a", (state) => Ref.set(state, Option.some(10)))
      expect(saved).toEqual([["a", 10]])
    }),
  )

  effectTest("save is not called when state is unchanged", () =>
    Effect.gen(function* () {
      const saved: Array<[string, number]> = []
      const keyed = yield* ActorMap.make<string, number>({
        load: () => Effect.succeed(Option.some(5)),
        save: (key, value) =>
          Effect.sync(() => {
            saved.push([key, value])
          }),
      })

      // Run without touching state
      yield* keyed.run("a", (_state) => Effect.succeed("noop"))
      expect(saved).toEqual([])
    }),
  )

  effectTest("getState returns current state for existing key", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, number>({
        load: () => Effect.succeed(Option.some(99)),
      })

      yield* keyed.run("a", Effect.void)
      const result = yield* keyed.getState("a")
      expect(result).toEqual(Option.some(99))
    }),
  )

  effectTest("getState returns None for unknown key", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, number>()
      const result = yield* keyed.getState("missing")
      expect(result).toEqual(Option.none())
    }),
  )

  effectTest("stateful run with function receives state ref", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, string>()

      yield* keyed.run("a", (state) => Ref.set(state, Option.some("hello")))
      const result = yield* keyed.getState("a")
      expect(result).toEqual(Option.some("hello"))

      const read = yield* keyed.run("a", (state) =>
        Ref.get(state).pipe(Effect.map((s) => Option.isSome(s) ? s.value : "")),
      )
      expect(read).toBe("hello")
    }),
  )

  effectTest("stateless run still works with stateful actor map", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, number>()

      const result = yield* keyed.run("a", Effect.succeed(42))
      expect(result).toBe(42)
    }),
  )

  effectTest("load error falls back to None", () =>
    Effect.gen(function* () {
      const keyed = yield* ActorMap.make<string, number>({
        load: () => Effect.fail(LoadTestError.make({ message: "db down" })),
      })

      const result = yield* keyed.run("a", (state) =>
        Ref.get(state).pipe(Effect.map(Option.isNone)),
      )
      expect(result).toBe(true)
    }),
  )
})
