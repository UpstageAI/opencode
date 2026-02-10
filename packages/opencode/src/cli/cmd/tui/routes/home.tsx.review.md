# Code Review: `packages/opencode/src/cli/cmd/tui/routes/home.tsx`

## Summary

The file is reasonably compact at 141 lines and the overall structure is clear. There are several style guide violations and cleanup opportunities: dead code (unused import and variable), an `else if` chain that should use early returns, an unnecessary intermediate memo, scattered hook calls that hurt readability, and a `let` that could potentially be avoided. Most issues are minor but they accumulate.

---

## Issues

### 1. Dead import and unused variable: `useKeybind` / `keybind` (lines 4, 92)

`useKeybind` is imported and called, but the resulting `keybind` variable is never referenced anywhere in the component. This is dead code.

```tsx
// Before (line 4)
import { useKeybind } from "@tui/context/keybind"

// After
// Remove entirely
```

```tsx
// Before (line 92)
const keybind = useKeybind()

// After
// Remove entirely
```

**Why:** Dead code is noise. It makes readers wonder what they're missing and increases the surface area for confusion during future edits.

---

### 2. Unnecessary intermediate memo: `isFirstTimeUser` (line 37)

`isFirstTimeUser` is only consumed inside `showTips`. It doesn't need to be its own named memo — it can be inlined. Per the style guide: "Reduce total variable count by inlining when a value is only used once."

```tsx
// Before (lines 37-43)
const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
const showTips = createMemo(() => {
  // Don't show tips for first-time users
  if (isFirstTimeUser()) return false
  return !tipsHidden()
})

// After
const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
const showTips = createMemo(() => {
  if (sync.data.session.length === 0) return false
  return !tipsHidden()
})
```

**Why:** Eliminates a variable that exists only to be read once. The condition `sync.data.session.length === 0` is already self-documenting in context.

---

### 3. `else if` chain in `onMount` callback (lines 79-88)

The style guide says "Avoid `else` statements. Prefer early returns." The `onMount` callback uses `else if` where sequential early returns would be cleaner.

```tsx
// Before (lines 79-88)
onMount(() => {
  if (once) return
  if (route.initialPrompt) {
    prompt.set(route.initialPrompt)
    once = true
  } else if (args.prompt) {
    prompt.set({ input: args.prompt, parts: [] })
    once = true
    prompt.submit()
  }
})

// After
onMount(() => {
  if (once) return
  if (route.initialPrompt) {
    prompt.set(route.initialPrompt)
    once = true
    return
  }
  if (args.prompt) {
    prompt.set({ input: args.prompt, parts: [] })
    once = true
    prompt.submit()
  }
})
```

**Why:** Flat control flow is easier to scan. Each branch is independent and self-contained with an early return, rather than implicitly guarded by an `else`.

---

### 4. Scattered / disorganized hook calls (lines 22-28, 78, 90, 92)

Hook calls and variable declarations are scattered throughout the function body with logic interleaved between them. `useArgs()` is called on line 78, `useDirectory()` on line 90, `useKeybind()` on line 92 — all far from the initial block of hooks at lines 22-27. Grouping all hooks at the top makes the component's dependencies immediately visible.

```tsx
// Before (scattered across lines 22-28, 78, 90, 92)
const sync = useSync()
const kv = useKV()
const { theme } = useTheme()
const route = useRouteData("home")
const promptRef = usePromptRef()
const command = useCommandDialog()
// ... 50 lines of logic ...
let prompt: PromptRef
const args = useArgs()
// ... onMount ...
const directory = useDirectory()

const keybind = useKeybind()

// After (grouped at top)
const sync = useSync()
const kv = useKV()
const { theme } = useTheme()
const route = useRouteData("home")
const promptRef = usePromptRef()
const command = useCommandDialog()
const args = useArgs()
const directory = useDirectory()
```

**Why:** Grouping hooks at the top is the standard convention for component readability. When hooks are scattered, you have to read the entire function to understand the component's dependencies. Note: SolidJS doesn't enforce hook ordering rules like React, but grouping them is still better for readability.

---

### 5. `let prompt: PromptRef` with type annotation (line 77)

This uses `let` with an explicit type annotation. The `let` is required here because the value is assigned inside a JSX ref callback, so it can't be a `const`. However, the explicit `: PromptRef` type annotation is unnecessary — TypeScript can infer it from the ref callback usage, or it could be declared as `let prompt!: PromptRef` to signal definite assignment.

```tsx
// Before (line 77)
let prompt: PromptRef

// After
let prompt!: PromptRef
```

**Why:** The `!` (definite assignment assertion) communicates intent: "this will be assigned before use." It also removes the possibility of `prompt` being `undefined` at the type level without an explicit annotation. This is a minor improvement. Note: the `PromptRef` type import on line 1 can also be removed since the type is inferred.

---

### 6. Unnecessary `return` in `mcpError` memo (lines 29-31)

The memo body is a single expression wrapped in braces with an explicit `return`. Arrow functions with a single expression can use the concise form.

```tsx
// Before (lines 29-31)
const mcpError = createMemo(() => {
  return Object.values(sync.data.mcp).some((x) => x.status === "failed")
})

// After
const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
```

Same applies to `connectedMcpCount` (lines 33-35):

```tsx
// Before (lines 33-35)
const connectedMcpCount = createMemo(() => {
  return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
})

// After
const connectedMcpCount = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
```

**Why:** Removing the braces and `return` reduces visual noise. The concise arrow form signals "this is a pure expression" at a glance.

---

### 7. Multi-word variable names (lines 28, 33, 37, 39)

The style guide prefers single-word names where possible. Several memos use camelCase multi-word names.

| Line | Current             | Suggested                                                |
| ---- | ------------------- | -------------------------------------------------------- |
| 28   | `mcpError`          | Fine — two short words, no clear single-word alternative |
| 33   | `connectedMcpCount` | `connected` (context makes it clear)                     |
| 37   | `isFirstTimeUser`   | Inline it (see issue #2)                                 |
| 26   | `promptRef`         | Fine — mirrors the context name                          |
| 39   | `showTips`          | `tips` (it's a boolean signal for whether to show tips)  |

```tsx
// Before (line 33)
const connectedMcpCount = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)

// After
const connected = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
```

**Why:** Shorter names reduce line length and cognitive load. In a component focused on MCP status, `connected` is unambiguous. This is a soft suggestion — the current names aren't terrible, but the style guide explicitly prefers brevity.

---

### 8. Duplicated MCP status indicator JSX (lines 58-75 vs 117-131)

The hint area (lines 58-75) and the footer (lines 117-131) both render MCP status indicators with slightly different formatting. The footer duplicates the `Switch`/`Match` pattern for the dot color. This isn't necessarily a "extract to a component" situation (style guide: keep things in one function unless composable or reusable), but it's worth noting the duplication exists. If MCP status display logic changes, both locations need updating.

No code change suggested — just flagging the maintenance risk.

---

### 9. Module-level `let once` with TODO comment (lines 18-19)

```tsx
// TODO: what is the best way to do this?
let once = false
```

This is a module-level mutable variable used as a "run once" guard for the `onMount` callback. The TODO acknowledges this is a hack. It works but is fragile — the state persists across hot reloads and is invisible to the component's reactive system. No immediate fix needed, but this is technical debt worth tracking.

---

## Suggested full rewrite (for reference)

```tsx
import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const args = useArgs()
  const directory = useDirectory()

  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const connected = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)

  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const tips = createMemo(() => {
    if (sync.data.session.length === 0) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connected() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connected(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt!: PromptRef
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
      return
    }
    if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        <box height={3} />
        <Logo />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
          />
        </box>
        <box height={3} width="100%" maxWidth={75} alignItems="center" paddingTop={2}>
          <Show when={tips()}>
            <Tips />
          </Show>
        </box>
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connected() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connected()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
```

### Changes in the rewrite

1. Removed `useKeybind` import and usage (dead code)
2. Removed `type PromptRef` import (use definite assignment instead)
3. Grouped all hook calls at the top of the function
4. Inlined `isFirstTimeUser` into `showTips`
5. Renamed `showTips` to `tips`, `connectedMcpCount` to `connected`
6. Converted multi-line single-expression memos to concise arrow form
7. Replaced `else if` with early return in `onMount`
8. Changed `let prompt: PromptRef` to `let prompt!: PromptRef`
