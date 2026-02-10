# Review: `dialog-fork-from-timeline.tsx`

## Summary

A small 65-line component with several style guide violations: an imperative loop where functional array methods would be cleaner, unnecessary type annotations, a mutable `result` array built via `push` + `reverse`, and a couple of naming/destructuring issues. The logic itself is correct but the construction of the options memo is messier than it needs to be.

---

## Issues

### 1. Imperative `for` loop with `push` + `reverse` — use functional array methods (lines 23-60)

The `options` memo builds an array imperatively: it creates a mutable `let`-style array (via `as` cast), pushes into it in a for loop with `continue`, then reverses in place. This is the exact pattern the style guide discourages. Using `flatMap` + `filter` + `reverse()` (or `toReversed()`) expresses the same thing declaratively and avoids the mutable accumulator.

**Before:**

```tsx
const options = createMemo((): DialogSelectOption<string>[] => {
  const messages = sync.data.message[props.sessionID] ?? []
  const result = [] as DialogSelectOption<string>[]
  for (const message of messages) {
    if (message.role !== "user") continue
    const part = (sync.data.part[message.id] ?? []).find(
      (x) => x.type === "text" && !x.synthetic && !x.ignored,
    ) as TextPart
    if (!part) continue
    result.push({
      title: part.text.replace(/\n/g, " "),
      value: message.id,
      footer: Locale.time(message.time.created),
      onSelect: async (dialog) => { ... },
    })
  }
  result.reverse()
  return result
})
```

**After:**

```tsx
const options = createMemo(() =>
  (sync.data.message[props.sessionID] ?? [])
    .filter((m) => m.role === "user")
    .flatMap((message) => {
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      ) as TextPart | undefined
      if (!part) return []
      return [
        {
          title: part.text.replace(/\n/g, " "),
          value: message.id,
          footer: Locale.time(message.time.created),
          onSelect: async (dialog) => { ... },
        },
      ]
    })
    .toReversed(),
)
```

**Why:** Functional methods (`filter`, `flatMap`, `toReversed`) eliminate the mutable accumulator, the `continue` control flow, and the in-place `reverse()`. The return type `DialogSelectOption<string>[]` annotation on the memo is also unnecessary — it's inferred from the array literal. This matches the style guide preferences for functional array methods, preferring `const`, and relying on type inference.

---

### 2. Unnecessary explicit return type annotation on `createMemo` (line 21)

The style guide says "rely on type inference when possible; avoid explicit type annotations unless necessary for exports or clarity." The return type `DialogSelectOption<string>[]` is fully inferrable from the array contents.

**Before:**

```tsx
const options = createMemo((): DialogSelectOption<string>[] => {
```

**After:**

```tsx
const options = createMemo(() =>
```

**Why:** The type is inferred from the returned array. Removing the annotation reduces noise and follows the style guide.

---

### 3. Unsafe cast `as TextPart` — should be `as TextPart | undefined` (line 28)

`Array.find()` can return `undefined`, but the cast `as TextPart` hides that. The next line checks `if (!part) continue`, which is correct defensively, but the cast tells TypeScript it's never undefined — a contradiction. This is not an `any` but it is a sloppy cast that obscures the actual type.

**Before:**

```tsx
const part = (sync.data.part[message.id] ?? []).find((x) => x.type === "text" && !x.synthetic && !x.ignored) as TextPart
if (!part) continue
```

**After:**

```tsx
const part = (sync.data.part[message.id] ?? []).find((x) => x.type === "text" && !x.synthetic && !x.ignored) as
  | TextPart
  | undefined
if (!part) return []
```

**Why:** The cast should preserve the `| undefined` from `.find()`. This makes the null check meaningful to TypeScript rather than being dead code from the type system's perspective. A type guard on `filter` would also work but the cast approach is fine as long as `undefined` is included.

---

### 4. Variable `initialPrompt` is only used once — inline it (lines 39-54)

The style guide says "reduce total variable count by inlining when a value is only used once." `initialPrompt` is computed and immediately passed to `route.navigate`.

**Before:**

```tsx
const parts = sync.data.part[message.id] ?? []
const initialPrompt = parts.reduce(
  (agg, part) => {
    if (part.type === "text") {
      if (!part.synthetic) agg.input += part.text
    }
    if (part.type === "file") agg.parts.push(part)
    return agg
  },
  { input: "", parts: [] as PromptInfo["parts"] },
)
route.navigate({
  sessionID: forked.data!.id,
  type: "session",
  initialPrompt,
})
```

**After:**

```tsx
route.navigate({
  sessionID: forked.data!.id,
  type: "session",
  initialPrompt: (sync.data.part[message.id] ?? []).reduce(
    (agg, part) => {
      if (part.type === "text") {
        if (!part.synthetic) agg.input += part.text
      }
      if (part.type === "file") agg.parts.push(part)
      return agg
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  ),
})
```

**Why:** Eliminates two intermediate variables (`parts` and `initialPrompt`) that are each only used once. Keeps the data flow linear and reduces the variable count.

---

### 5. `reduce` with mutation — `reduce` is the wrong tool here (lines 40-48)

The `reduce` mutates its accumulator (`agg.input += ...`, `agg.parts.push(...)`) which defeats the purpose of `reduce`. A simple loop or a pair of functional operations would be cleaner and more honest about the mutation. However, if the goal is to stay functional per the style guide, building the two fields separately is clearer:

**Before:**

```tsx
const initialPrompt = parts.reduce(
  (agg, part) => {
    if (part.type === "text") {
      if (!part.synthetic) agg.input += part.text
    }
    if (part.type === "file") agg.parts.push(part)
    return agg
  },
  { input: "", parts: [] as PromptInfo["parts"] },
)
```

**After:**

```tsx
const parts = sync.data.part[message.id] ?? []
const initialPrompt = {
  input: parts
    .filter((p) => p.type === "text" && !p.synthetic)
    .map((p) => (p as TextPart).text)
    .join(""),
  parts: parts.filter((p) => p.type === "file") as PromptInfo["parts"],
}
```

**Why:** The original `reduce` mutates its accumulator on every iteration, which is a code smell — `reduce` should ideally produce new values. Building each field with `filter` + `map` is more declarative and easier to read at a glance. Each field's derivation is self-contained.

---

### 6. Variable `forked` used only for `forked.data!.id` — inline it (lines 35-36)

**Before:**

```tsx
const forked = await sdk.client.session.fork({
  sessionID: props.sessionID,
  messageID: message.id,
})
...
sessionID: forked.data!.id,
```

**After:**

```tsx
const forked = await sdk.client.session.fork({
  sessionID: props.sessionID,
  messageID: message.id,
})
...
sessionID: forked.data!.id,
```

This one is borderline — the `await` makes inlining awkward. Keeping `forked` as a variable is acceptable here. No change needed.

---

### 7. Nested `if` in reduce callback — flatten with `&&` (lines 42-44)

**Before:**

```tsx
if (part.type === "text") {
  if (!part.synthetic) agg.input += part.text
}
```

**After:**

```tsx
if (part.type === "text" && !part.synthetic) agg.input += part.text
```

**Why:** The nested `if` adds indentation for no reason. Combining into a single condition is simpler and follows the style guide's preference for avoiding unnecessary complexity.

---

## Suggested Full Rewrite

Applying all of the above (except issue 6 which is fine as-is):

```tsx
import { createMemo, onMount } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import type { TextPart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useDialog } from "../../ui/dialog"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogForkFromTimeline(props: { sessionID: string; onMove: (messageID: string) => void }) {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()

  onMount(() => {
    dialog.setSize("large")
  })

  const options = createMemo(() =>
    (sync.data.message[props.sessionID] ?? [])
      .filter((m) => m.role === "user")
      .flatMap((message) => {
        const part = (sync.data.part[message.id] ?? []).find((x) => x.type === "text" && !x.synthetic && !x.ignored) as
          | TextPart
          | undefined
        if (!part) return []
        return [
          {
            title: part.text.replace(/\n/g, " "),
            value: message.id,
            footer: Locale.time(message.time.created),
            onSelect: async (dialog) => {
              const forked = await sdk.client.session.fork({
                sessionID: props.sessionID,
                messageID: message.id,
              })
              const parts = sync.data.part[message.id] ?? []
              route.navigate({
                sessionID: forked.data!.id,
                type: "session",
                initialPrompt: {
                  input: parts
                    .filter((p) => p.type === "text" && !p.synthetic)
                    .map((p) => (p as TextPart).text)
                    .join(""),
                  parts: parts.filter((p) => p.type === "file") as PromptInfo["parts"],
                },
              })
              dialog.clear()
            },
          },
        ]
      })
      .toReversed(),
  )

  return <DialogSelect onMove={(option) => props.onMove(option.value)} title="Fork from message" options={options()} />
}
```

Changes from original:

- Removed unused import `DialogSelectOption`
- Removed explicit return type on `createMemo`
- Replaced imperative for-loop + push + reverse with `filter` + `flatMap` + `toReversed()`
- Fixed unsafe `as TextPart` cast to `as TextPart | undefined`
- Replaced mutating `reduce` with declarative `filter`/`map` for building `initialPrompt`
- Inlined `initialPrompt` into `route.navigate`
- Flattened nested `if` (no longer applicable after rewrite since the reduce is gone)
