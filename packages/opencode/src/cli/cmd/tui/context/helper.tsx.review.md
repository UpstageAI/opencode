# Review: `packages/opencode/src/cli/cmd/tui/context/helper.tsx`

## Summary

This is a small (26-line) utility file with a focused purpose: factory for SolidJS context providers with an optional "ready gate." The code is mostly clean, but there are a few issues — one is a real bug, one is a style violation, and the rest are minor readability improvements.

---

## Issues

### 1. Bug: `.ready` gate is not reactive (line 14)

The `init.ready` property is accessed directly inside JSX, but in every consumer (`local.tsx:209`, `theme.tsx:387`), `ready` is defined as a getter (`get ready() { return store.ready }`). Because `init.ready` is read once outside a tracking scope and passed to `<Show when={...}>`, it won't re-evaluate when the underlying store changes. This means if `ready` starts as `false`, the children will never appear.

The UI package's version of this same helper (`packages/ui/src/context/helper.tsx`) already fixes this correctly by wrapping the access in a `createMemo`:

```tsx
// Before (line 12-17)
const init = input.init(props)
return (
  // @ts-expect-error
  <Show when={init.ready === undefined || init.ready === true}>
    <ctx.Provider value={init}>{props.children}</ctx.Provider>
  </Show>
)
```

```tsx
// After
const init = input.init(props)
const ready = createMemo(() => {
  // @ts-expect-error
  const r = init.ready as boolean | undefined
  return r === undefined || r === true
})
return (
  <Show when={ready()}>
    <ctx.Provider value={init}>{props.children}</ctx.Provider>
  </Show>
)
```

**Why:** Without wrapping in `createMemo`, SolidJS has no way to track the getter. The `<Show when={...}>` receives a static `true`/`false` value at creation time and never updates. This is the most important issue in the file — it's a correctness bug, not just style.

---

### 2. Use `Record<string, any>` — violates `any` avoidance (line 3)

The generic constraint `Props extends Record<string, any>` uses `any`. This is noted in the style guide as something to avoid.

```tsx
// Before (line 3)
export function createSimpleContext<T, Props extends Record<string, any>>(input: {
```

```tsx
// After
export function createSimpleContext<T, Props extends Record<string, unknown>>(input: {
```

**Why:** `Record<string, unknown>` is safer and still permits arbitrary prop shapes. `unknown` forces consumers to narrow before use, which is the whole point of TypeScript.

---

### 3. `@ts-expect-error` is too broad (line 13)

A bare `@ts-expect-error` suppresses all errors on the next line with no explanation of what's being suppressed or why.

```tsx
// Before (line 13-14)
// @ts-expect-error
<Show when={init.ready === undefined || init.ready === true}>
```

```tsx
// After
// @ts-expect-error - T may not have a `ready` property
<Show when={ready()}>
```

**Why:** Adding a description makes it clear that this is an intentional access of a property that may not exist on `T`, not a mistake. If this line ever compiles cleanly (e.g., after adding `ready` to the type), the `@ts-expect-error` will correctly trigger a build error reminding you to clean it up — but only if you understand what it was suppressing.

---

### 4. Parameter name `input` shadows the concept — prefer shorter name (lines 3, 5, 11, 21)

The style guide says "prefer single word variable names." `input` is already one word, but it's a vague one that collides with the `init` callback's own parameter also called `input`. A name like `opts` or `def` would be more distinct.

```tsx
// Before (lines 3-6)
export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
```

```tsx
// After
export function createSimpleContext<T, Props extends Record<string, unknown>>(opts: {
  name: string
  init: ((props: Props) => T) | (() => T)
}) {
```

**Why:** The outer parameter is `input` and the inner callback's parameter type is also `input: Props`. While they're at different scopes, using `opts` for the outer and `props` for the inner makes the distinction clear at a glance. It also aligns with SolidJS conventions where component arguments are called `props`.

---

### 5. `init` is used as both a callback name and a local variable (lines 5, 11)

`input.init` is the factory function, and `init` is the result of calling it. This reuse is confusing.

```tsx
// Before (line 11)
const init = input.init(props)
```

```tsx
// After
const value = opts.init(props)
```

**Why:** `value` clearly communicates "the thing the context provides," while `init` suggests "a function that initializes something." Reusing the same name for a function and its return value in the same scope is a readability trap.

---

### 6. Missing `Show` fallback — minor but worth noting (line 14)

When `ready` is `false`, `<Show>` renders nothing. This is intentional (gate the whole subtree until ready), but there's no comment explaining this behavior. A consumer reading this helper for the first time might wonder if children should be rendered in a loading state.

This is not a code change — just a note that a one-line comment would help:

```tsx
// Gate children until init signals ready (or if no ready property exists, render immediately)
```

---

## Full suggested rewrite

For reference, here's what the file would look like with all issues addressed:

```tsx
import { createContext, createMemo, Show, useContext, type ParentProps } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, unknown>>(opts: {
  name: string
  init: ((props: Props) => T) | (() => T)
}) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const value = opts.init(props)
      // Gate children until init signals ready (or render immediately if no ready property)
      const ready = createMemo(() => {
        // @ts-expect-error - T may not have a `ready` property
        const r = value.ready as boolean | undefined
        return r === undefined || r === true
      })
      return (
        <Show when={ready()}>
          <ctx.Provider value={value}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const result = useContext(ctx)
      if (!result) throw new Error(`${opts.name} context must be used within a context provider`)
      return result
    },
  }
}
```
