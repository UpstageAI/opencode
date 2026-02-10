# Code Review: sidebar.tsx

## Overall Quality

The file is functional but has several issues: dead imports, unnecessary comments, a variable shadowing bug, redundant null coalescing, and some patterns that don't align with the project style guide. The JSX structure has a lot of repetition in the collapsible section pattern that hurts readability.

---

## Issues

### 1. Dead imports (lines 5, 6, 8, 10)

Four imports are unused. `Locale`, `path`, `Global`, and `useKeybind` are imported but never referenced in the function body. Dead imports are noise and suggest leftover refactoring.

**Before:**

```tsx
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
```

**After:**

```tsx
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Installation } from "@/installation"
```

### 2. Unnecessary comments on self-explanatory memos (lines 30-31, 33-34)

The comments restate exactly what the code does. `mcpEntries` clearly sorts MCP entries alphabetically; `connectedMcpCount` clearly counts connected MCPs. Comments should explain _why_, not _what_.

**Before:**

```tsx
// Sort MCP servers alphabetically for consistent display order
const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

// Count connected and error MCP servers for collapsed header display
const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
```

**After:**

```tsx
const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))
const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
```

### 3. Variable shadowing in todo `<For>` callback (line 220)

The `<For>` callback parameter `todo` shadows the outer `todo` memo from line 20. This is a bug waiting to happen — if someone tries to access the array `todo()` inside this callback, they'll get the individual item instead.

**Before:**

```tsx
<For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
```

**After:**

```tsx
<For each={todo()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
```

### 4. Redundant `|| []` on a value already defaulted (line 239)

`diff()` is defined on line 19 with `?? []`, so it already returns an empty array when there's no data. The `|| []` on line 239 is redundant and misleading — it suggests the value could be falsy when it can't be.

**Before:**

```tsx
<For each={diff() || []}>
```

**After:**

```tsx
<For each={diff()}>
```

### 5. Unnecessary block body with explicit return in `<For>` callback (lines 240-256)

The diff `<For>` callback uses `{(item) => { return (...) }}` when a concise arrow `{(item) => (...)}` would do. Every other `<For>` in this file uses the concise form — this one is inconsistent.

**Before:**

```tsx
<For each={diff()}>
  {(item) => {
    return (
      <box flexDirection="row" gap={1} justifyContent="space-between">
        ...
      </box>
    )
  }}
</For>
```

**After:**

```tsx
<For each={diff()}>
  {(item) => (
    <box flexDirection="row" gap={1} justifyContent="space-between">
      ...
    </box>
  )}
</For>
```

### 6. Type casts `(item.status as string)` suggest a type gap (lines 149-150)

Casting `item.status as string` to compare against `"needs_auth"` and `"needs_client_registration"` means the SDK type doesn't include these values, but the runtime does. This is a code smell — the cast silences the type system. There's not much to do without fixing the upstream type, but this should be tracked. At minimum, the same pattern is used at lines 38-40 in the `errorMcpCount` memo where the comparison works without a cast — that inconsistency is confusing.

### 7. `as Record<string, typeof theme.success>` type assertion for status color map (line 136)

The inline object mapping statuses to colors is cast to `Record<string, ...>` to allow arbitrary key indexing. A helper function or a more explicit lookup would be safer and more readable.

**Before:**

```tsx
<text
  flexShrink={0}
  style={{
    fg: (
      {
        connected: theme.success,
        failed: theme.error,
        disabled: theme.textMuted,
        needs_auth: theme.warning,
        needs_client_registration: theme.error,
      } as Record<string, typeof theme.success>
    )[item.status],
  }}
>
```

**After:**

```tsx
<text
  flexShrink={0}
  style={{
    fg: ({
      connected: theme.success,
      failed: theme.error,
      disabled: theme.textMuted,
      needs_auth: theme.warning,
      needs_client_registration: theme.error,
    } as Record<string, typeof theme.success>)[item.status],
  }}
>
```

This is mostly a formatting nit — the extra parentheses wrapping and indentation make it look more complex than it is. Flattening the expression onto fewer lines improves scanability. However, the `as Record<string, ...>` cast itself is still a smell tied to issue #6's incomplete status type.

### 8. `directory()` split twice on the same value (line 299-300)

`directory()` is called and `.split("/")` is performed twice — once to get everything except the last segment, and again to get the last segment. This is minor but could be a single split.

**Before:**

```tsx
<text>
  <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
  <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
</text>
```

**After — using a memo or inline:**

```tsx
<text>
  <span style={{ fg: theme.textMuted }}>{directory().slice(0, directory().lastIndexOf("/") + 1)}</span>
  <span style={{ fg: theme.text }}>{directory().slice(directory().lastIndexOf("/") + 1)}</span>
</text>
```

Or keep it as-is — this is a minor readability preference. Both are clear, but the double split is slightly wasteful.

### 9. `Intl.NumberFormat` created on every recompute (lines 45-48)

The `cost` memo constructs a new `Intl.NumberFormat` every time messages change. The formatter is stateless and could be hoisted out of the component.

**Before:**

```tsx
const cost = createMemo(() => {
  const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(total)
})
```

**After:**

```tsx
// At module level:
const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// In component:
const cost = createMemo(() => {
  const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
  return currencyFormat.format(total)
})
```

### 10. `context` memo has an intermediate variable `total` that could be inlined (lines 54-55)

The `total` variable is only used twice (for `tokens` and `percentage`), but it's a sum of five terms so inlining would hurt readability. However, the `model` variable on line 56 is only used once — on line 59 — and could be inlined per the style guide's "reduce variable count" rule.

**Before:**

```tsx
const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
return {
  tokens: total.toLocaleString(),
  percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
}
```

**After:**

```tsx
const limit = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]?.limit.context
return {
  tokens: total.toLocaleString(),
  percentage: limit ? Math.round((total / limit) * 100) : null,
}
```

This also uses a shorter, more descriptive name (`limit`) for what we actually care about.

### 11. `{ theme }` destructuring from `useTheme()` (line 17)

Per the style guide, prefer dot notation over destructuring. However, this pattern (`const { theme } = useTheme()`) is used across 20+ files in this codebase and `useTheme()` returns multiple properties. Changing it here alone would be inconsistent — this is a codebase-wide decision, not a sidebar-specific fix.
