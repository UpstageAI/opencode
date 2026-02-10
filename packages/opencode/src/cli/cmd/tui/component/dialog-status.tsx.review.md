# Review: `dialog-status.tsx`

## Summary

The file is relatively short and straightforward, but has several style guide violations and readability issues: unnecessary destructuring, intermediate variables that could be inlined, verbose object constructions, type casts that hint at incomplete type definitions, and an unused exported type. The `plugins` memo has a dense parsing function that could benefit from early returns.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 12)

The style guide says: "Avoid unnecessary destructuring. Use dot notation to preserve context."

`useTheme()` returns an object with `theme`, `syntax`, `selected`, etc. Only `theme` is used, but destructuring loses the `useTheme` context.

**Before:**

```tsx
const { theme } = useTheme()
```

**After:**

```tsx
const theme = useTheme()
```

Then use `theme.theme` in the JSX — or, since that reads awkwardly, assign the whole context with a single-word name:

```tsx
const colors = useTheme()
```

and reference `colors.theme.text`, etc. However, since every other component in this codebase destructures `{ theme }` the same way, this is a codebase-wide pattern. Changing it here alone would create inconsistency. **Flag as a broader codebase pattern to address, not a one-file fix.**

---

### 2. Unused exported type (line 8)

`DialogStatusProps` is exported but never used — not as a parameter, not imported anywhere. Dead code.

**Before:**

```tsx
export type DialogStatusProps = {}
```

**After:**
Remove entirely.

**Why:** Dead code adds noise. If props are needed later, they can be added then.

---

### 3. Unnecessary intermediate variables in `plugins` memo (lines 18-39)

`list` and `result` are each used exactly once. They should be inlined per the style guide: "Reduce total variable count by inlining when a value is only used once."

**Before:**

```tsx
const plugins = createMemo(() => {
  const list = sync.data.config.plugin ?? []
  const result = list.map((value) => {
    // ...
  })
  return result.toSorted((a, b) => a.name.localeCompare(b.name))
})
```

**After:**

```tsx
const plugins = createMemo(() =>
  (sync.data.config.plugin ?? [])
    .map((value) => {
      // ...
    })
    .toSorted((a, b) => a.name.localeCompare(b.name)),
)
```

**Why:** Fewer variables, same clarity. The chain reads top-to-bottom.

---

### 4. Plugin parsing logic uses nested `if`/`else` instead of early returns (lines 20-37)

The style guide says: "Avoid `else` statements. Prefer early returns." The nested conditionals inside the `map` callback make the two distinct code paths (file URL vs npm package) hard to scan.

**Before:**

```tsx
.map((value) => {
  if (value.startsWith("file://")) {
    const path = fileURLToPath(value)
    const parts = path.split("/")
    const filename = parts.pop() || path
    if (!filename.includes(".")) return { name: filename }
    const basename = filename.split(".")[0]
    if (basename === "index") {
      const dirname = parts.pop()
      const name = dirname || basename
      return { name }
    }
    return { name: basename }
  }
  const index = value.lastIndexOf("@")
  if (index <= 0) return { name: value, version: "latest" }
  const name = value.substring(0, index)
  const version = value.substring(index + 1)
  return { name, version }
})
```

**After:**

```tsx
.map((value) => {
  if (value.startsWith("file://")) {
    const parts = fileURLToPath(value).split("/")
    const filename = parts.pop() || value
    if (!filename.includes(".")) return { name: filename }
    const base = filename.split(".")[0]
    if (base !== "index") return { name: base }
    return { name: parts.pop() || base }
  }
  const idx = value.lastIndexOf("@")
  if (idx <= 0) return { name: value, version: "latest" }
  return { name: value.substring(0, idx), version: value.substring(idx + 1) }
})
```

**Why:**

- Inlines `path` (used once) into the `.split()` chain.
- Flips the `basename === "index"` condition to an early return, removing the inner nesting and the extra `dirname`/`name` variables.
- Inlines `name`/`version` in the npm-package branch (each used once).
- `base` instead of `basename` — shorter, single concept.
- `idx` instead of `index` — avoids shadowing `Array.prototype.index` connotations while staying short.

---

### 5. Unnecessary intermediate variables in npm-package branch (lines 33-37)

`name` and `version` are each used exactly once on the very next line.

**Before:**

```tsx
const name = value.substring(0, index)
const version = value.substring(index + 1)
return { name, version }
```

**After:**

```tsx
return { name: value.substring(0, idx), version: value.substring(idx + 1) }
```

**Why:** Style guide says to inline values used only once.

---

### 6. Unnecessary intermediate variable `dirname` / `name` (lines 27-29)

Both are used once and can be collapsed.

**Before:**

```tsx
const dirname = parts.pop()
const name = dirname || basename
return { name }
```

**After:**

```tsx
return { name: parts.pop() || base }
```

**Why:** Two variables for a single fallback expression is unnecessarily verbose.

---

### 7. `as Record<string, typeof theme.success>` type cast (line 68)

This cast is masking incomplete type coverage. The status color map doesn't account for unknown statuses — accessing an unhandled status returns `undefined`, which the cast hides.

**Before:**

```tsx
fg: (
  {
    connected: theme.success,
    failed: theme.error,
    disabled: theme.textMuted,
    needs_auth: theme.warning,
    needs_client_registration: theme.error,
  } as Record<string, typeof theme.success>
)[item.status],
```

**After:**

```tsx
fg: ({
  connected: theme.success,
  failed: theme.error,
  disabled: theme.textMuted,
  needs_auth: theme.warning,
  needs_client_registration: theme.error,
} as Record<string, typeof theme.success>)[item.status],
```

This is a minor formatting change, but the real issue is the cast. Ideally, the MCP status type would be a union that includes `needs_auth` and `needs_client_registration` so the cast isn't needed. The `(item.status as string)` casts on lines 81 and 84 confirm the types are incomplete upstream. **This is a type definition issue in the SDK, not fixable here alone — but worth noting.**

---

### 8. `(item.status as string)` casts (lines 81, 84)

These casts indicate that `needs_auth` and `needs_client_registration` are missing from the `McpStatus` type definition. The casts are a workaround.

**Before:**

```tsx
<Match when={(item.status as string) === "needs_auth"}>
```

**After (ideal):**
Fix the `McpStatus` type upstream to include these statuses, then remove the casts:

```tsx
<Match when={item.status === "needs_auth"}>
```

**Why:** Type casts defeat the purpose of TypeScript. The proper fix is in the SDK type definitions.

---

### 9. Verbose `style` object for simple `fg` prop (lines 128-131, 149-152)

When the `style` object only sets `fg`, it's unnecessarily verbose compared to using the `fg` prop directly.

**Before:**

```tsx
<text
  flexShrink={0}
  style={{
    fg: theme.success,
  }}
>
```

**After:**

```tsx
<text flexShrink={0} fg={theme.success}>
```

**Why:** The `fg` prop is available directly (used elsewhere in this same file, e.g., line 134). Using `style` for a single property adds visual noise.

---

### 10. Repeated bullet-point item pattern (lines 57-91, 100-115, 125-137, 147-159)

The same `<box flexDirection="row" gap={1}>` + bullet `<text>` + label `<text>` pattern appears four times with minor variations. This could be extracted to a local component.

**Before:** Four near-identical blocks.

**After:**

```tsx
function Bullet(props: { fg: RGBA; children: any }) {
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={props.fg}>
        •
      </text>
      <text wrapMode="word" fg={theme.text}>
        {props.children}
      </text>
    </box>
  )
}
```

Then usage becomes:

```tsx
<Bullet fg={statusColor[item.status]}>
  <b>{key}</b> <span style={{ fg: theme.textMuted }}>...</span>
</Bullet>
```

**Why:** Reduces duplication and makes each list section easier to read. The style guide says "Keep things in one function unless composable or reusable" — this pattern _is_ reusable (4 times in one file).

---

### 11. `Object.keys(sync.data.mcp).length` computed twice (lines 52, 54)

The same expression is evaluated in both the `when` condition and the fallback text.

**Before:**

```tsx
<Show when={Object.keys(sync.data.mcp).length > 0} fallback={...}>
  <box>
    <text fg={theme.text}>{Object.keys(sync.data.mcp).length} MCP Servers</text>
```

**After:**
Extract a memo (or at minimum compute once):

```tsx
const mcpKeys = createMemo(() => Object.keys(sync.data.mcp))
```

Then:

```tsx
<Show when={mcpKeys().length > 0} fallback={...}>
  <box>
    <text fg={theme.text}>{mcpKeys().length} MCP Servers</text>
```

**Why:** Avoids redundant computation and makes the reactive dependency clearer.

---

### 12. Destructuring in `For` callback (line 56)

The style guide prefers dot notation over destructuring. The `[key, item]` destructure is standard for `Object.entries` iteration and reads well, so this is a borderline case. However, it's worth noting.

**Before:**

```tsx
{([key, item]) => (
```

This is idiomatic for `Object.entries` and acceptable — no change recommended.

---

### 13. `(val() as { error: string }).error` cast (line 85)

This is another symptom of the incomplete `McpStatus` type. The cast is unsafe.

**Before:**

```tsx
{
  ;(val) => (val() as { error: string }).error
}
```

**After (ideal):** Fix the upstream type so that `needs_client_registration` status includes an `error` field, then:

```tsx
{
  ;(val) => val().error
}
```

**Why:** Casting to an inline type literal is fragile and hard to read.

---

## Priority Summary

| Priority | Issue                                                        | Lines            |
| -------- | ------------------------------------------------------------ | ---------------- |
| High     | Remove unused `DialogStatusProps` type                       | 8                |
| High     | Inline `list`/`result` variables in plugins memo             | 18-39            |
| High     | Simplify plugin parsing with early returns, inline variables | 20-37            |
| Medium   | Use `fg` prop instead of `style={{ fg }}` for bullet points  | 128-131, 149-152 |
| Medium   | Extract repeated bullet-point pattern to local component     | 57-159           |
| Medium   | Compute `Object.keys(sync.data.mcp)` once                    | 52, 54           |
| Low      | Fix `McpStatus` type upstream to remove `as string` casts    | 81, 84           |
| Low      | Fix `McpStatus` type upstream to remove `as Record<>` cast   | 68               |
| Low      | Codebase-wide `{ theme }` destructuring pattern              | 12               |
