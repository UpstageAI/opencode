# Review: `dialog-stash.tsx`

## Summary

This is a small, well-structured file. The overall quality is decent — the component logic is clear and the file is easy to follow. However, there are several style guide violations and minor readability improvements worth addressing.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 32)

The style guide says to avoid unnecessary destructuring and prefer dot notation to preserve context. However, `const { theme } = useTheme()` is the established convention used across **every** dialog file in the codebase (`dialog-status.tsx`, `dialog-provider.tsx`, `dialog-session-list.tsx`, `dialog-mcp.tsx`). Since `theme` is used as the only field from the hook and the pattern is consistent project-wide, this is acceptable as-is. Changing it here alone would create inconsistency. **No change recommended** unless done as a codebase-wide sweep.

---

### 2. Unnecessary intermediate variables in `getRelativeTime` (lines 10-16)

Four `const` declarations compute cascading values, but `seconds`, `minutes`, and `hours` are each used only once in the comparisons (and once for the next derivation). The cascade is readable enough, but the variable `diff` is only used once and can be inlined.

**Before:**

```tsx
const now = Date.now()
const diff = now - timestamp
const seconds = Math.floor(diff / 1000)
```

**After:**

```tsx
const seconds = Math.floor((Date.now() - timestamp) / 1000)
```

**Why:** `now` and `diff` are each used exactly once. Inlining removes two unnecessary variables per the style guide ("reduce total variable count by inlining when a value is only used once"). The remaining `seconds`/`minutes`/`hours`/`days` cascade is fine since each is used for both the comparison and the next derivation.

---

### 3. Explicit return type annotations on helper functions (lines 9, 24)

The style guide says to "rely on type inference when possible; avoid explicit type annotations unless necessary for exports or clarity." Both `getRelativeTime` and `getStashPreview` are module-private functions with obvious `string` return types.

**Before:**

```tsx
function getRelativeTime(timestamp: number): string {
```

```tsx
function getStashPreview(input: string, maxLength: number = 50): string {
```

**After:**

```tsx
function getRelativeTime(timestamp: number) {
```

```tsx
function getStashPreview(input: string, maxLength = 50) {
```

**Why:** TypeScript can trivially infer the return type as `string` from every code path. The `number = 50` default also makes the `: number` annotation redundant. Removing these reduces noise and follows the style guide.

---

### 4. Unnecessary intermediate variable `entries` inside `options` memo (line 38-39)

`entries` is used exactly once on the next line.

**Before:**

```tsx
const options = createMemo(() => {
  const entries = stash.list()
  // Show most recent first
  return entries
    .map((entry, index) => {
```

**After:**

```tsx
const options = createMemo(() => {
  return stash.list()
    .map((entry, index) => {
```

**Why:** The variable is used immediately and only once. Inlining it reduces a variable per the style guide. The comment "Show most recent first" describes the `.toReversed()` at the end, not the `entries` variable, so it can move down or be removed (the `.toReversed()` call is self-documenting).

---

### 5. Unnecessary intermediate variable `lineCount` (line 43)

`lineCount` is used exactly once on line 49.

**Before:**

```tsx
const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
return {
  title: isDeleting ? `Press ${keybind.print("stash_delete")} again to confirm` : getStashPreview(entry.input),
  bg: isDeleting ? theme.error : undefined,
  value: index,
  description: getRelativeTime(entry.timestamp),
  footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
}
```

**After:**

```tsx
const lines = (entry.input.match(/\n/g)?.length ?? 0) + 1
return {
  title: isDeleting ? `Press ${keybind.print("stash_delete")} again to confirm` : getStashPreview(entry.input),
  bg: isDeleting ? theme.error : undefined,
  value: index,
  description: getRelativeTime(entry.timestamp),
  footer: lines > 1 ? `~${lines} lines` : undefined,
}
```

This one is borderline — inlining would make the `footer` line very long and harder to scan. But the name `lineCount` is two words where `lines` works. Per the style guide: "prefer single word variable names where possible."

---

### 6. Unnecessary intermediate variable `entries` in `onSelect` (lines 63-64)

`entries` is used once to look up `entry`, which is itself only used in the `if` block.

**Before:**

```tsx
onSelect={(option) => {
  const entries = stash.list()
  const entry = entries[option.value]
  if (entry) {
    stash.remove(option.value)
    props.onSelect(entry)
  }
  dialog.clear()
}}
```

**After:**

```tsx
onSelect={(option) => {
  const entry = stash.list()[option.value]
  if (entry) {
    stash.remove(option.value)
    props.onSelect(entry)
  }
  dialog.clear()
}}
```

**Why:** `entries` is used once, so inline it. One fewer variable to track.

---

### 7. Verbose `onMove` callback (lines 59-61)

The callback wrapping is unnecessarily multi-line for a single statement.

**Before:**

```tsx
onMove={() => {
  setToDelete(undefined)
}}
```

**After:**

```tsx
onMove={() => setToDelete(undefined)}
```

**Why:** Single-expression arrow functions are more concise as one-liners. This is a minor readability win that reduces vertical space.

---

### 8. `getStashPreview` could be inlined (lines 24-27)

This function is called exactly once (line 45), takes two args, and is only two lines. It's not reusable or composable.

**Before:**

```tsx
function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

// ... used as:
getStashPreview(entry.input)
```

**After (inlined at call site):**

```tsx
Locale.truncate(entry.input.split("\n")[0].trim(), 50)
```

**Why:** The style guide says "keep things in one function unless composable or reusable." This function is neither — it's called once with a fixed default. Inlining it reduces indirection. However, this is a judgment call: the name `getStashPreview` does add some semantic clarity. If the team prefers the named version for readability, that's reasonable too.

---

### 9. `getRelativeTime` naming (line 9)

The name `getRelativeTime` uses a `get` prefix which is more of a Java/OOP convention. In this codebase, functions generally don't use `get` prefixes (e.g., `resolveTheme`, `generateSyntax`, etc.).

**Before:**

```tsx
function getRelativeTime(timestamp: number): string {
```

**After:**

```tsx
function relative(timestamp: number) {
```

**Why:** The style guide prefers single-word names. `relative` is clear in context since it's only called with a timestamp and always returns a time string. Alternatively `timeago` works too.

---

## Summary of Recommended Changes

| Priority | Line(s) | Issue                                              |
| -------- | ------- | -------------------------------------------------- |
| Low      | 9       | Rename `getRelativeTime` to `relative`             |
| Low      | 10-12   | Inline `now` and `diff` variables                  |
| Medium   | 9, 24   | Remove explicit `: string` return type annotations |
| Low      | 24      | Remove explicit `: number` on default param        |
| Medium   | 38-39   | Inline `entries` variable in memo                  |
| Low      | 43      | Rename `lineCount` to `lines`                      |
| Medium   | 63-64   | Inline `entries` variable in onSelect              |
| Low      | 59-61   | Collapse `onMove` to single line                   |
| Low      | 24-27   | Consider inlining `getStashPreview`                |

Overall this is a clean file. The issues are all minor style guide violations — no bugs, no `any` types, no `try/catch`, no misuse of `let`. The logic is sound and easy to follow.
