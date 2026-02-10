# Review: `dialog-mcp.tsx`

## Summary

This is a small, relatively clean file (87 lines). The structure is sound and the
component decomposition (extracting `Status`) is appropriate. However, there are
several style guide violations and minor readability improvements to address:
unnecessary variables, an unnecessary comment, a `try/catch` that could be
simplified, and an unused `setRef` signal.

---

## Issues

### 1. Unused `setRef` signal (line 26)

`setRef` is created but never consumed. The signal value `ref` (the first element)
is discarded, and `setRef` is only passed as a `ref` prop to `DialogSelect`. Since
nothing ever reads the ref signal, this is dead code.

```tsx
// Before (line 26)
const [, setRef] = createSignal<DialogSelectRef<unknown>>()
```

```tsx
// After — remove entirely, and remove the ref prop on line 77
// (remove line 26 and the ref={setRef} on line 77)
```

**Why:** Dead code adds cognitive overhead. If no consumer reads the ref, the signal
serves no purpose.

---

### 2. Unnecessary intermediate variables in `options` memo (lines 31-32)

`mcpData` and `loadingMcp` are each used exactly once. The comment says they exist
to "track" reactive values, but in Solid, simply calling `sync.data.mcp` and
`loading()` inside the memo already tracks them. The variables add nothing.

```tsx
// Before (lines 29-46)
const options = createMemo(() => {
  // Track sync data and loading state to trigger re-render when they change
  const mcpData = sync.data.mcp
  const loadingMcp = loading()

  return pipe(
    mcpData ?? {},
    entries(),
    sortBy(([name]) => name),
    map(([name, status]) => ({
      value: name,
      title: name,
      description: status.status === "failed" ? "failed" : status.status,
      footer: <Status enabled={local.mcp.isEnabled(name)} loading={loadingMcp === name} />,
      category: undefined,
    })),
  )
})
```

```tsx
// After
const options = createMemo(() =>
  pipe(
    sync.data.mcp ?? {},
    entries(),
    sortBy(([name]) => name),
    map(([name, status]) => ({
      value: name,
      title: name,
      description: status.status === "failed" ? "failed" : status.status,
      footer: <Status enabled={local.mcp.isEnabled(name)} loading={loading() === name} />,
      category: undefined,
    })),
  ),
)
```

**Why:** Inlining values used once reduces variable count and removes a misleading
comment. Solid's reactivity tracks any signal/store access inside `createMemo`
automatically.

---

### 3. `try/catch` can be avoided (lines 57-70)

The style guide says to avoid `try/catch` where possible. The catch block only logs
to console, which provides minimal value in a TUI. The `finally` block resetting
loading state is the only important part, and that can be handled with `.then()` /
`.finally()` or by restructuring.

```tsx
// Before (lines 52-71)
onTrigger: async (option: DialogSelectOption<string>) => {
  // Prevent toggling while an operation is already in progress
  if (loading() !== null) return

  setLoading(option.value)
  try {
    await local.mcp.toggle(option.value)
    // Refresh MCP status from server
    const status = await sdk.client.mcp.status()
    if (status.data) {
      sync.set("mcp", status.data)
    } else {
      console.error("Failed to refresh MCP status: no data returned")
    }
  } catch (error) {
    console.error("Failed to toggle MCP:", error)
  } finally {
    setLoading(null)
  }
},
```

```tsx
// After
onTrigger: async (option: DialogSelectOption<string>) => {
  if (loading() !== null) return
  setLoading(option.value)
  await local.mcp.toggle(option.value)
  const result = await sdk.client.mcp.status()
  if (result.data) sync.set("mcp", result.data)
  setLoading(null)
},
```

**Why:** The `try/catch` catches errors only to `console.error` them, which is
not meaningfully useful in a TUI context. Removing it follows the style guide
preference to avoid `try/catch`. If error handling is truly needed here, it should
do something visible to the user (e.g. a toast), not just log. The `else` branch
logging "no data returned" is also unlikely to occur and adds noise.

---

### 4. Unnecessary type annotation on `onTrigger` parameter (line 52)

The `keybind` type on `DialogSelect` already defines what `onTrigger` receives. The
explicit `DialogSelectOption<string>` annotation is redundant.

```tsx
// Before (line 52)
onTrigger: async (option: DialogSelectOption<string>) => {
```

```tsx
// After
onTrigger: async (option) => {
```

**Why:** The style guide prefers relying on type inference. The type is already
constrained by the keybind definition in `DialogSelectProps`.

---

### 5. Unnecessary comment on `onSelect` (lines 81-83)

The empty `onSelect` handler with a comment explaining why it's empty is noise. If
the component works correctly without an `onSelect` (i.e., the dialog doesn't auto-close),
then just don't pass the prop. If the prop is required, an empty function with no
comment is clearer.

```tsx
// Before (lines 81-83)
onSelect={(option) => {
  // Don't close on select, only on escape
}}
```

```tsx
// After — either remove entirely if optional, or:
onSelect={() => {}}
```

**Why:** Comments explaining what code _doesn't_ do are usually noise. The behavior
is self-evident from an empty handler.

---

### 6. Redundant `category: undefined` (line 43)

Explicitly setting `category` to `undefined` is the same as not including the
property at all.

```tsx
// Before (line 43)
category: undefined,
```

```tsx
// After — remove the line
```

**Why:** `undefined` is the default for missing properties. Including it explicitly
suggests the field is meaningful here when it isn't.

---

### 7. Redundant comment (line 53)

```tsx
// Before (line 54)
// Prevent toggling while an operation is already in progress
if (loading() !== null) return
```

```tsx
// After
if (loading() !== null) return
```

**Why:** The code is self-explanatory. The guard clause checking `loading()` clearly
prevents concurrent operations. The comment restates the obvious.

---

### 8. Variable name `status` shadows conceptually (line 60)

Inside the `onTrigger`, the variable `status` (the API response) is conceptually
different from the `status` in the MCP option mapping (the connection status). Using
`result` would be clearer.

```tsx
// Before (line 60)
const status = await sdk.client.mcp.status()
if (status.data) {
  sync.set("mcp", status.data)
```

```tsx
// After
const result = await sdk.client.mcp.status()
if (result.data) sync.set("mcp", result.data)
```

**Why:** `status` is already heavily used in this file to mean MCP connection status.
Using it for an API response object creates ambiguity.

---

### 9. Import of `TextAttributes` is only used in `Status` (line 8)

Minor, but `TextAttributes` is imported at the top level and only used in the
`Status` sub-component. This is fine structurally but worth noting — the import is
justified since `Status` is in the same file.

No change needed, just noting it's been reviewed.

---

## Suggested final state

```tsx
import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { map, pipe, entries, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"

function Status(props: { enabled: boolean; loading: boolean }) {
  const { theme } = useTheme()
  if (props.loading) {
    return <span style={{ fg: theme.textMuted }}>⋯ Loading</span>
  }
  if (props.enabled) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Enabled</span>
  }
  return <span style={{ fg: theme.textMuted }}>○ Disabled</span>
}

export function DialogMcp() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const [loading, setLoading] = createSignal<string | null>(null)

  const options = createMemo(() =>
    pipe(
      sync.data.mcp ?? {},
      entries(),
      sortBy(([name]) => name),
      map(([name, status]) => ({
        value: name,
        title: name,
        description: status.status === "failed" ? "failed" : status.status,
        footer: <Status enabled={local.mcp.isEnabled(name)} loading={loading() === name} />,
      })),
    ),
  )

  const keybinds = createMemo(() => [
    {
      keybind: Keybind.parse("space")[0],
      title: "toggle",
      onTrigger: async (option) => {
        if (loading() !== null) return
        setLoading(option.value)
        await local.mcp.toggle(option.value)
        const result = await sdk.client.mcp.status()
        if (result.data) sync.set("mcp", result.data)
        setLoading(null)
      },
    },
  ])

  return <DialogSelect title="MCPs" options={options()} keybind={keybinds()} onSelect={() => {}} />
}
```
