# Code Review: `stash.tsx`

## Summary

This file is reasonably short and functional, but has several style guide violations and readability issues. The main problems are: a `let` + mutation pattern that can be replaced with a cleaner approach, duplicated serialization logic across three methods, a variable name (`line`) used misleadingly in non-line contexts, and unnecessary intermediate variables. The `try/catch` in `onMount` is acceptable here since it's parsing untrusted data line-by-line, but most other issues are straightforward to fix.

---

## Issues

### 1. Duplicated serialization logic (lines 41, 68, 84, 96)

The pattern `entries.map((line) => JSON.stringify(line)).join("\n") + "\n"` appears four times. This is a clear candidate for a helper function. It also uses the name `line` for entries that are not lines.

**Before:**

```tsx
const content = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
// ... repeated in push(), pop(), remove()
const content = store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n"
```

**After:**

```tsx
function serialize(entries: StashEntry[]) {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
}
```

Then each call site becomes `serialize(store.entries)` or `serialize(lines)`. This reduces repetition and makes intent clearer. The function is reused across four call sites, making it a valid candidate for extraction per the style guide ("keep things in one function unless composable or reusable").

---

### 2. `let trimmed` mutation pattern in `push()` (lines 56-71)

Using `let trimmed = false` and mutating it inside the `produce` callback is a sloppy pattern. The trimming condition can be checked independently before or after the store update, since we know the length before pushing.

**Before (lines 56-71):**

```tsx
let trimmed = false
setStore(
  produce((draft) => {
    draft.entries.push(stash)
    if (draft.entries.length > MAX_STASH_ENTRIES) {
      draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
      trimmed = true
    }
  }),
)

if (trimmed) {
  const content = store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n"
  writeFile(stashFile.name!, content).catch(() => {})
  return
}

appendFile(stashFile.name!, JSON.stringify(stash) + "\n").catch(() => {})
```

**After:**

```tsx
const willTrim = store.entries.length + 1 > MAX_STASH_ENTRIES
setStore(
  produce((draft) => {
    draft.entries.push(stash)
    if (willTrim) draft.entries = draft.entries.slice(-MAX_STASH_ENTRIES)
  }),
)

if (willTrim) {
  writeFile(stashFile.name!, serialize(store.entries)).catch(() => {})
  return
}
appendFile(stashFile.name!, JSON.stringify(stash) + "\n").catch(() => {})
```

**Why:** Eliminates `let` in favor of `const`, avoids side-effecting a variable from inside a callback (which is confusing to read), and makes the control flow purely based on a pre-computed condition.

---

### 3. Misleading parameter name `line` in callbacks (lines 27, 34, 41, 68, 84, 96)

The `.map()` and `.filter()` callbacks use `line` as the parameter name even when operating on parsed `StashEntry` objects. After parsing, these aren't lines anymore — they're entries.

**Before (line 34):**

```tsx
.filter((line): line is StashEntry => line !== null)
```

**After:**

```tsx
.filter((entry): entry is StashEntry => entry !== null)
```

Similarly in the serialization calls, `line` should be `entry` or just `e`. This is a small readability win — the name should reflect the value's type, not where it came from.

---

### 4. Unnecessary intermediate variable `lines` (line 24)

The variable `lines` is used in two places: assigning to the store, and rewriting the file. However, the store assignment could use the result directly. This is borderline — the variable is used twice so inlining isn't strictly required, but the name `lines` is misleading since after parsing and filtering they are entries, not lines.

**Before (lines 24-37):**

```tsx
const lines = text
  .split("\n")
  .filter(Boolean)
  .map((line) => { ... })
  .filter((line): line is StashEntry => line !== null)
  .slice(-MAX_STASH_ENTRIES)

setStore("entries", lines)
```

**After:**

```tsx
const entries = text
  .split("\n")
  .filter(Boolean)
  .map((raw) => {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })
  .filter((entry): entry is StashEntry => entry !== null)
  .slice(-MAX_STASH_ENTRIES)

setStore("entries", entries)
```

**Why:** `entries` accurately describes what the variable holds. Using `raw` for the unparsed string and `entry` for the parsed object makes the pipeline easier to follow.

---

### 5. Unnecessary `clone()` in `push()` (line 55)

`clone({ ...entry, timestamp: Date.now() })` creates a spread (shallow copy) and then deep-clones it. The spread already creates a new object. If `entry.parts` contains nested references that need isolation, `clone` alone on the merged object would suffice — the spread is redundant.

**Before (line 55):**

```tsx
const stash = clone({ ...entry, timestamp: Date.now() })
```

**After:**

```tsx
const stash = clone({ ...entry, timestamp: Date.now() })
```

This one is actually fine as-is — `clone` handles deep cloning and the spread merges in the timestamp. The overhead is negligible. No change needed, but worth noting that `clone` already returns a new object, so the spread is technically creating an intermediate throwaway object. A minor nit: you could write `clone(Object.assign(entry, { timestamp: Date.now() }))` but the spread is more readable. **No change recommended.**

---

### 6. Ternary content in `pop()` and `remove()` could be simplified (lines 83-84, 95-96)

**Before (lines 83-84):**

```tsx
const content = store.entries.length > 0 ? store.entries.map((line) => JSON.stringify(line)).join("\n") + "\n" : ""
writeFile(stashFile.name!, content).catch(() => {})
```

**After (with the `serialize` helper):**

```tsx
writeFile(stashFile.name!, store.entries.length > 0 ? serialize(store.entries) : "").catch(() => {})
```

**Why:** Inlines `content` since it's only used once, and the `serialize` helper makes it short enough to fit on one line. Reduces variable count per the style guide.

---

### 7. `stashFile.name!` non-null assertion used repeatedly (lines 42, 69, 73, 85, 97)

`stashFile.name!` is used 5 times with a non-null assertion. Since `Bun.file()` constructed with a string path always has a `.name`, this assertion is safe but noisy. Storing the path directly would be cleaner.

**Before:**

```tsx
const stashFile = Bun.file(path.join(Global.Path.state, "prompt-stash.jsonl"))
// ... later ...
writeFile(stashFile.name!, content).catch(() => {})
```

**After:**

```tsx
const stashPath = path.join(Global.Path.state, "prompt-stash.jsonl")
const stashFile = Bun.file(stashPath)
// ... later ...
writeFile(stashPath, content).catch(() => {})
```

**Why:** Eliminates all 5 non-null assertions. The path is the primary identifier; the `BunFile` object is only needed for the initial `.text()` read in `onMount`. This is one case where an extra variable actually reduces noise. Alternatively, since `Bun.file().text()` is only called once, you could inline that too:

```tsx
const stashPath = path.join(Global.Path.state, "prompt-stash.jsonl")
// in onMount:
const text = await Bun.file(stashPath)
  .text()
  .catch(() => "")
```

This eliminates the `stashFile` variable entirely and all non-null assertions.

---

### 8. `store` and `setStore` declared after first use (lines 37 vs 46)

`setStore` is called on line 37 inside `onMount`, but `createStore` is on line 46. While this works because `onMount` runs asynchronously after init completes, it reads confusingly — the store appears to be used before it's created.

**Before:**

```tsx
onMount(async () => {
  // ... uses setStore on line 37
})

const [store, setStore] = createStore({ ... })  // line 46
```

**After:**

```tsx
const [store, setStore] = createStore({
  entries: [] as StashEntry[],
})

onMount(async () => {
  // ... uses setStore
})
```

**Why:** Declaring the store before `onMount` makes the data flow obvious. The reader doesn't have to reason about hoisting or async timing to understand that `setStore` is available.

---

## Summary of Recommended Changes

| Issue                                 | Severity | Type                          |
| ------------------------------------- | -------- | ----------------------------- |
| Duplicated serialization logic        | Medium   | DRY violation                 |
| `let trimmed` mutation pattern        | Medium   | Style (prefer `const`)        |
| Misleading `line` parameter names     | Low      | Readability                   |
| Store declared after first reference  | Low      | Readability                   |
| `stashFile.name!` repeated assertions | Low      | Noise reduction               |
| Inlineable `content` variable         | Low      | Style (reduce variable count) |
