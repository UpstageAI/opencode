# Review: `footer.tsx`

## Summary

The file is short and mostly readable, but has several style guide violations and patterns that add unnecessary complexity. The main issues are: unnecessary destructuring of `useTheme()`, a convoluted timer mechanism using a store where a simple signal suffices, a redundant conditional branch, and an inner `Switch` that can be replaced with a ternary.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 10)

The style guide says to avoid unnecessary destructuring and prefer dot notation. `theme` is the only property used, but the destructuring `{ theme }` is the established convention across this codebase (see `header.tsx:13`, `header.tsx:62`), so this is a minor, repo-wide pattern. Noting it for completeness but not a priority to change here alone.

```tsx
// Current (line 10)
const { theme } = useTheme()

// Preferred by style guide
const theme = useTheme().theme
```

**Why:** Dot notation preserves context and reduces destructuring per the style guide. However, since this pattern is used consistently across the codebase, changing it here alone would create inconsistency.

---

### 2. Overly complex timer mechanism using `createStore` (lines 23-50)

A `createStore` with a single boolean field `welcome` is overkill. A `createSignal` is simpler and more idiomatic for a single boolean toggle. The `tick` function also has a redundant branch: `if (!store.welcome)` followed by `if (store.welcome)` -- the second branch is unreachable because the first one returns. This makes the logic confusing.

```tsx
// Current (lines 23-50)
const [store, setStore] = createStore({
  welcome: false,
})

onMount(() => {
  // Track all timeouts to ensure proper cleanup
  const timeouts: ReturnType<typeof setTimeout>[] = []

  function tick() {
    if (connected()) return
    if (!store.welcome) {
      setStore("welcome", true)
      timeouts.push(setTimeout(() => tick(), 5000))
      return
    }

    if (store.welcome) {
      setStore("welcome", false)
      timeouts.push(setTimeout(() => tick(), 10_000))
      return
    }
  }
  timeouts.push(setTimeout(() => tick(), 10_000))

  onCleanup(() => {
    timeouts.forEach(clearTimeout)
  })
})

// Suggested
const [welcome, setWelcome] = createSignal(false)

onMount(() => {
  const timeouts: ReturnType<typeof setTimeout>[] = []

  function tick() {
    if (connected()) return
    const next = !welcome()
    setWelcome(next)
    timeouts.push(setTimeout(() => tick(), next ? 5000 : 10_000))
  }
  timeouts.push(setTimeout(() => tick(), 10_000))

  onCleanup(() => {
    timeouts.forEach(clearTimeout)
  })
})
```

**Why:**

- `createSignal` is the correct primitive for a single reactive boolean. `createStore` is for objects/collections.
- The second `if (store.welcome)` on line 39 is dead code -- the `if (!store.welcome)` block on line 33 always returns. This makes the reader think there's a third case, but there isn't.
- Toggling a boolean is a single operation, not two separate branches.

---

### 3. Unnecessary comment (line 28)

```tsx
// Current (line 28)
// Track all timeouts to ensure proper cleanup
const timeouts: ReturnType<typeof setTimeout>[] = []
```

**Why:** The code is self-explanatory -- a `timeouts` array paired with `onCleanup(() => timeouts.forEach(clearTimeout))` is a clear pattern. The comment adds no information.

---

### 4. Unnecessary type annotation on `timeouts` (line 29)

```tsx
// Current (line 29)
const timeouts: ReturnType<typeof setTimeout>[] = []

// Suggested
const timeouts = [] as ReturnType<typeof setTimeout>[]
```

**Why:** Minor -- both forms are acceptable for empty arrays where the type can't be inferred. The `as` form is slightly more concise. This is a nitpick.

---

### 5. Inner `Switch` can be a simple ternary (lines 74-81)

The nested `Switch`/`Match` with `when={true}` as a fallback is unnecessarily heavy for choosing between two colors. A ternary on the `style` prop is simpler and more readable.

```tsx
// Current (lines 74-81)
<Switch>
  <Match when={mcpError()}>
    <span style={{ fg: theme.error }}>⊙ </span>
  </Match>
  <Match when={true}>
    <span style={{ fg: theme.success }}>⊙ </span>
  </Match>
</Switch>

// Suggested
<span style={{ fg: mcpError() ? theme.error : theme.success }}>⊙ </span>
```

**Why:** 8 lines of JSX reduced to 1. The `Switch`/`Match` pattern is for multiple branches or complex conditions. For a binary choice on a single prop value, a ternary is clearer and avoids the overhead of two `Match` components.

---

### 6. `permissions()` called 3 times in the JSX (lines 63-67)

```tsx
// Current (lines 63-67)
<Show when={permissions().length > 0}>
  <text fg={theme.warning}>
    <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
    {permissions().length > 1 ? "s" : ""}
  </text>
</Show>
```

Each `permissions()` call re-evaluates the memo accessor. While `createMemo` caches the result so this is not a performance issue, reading from the memo once and assigning to a variable (or using `Show`'s callback form) improves readability by reducing noise.

```tsx
// Suggested - use Show's keyed callback to capture the value
<Show when={permissions().length || undefined} keyed>
  {(count) => (
    <text fg={theme.warning}>
      <span style={{ fg: theme.warning }}>△</span> {count} Permission
      {count > 1 ? "s" : ""}
    </text>
  )}
</Show>
```

**Why:** Eliminates triple accessor calls, and the `count` parameter makes the pluralization logic easier to read.

---

### 7. `store.welcome` reference in JSX should be `welcome()` after refactor (line 57)

If you apply the `createSignal` refactor from issue #2, update the JSX reference:

```tsx
// Current (line 57)
<Match when={store.welcome}>

// After refactor
<Match when={welcome()}>
```

---

### 8. `createStore` import is unnecessary after refactor (line 6)

If `createStore` is replaced with `createSignal`, the import from `"solid-js/store"` can be removed entirely.

```tsx
// Current (line 6)
import { createStore } from "solid-js/store"

// After refactor: remove this line
```

And `createSignal` is already available from `"solid-js"` -- just add it to the existing import on line 1.

---

## Suggested final state

```tsx
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { useRoute } from "../../context/route"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const [welcome, setWelcome] = createSignal(false)

  onMount(() => {
    const timeouts = [] as ReturnType<typeof setTimeout>[]

    function tick() {
      if (connected()) return
      const next = !welcome()
      setWelcome(next)
      timeouts.push(setTimeout(() => tick(), next ? 5000 : 10_000))
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={welcome()}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length || undefined} keyed>
              {(count) => (
                <text fg={theme.warning}>
                  <span style={{ fg: theme.warning }}>△</span> {count} Permission
                  {count > 1 ? "s" : ""}
                </text>
              )}
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <span style={{ fg: mcpError() ? theme.error : theme.success }}>⊙ </span>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
```

## Impact summary

| Issue                           | Severity | Lines saved | Type                       |
| ------------------------------- | -------- | ----------- | -------------------------- |
| `createStore` -> `createSignal` | Medium   | ~8          | Unnecessary complexity     |
| Dead code in `tick()`           | Medium   | 5           | Unreachable branch         |
| Inner `Switch` -> ternary       | Low      | 7           | Verbose JSX                |
| Triple `permissions()` call     | Low      | 0           | Readability                |
| Remove `createStore` import     | Low      | 1           | Dead import after refactor |
| Unnecessary comment             | Low      | 1           | Noise                      |
