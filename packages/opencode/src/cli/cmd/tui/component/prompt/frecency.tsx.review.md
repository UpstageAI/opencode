# Code Review: `frecency.tsx`

## Summary

The file is relatively short and mostly functional, but has several style guide violations and readability issues: repeated type literals instead of a single type alias, unnecessary destructuring, inlineable variables, `let`-style patterns via mutable reduce accumulators, and a `try/catch` that could be avoided. The logic is sound but the code is noisier than it needs to be.

---

## Issues

### 1. Repeated type literal (lines 28, 33, 40)

The type `{ path: string; frequency: number; lastOpen: number }` is written out three times. This hurts readability and creates a maintenance risk if the shape changes.

**Before:**

```tsx
.map((line) => {
  try {
    return JSON.parse(line) as { path: string; frequency: number; lastOpen: number }
  } catch {
    return null
  }
})
.filter((line): line is { path: string; frequency: number; lastOpen: number } => line !== null)

const latest = lines.reduce(
  (acc, entry) => {
    acc[entry.path] = entry
    return acc
  },
  {} as Record<string, { path: string; frequency: number; lastOpen: number }>,
)
```

**After:**

```tsx
type Entry = { path: string; frequency: number; lastOpen: number }

// then use Entry everywhere
```

This is one of the cases where an explicit type _is_ warranted -- it eliminates triple duplication.

---

### 2. `try/catch` in map for JSON parsing (lines 26-32)

The style guide says "avoid `try/catch` where possible." Each line is a self-contained JSON object, so a safe parse helper or inline check is cleaner. A straightforward approach is a small safe-parse inline that returns `null` on failure, but since `JSON.parse` is the only standard API here, the `try/catch` is at least isolated. However, wrapping it differently can make the pipeline read more cleanly.

**Before:**

```tsx
.map((line) => {
  try {
    return JSON.parse(line) as Entry
  } catch {
    return null
  }
})
.filter((line): line is Entry => line !== null)
```

**After:**

```tsx
.flatMap((line) => {
  try {
    return [JSON.parse(line) as Entry]
  } catch {
    return []
  }
})
```

Using `flatMap` combines the parse + filter into one step, removing the separate `.filter()` with its redundant type guard. The `try/catch` is still present (unavoidable with `JSON.parse`), but the overall pipeline is shorter.

---

### 3. Mutable accumulator in `reduce` instead of `Object.fromEntries` (lines 35-41)

The `reduce` builds an object by mutating `acc`. This is a common pattern but is more verbose than necessary and less functional in style.

**Before:**

```tsx
const latest = lines.reduce(
  (acc, entry) => {
    acc[entry.path] = entry
    return acc
  },
  {} as Record<string, Entry>,
)
```

**After:**

```tsx
const latest = Object.fromEntries(lines.map((entry) => [entry.path, entry]))
```

Since later entries overwrite earlier ones in `Object.fromEntries` (just like the reduce), this is equivalent but much shorter. One line instead of six.

---

### 4. Unnecessary destructuring in sort comparator (line 75)

The style guide says to avoid unnecessary destructuring and prefer dot notation.

**Before:**

```tsx
.sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
```

This destructuring is arguably justified here since `Object.entries` returns tuples and there's no object to dot-access. However, on line 78 there's a more notable issue:

**Before (line 78):**

```tsx
const content = sorted.map(([path, entry]) => JSON.stringify({ path, ...entry })).join("\n") + "\n"
```

The variable name `path` shadows the `path` import from Node.js (line 1). This is a readability and potential bug risk.

**After:**

```tsx
const content = sorted.map(([p, entry]) => JSON.stringify({ path: p, ...entry })).join("\n") + "\n"
```

Or restructure to avoid `Object.entries` entirely (see issue 6).

---

### 5. Inlineable variable `daysSince` (line 10)

The style guide says to reduce variable count by inlining when a value is only used once.

**Before:**

```tsx
function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  const daysSince = (Date.now() - entry.lastOpen) / 86400000 // ms per day
  const weight = 1 / (1 + daysSince)
  return entry.frequency * weight
}
```

**After:**

```tsx
function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
  if (!entry) return 0
  const weight = 1 / (1 + (Date.now() - entry.lastOpen) / 86400000)
  return entry.frequency * weight
}
```

`daysSince` is only used once and the expression is simple enough to inline. The comment `// ms per day` is also lost, but `86400000` is a well-known constant and the function name provides context.

---

### 6. Unnecessary explicit return type on `calculateFrecency` (line 8)

The style guide says to rely on type inference and avoid explicit type annotations unless necessary. The return type `: number` is trivially inferred from arithmetic operations.

**Before:**

```tsx
function calculateFrecency(entry?: { frequency: number; lastOpen: number }): number {
```

**After:**

```tsx
function calculateFrecency(entry?: { frequency: number; lastOpen: number }) {
```

---

### 7. `newEntry` variable is only used twice but could be restructured (lines 66-71)

The variable `newEntry` is used on lines 70 and 71. It's borderline, but the real issue is that the object is constructed and then spread into another object on line 71. This creates two similar-but-different shapes in rapid succession.

**Before:**

```tsx
const newEntry = {
  frequency: (store.data[absolutePath]?.frequency || 0) + 1,
  lastOpen: Date.now(),
}
setStore("data", absolutePath, newEntry)
appendFile(frecencyFile.name!, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n").catch(() => {})
```

This is acceptable since `newEntry` is used twice, but the non-null assertion `frecencyFile.name!` on line 71 is a code smell. `Bun.file()` always has a `name` property when constructed from a path string, but the `!` hides a potential issue. Consider storing the path directly.

**After:**

```tsx
const file = path.join(Global.Path.state, "frecency.jsonl")
const frecencyFile = Bun.file(file)
// ...
appendFile(file, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n").catch(() => {})
```

This avoids the non-null assertion entirely by reusing the path string directly.

---

### 8. Inconsistent file write APIs (lines 6, 56, 71, 79)

The file uses both `Bun.write()` (lines 56, 79) and Node's `appendFile` from `fs/promises` (line 71). Mixing APIs for the same file is inconsistent. The style guide says to prefer Bun APIs when possible.

**Before:**

```tsx
import { appendFile } from "fs/promises"
// ...
appendFile(frecencyFile.name!, JSON.stringify({ path: absolutePath, ...newEntry }) + "\n").catch(() => {})
```

**After:**

```tsx
// Use Bun's append mode via Bun.write with the append flag, or use the file path directly
// Since Bun.write doesn't have append, keep appendFile but at least use the path variable
// consistently rather than frecencyFile.name!
```

This one is tricky since `Bun.write` doesn't support append. The `appendFile` usage is justified, but the import mixing is still worth noting. At minimum, pass the path string directly instead of `frecencyFile.name!`.

---

### 9. Duplicate compaction logic (lines 43-57 and 73-80)

The "sort by lastOpen, slice to MAX, rewrite file" logic appears twice: once during mount (lines 43-57) and once in `updateFrecency` (lines 73-80). This violates DRY and makes maintenance harder. Extracting a `compact` function would clean this up.

**Before:**

```tsx
// In onMount:
const sorted = Object.values(latest)
  .sort((a, b) => b.lastOpen - a.lastOpen)
  .slice(0, MAX_FRECENCY_ENTRIES)
// ... setStore + Bun.write

// In updateFrecency:
const sorted = Object.entries(store.data)
  .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
  .slice(0, MAX_FRECENCY_ENTRIES)
// ... setStore + Bun.write
```

**After:**

```tsx
function compact() {
  const sorted = Object.entries(store.data)
    .sort(([, a], [, b]) => b.lastOpen - a.lastOpen)
    .slice(0, MAX_FRECENCY_ENTRIES)
  setStore("data", Object.fromEntries(sorted))
  const content = sorted.map(([p, entry]) => JSON.stringify({ path: p, ...entry })).join("\n") + "\n"
  Bun.write(frecencyFile, content).catch(() => {})
}
```

Then call `compact()` from both places after populating the store.

---

### 10. Variable `text` is only used once (line 23)

**Before:**

```tsx
const text = await frecencyFile.text().catch(() => "")
const lines = text.split("\n").filter(Boolean)
```

**After:**

```tsx
const lines = (await frecencyFile.text().catch(() => "")).split("\n").filter(Boolean)
```

Inlines `text` since it's used only once, per the style guide.

---

### 11. `store` and `setStore` declared after first use (lines 60-62)

The `createStore` call is on line 60, but `setStore` is referenced on line 47 (inside `onMount`). While this works because `onMount` runs asynchronously after the synchronous init completes, it's confusing to read. The store should be declared before the `onMount` block for clarity.

**Before:**

```tsx
onMount(async () => {
  // ... uses setStore on line 47
})

const [store, setStore] = createStore({ ... })
```

**After:**

```tsx
const [store, setStore] = createStore({ ... })

onMount(async () => {
  // ... uses setStore
})
```

This makes the data flow obvious -- the store exists before the mount callback references it.

---

## Summary of Recommended Changes

| Issue                                   | Severity | Category                 |
| --------------------------------------- | -------- | ------------------------ |
| Repeated type literal                   | Medium   | Readability / DRY        |
| flatMap instead of map+filter           | Low      | Style guide (functional) |
| Object.fromEntries over reduce          | Low      | Simplification           |
| `path` variable shadows import          | Medium   | Bug risk                 |
| Inlineable `daysSince`                  | Low      | Style guide              |
| Unnecessary return type annotation      | Low      | Style guide              |
| Non-null assertion `frecencyFile.name!` | Medium   | Safety                   |
| Mixed file write APIs                   | Low      | Consistency              |
| Duplicate compaction logic              | Medium   | DRY                      |
| Inlineable `text` variable              | Low      | Style guide              |
| Store declared after first reference    | Medium   | Readability              |
