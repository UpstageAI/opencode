# Review: `history.tsx`

## Summary

The file is reasonably short and focused, but has several style guide violations and readability issues: unnecessary `let` with mutation, unnecessary intermediate variables, inconsistent use of `try/catch`, and a couple of naming/destructuring issues. The logic in `move()` is also harder to follow than it needs to be.

---

## Issues

### 1. Unnecessary destructuring of `createStore` (line 58)

The style guide says to avoid unnecessary destructuring and prefer dot notation. However, `createStore` returns a tuple where destructuring is idiomatic for Solid.js -- this is an acceptable exception since `store[0]` and `store[1]` would be less readable. **No change needed here.**

### 2. `let trimmed` flag is avoidable (lines 86-104)

A mutable `let` is used to communicate state out of the `produce` callback. This can be replaced by checking the length after the store update, avoiding the `let` entirely.

**Before (lines 84-104):**

```tsx
append(item: PromptInfo) {
  const entry = clone(item)
  let trimmed = false
  setStore(
    produce((draft) => {
      draft.history.push(entry)
      if (draft.history.length > MAX_HISTORY_ENTRIES) {
        draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
        trimmed = true
      }
      draft.index = 0
    }),
  )

  if (trimmed) {
    const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
    writeFile(historyFile.name!, content).catch(() => {})
    return
  }

  appendFile(historyFile.name!, JSON.stringify(entry) + "\n").catch(() => {})
},
```

**After:**

```tsx
append(item: PromptInfo) {
  const entry = clone(item)
  const was = store.history.length
  setStore(
    produce((draft) => {
      draft.history.push(entry)
      if (draft.history.length > MAX_HISTORY_ENTRIES)
        draft.history = draft.history.slice(-MAX_HISTORY_ENTRIES)
      draft.index = 0
    }),
  )

  if (was >= MAX_HISTORY_ENTRIES) {
    const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
    writeFile(historyFile.name!, content).catch(() => {})
    return
  }

  appendFile(historyFile.name!, JSON.stringify(entry) + "\n").catch(() => {})
},
```

**Why:** Eliminates a `let` and removes the mutable flag pattern. The condition `was >= MAX_HISTORY_ENTRIES` captures the same semantics -- if the history was already at capacity before the push, a trim happened and a full rewrite is needed.

### 3. Unnecessary `lines` variable used only once in mount (lines 36-47)

The `lines` variable is used in three places (setting the store, the length check, and rewriting the file), so it's justified. **No change needed.**

### 4. Inconsistent return types in `move()` (lines 64-83)

`move()` returns `undefined` explicitly on lines 65-66, implicitly on line 68 (bare `return`), and returns objects on lines 78-82 and line 83. The bare `return` on line 68 is inconsistent with the explicit `return undefined` above it, making the intent unclear. Are these different on purpose?

**Before (lines 64-83):**

```tsx
move(direction: 1 | -1, input: string) {
  if (!store.history.length) return undefined
  const current = store.history.at(store.index)
  if (!current) return undefined
  if (current.input !== input && input.length) return
  setStore(
    produce((draft) => {
      const next = store.index + direction
      if (Math.abs(next) > store.history.length) return
      if (next > 0) return
      draft.index = next
    }),
  )
  if (store.index === 0)
    return {
      input: "",
      parts: [],
    }
  return store.history.at(store.index)
},
```

**After:**

```tsx
move(direction: 1 | -1, input: string) {
  if (!store.history.length) return
  const current = store.history.at(store.index)
  if (!current) return
  if (current.input !== input && input.length) return
  setStore(
    produce((draft) => {
      const next = store.index + direction
      if (Math.abs(next) > store.history.length) return
      if (next > 0) return
      draft.index = next
    }),
  )
  if (store.index === 0)
    return {
      input: "",
      parts: [],
    }
  return store.history.at(store.index)
},
```

**Why:** All early returns should be consistent. Using bare `return` (or all `return undefined`) uniformly makes it clear they all mean "no result." The explicit `return undefined` on lines 65-66 suggests they're different from line 68, but they aren't.

### 5. `content` variable is used once -- inline it (lines 53, 99)

The `content` variable on lines 53 and 99 is only used once in each location.

**Before (line 53-54):**

```tsx
const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
writeFile(historyFile.name!, content).catch(() => {})
```

**After:**

```tsx
writeFile(historyFile.name!, lines.map((l) => JSON.stringify(l)).join("\n") + "\n").catch(() => {})
```

Same applies to line 99-100:

**Before:**

```tsx
const content = store.history.map((line) => JSON.stringify(line)).join("\n") + "\n"
writeFile(historyFile.name!, content).catch(() => {})
```

**After:**

```tsx
writeFile(historyFile.name!, store.history.map((l) => JSON.stringify(l)).join("\n") + "\n").catch(() => {})
```

**Why:** The style guide says to reduce variable count by inlining when a value is only used once. However, this is a judgment call -- the inlined version is quite long. Either approach is defensible here, but the style guide leans toward inlining.

### 6. Verbose `try/catch` in JSON parsing (lines 40-44)

The `try/catch` for `JSON.parse` is one of the few places where `try/catch` is genuinely needed (parsing untrusted data), so it's acceptable. However, it can be simplified slightly.

**Before (lines 39-46):**

```tsx
.map((line) => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
})
.filter((line): line is PromptInfo => line !== null)
```

**After:**

```tsx
.flatMap((line) => {
  try {
    return [JSON.parse(line) as PromptInfo]
  } catch {
    return []
  }
})
```

**Why:** Using `flatMap` combines the parse + filter into a single step, reducing the pipeline. The type guard is replaced by an assertion since the data is coming from our own serialized format. This is a minor improvement.

### 7. `historyFile.name!` non-null assertion used repeatedly (lines 54, 100, 104)

The `name` property on `BunFile` is accessed with `!` three times. Since `historyFile` is created from a string path, `name` will always be defined. A cleaner approach is to store the path directly.

**Before (line 33):**

```tsx
const historyFile = Bun.file(path.join(Global.Path.state, "prompt-history.jsonl"))
```

**After:**

```tsx
const historyPath = path.join(Global.Path.state, "prompt-history.jsonl")
const historyFile = Bun.file(historyPath)
```

Then use `historyPath` instead of `historyFile.name!` on lines 54, 100, and 104.

**Why:** Eliminates three non-null assertions. Normally we'd avoid the extra variable, but here it replaces three `!` assertions and makes the intent clearer -- the path is a string we own, and the file handle is for reading.

### 8. `entry` variable on line 85 used only in two places

`clone(item)` is assigned to `entry`, then used on lines 89 and 104. This is fine since it's used twice. **No change needed.**

### 9. `text` variable on line 36 is used only once

**Before (lines 36-47):**

```tsx
const text = await historyFile.text().catch(() => "")
const lines = text
  .split("\n")
  .filter(Boolean)
  .map(...)
```

**After (lines 36-47):**

```tsx
const lines = (await historyFile.text().catch(() => ""))
  .split("\n")
  .filter(Boolean)
  .map(...)
```

**Why:** `text` is only used once, so inlining it reduces variable count per the style guide.

### 10. Explicit type annotation on `PromptInfo` export (lines 10-26)

The `PromptInfo` type is exported and used as a type guard, so the explicit type definition is necessary. **No change needed.**

---

## Summary of Recommended Changes

| #   | Line(s)          | Severity | Description                                                  |
| --- | ---------------- | -------- | ------------------------------------------------------------ |
| 2   | 86-104           | Medium   | Replace `let trimmed` flag with length check before mutation |
| 4   | 65-66            | Low      | Use consistent bare `return` instead of `return undefined`   |
| 5   | 53-54, 99-100    | Low      | Inline `content` variable (judgment call on readability)     |
| 6   | 39-46            | Low      | Combine `map`+`filter` into `flatMap`                        |
| 7   | 33, 54, 100, 104 | Medium   | Extract path string to avoid `!` assertions                  |
| 9   | 36               | Low      | Inline `text` variable                                       |

The file is fairly clean overall. The most impactful improvements are #2 (eliminating mutable state leaking out of a callback) and #7 (removing non-null assertions).
