# Code Review: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`

## Summary

This is a large (~1130 line) prompt component that handles text input, autocomplete, shell mode, paste handling, stash, history, and submission. The core logic is sound but there are several style guide violations and readability issues: unnecessary destructuring, `let` where `const` would work, `else` chains that should be early returns, inlineable variables, unused imports, type annotations that inference handles, and some verbose/repetitive patterns.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 75)

Style guide says: "Avoid unnecessary destructuring. Use dot notation to preserve context."

```tsx
// Before (line 75)
const { theme, syntax } = useTheme()

// After
const theme = useTheme()
```

Then use `theme.theme` and `theme.syntax` throughout (or rename the hook return). However, since `theme` and `syntax` are used _extensively_ (50+ times each), destructuring is arguably justified here to avoid `t.theme.text` everywhere. But it still violates the style guide. At minimum, a single-word alias would be better:

```tsx
// Alternative: keep destructuring but note it's a conscious exception
const ui = useTheme()
// then ui.theme.text, ui.syntax()
```

**Why**: Preserves context about where `theme` and `syntax` come from. Currently `theme` looks like a standalone variable with no origin.

---

### 2. Unused imports (line 1)

`t`, `dim`, and `fg` are imported from `@opentui/core` but never used anywhere in the file.

```tsx
// Before (line 1)
import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent, t, dim, fg } from "@opentui/core"

// After
import { BoxRenderable, TextareaRenderable, MouseEvent, PasteEvent } from "@opentui/core"
```

Similarly, `type JSX` (line 2) — `JSX.Element` is used only in the `PromptProps` type for `hint`, but `hint` is never actually read in the component body. This prop appears dead.

**Why**: Dead imports are noise and can confuse readers into thinking these values are used somewhere.

---

### 3. `else if` chain in `submit()` should use early returns (lines 561-624)

Style guide: "Avoid `else` statements. Prefer early returns."

```tsx
// Before (lines 561-624)
if (store.mode === "shell") {
  sdk.client.session.shell({ ... })
  setStore("mode", "normal")
} else if (
  inputText.startsWith("/") &&
  iife(() => { ... })
) {
  // Parse command...
  sdk.client.session.command({ ... })
} else {
  sdk.client.session.prompt({ ... }).catch(() => {})
}
history.append(...)

// After
if (store.mode === "shell") {
  sdk.client.session.shell({ ... })
  setStore("mode", "normal")
  finishSubmit()
  return
}

if (inputText.startsWith("/") && isSlashCommand(inputText)) {
  // Parse command...
  sdk.client.session.command({ ... })
  finishSubmit()
  return
}

sdk.client.session.prompt({ ... }).catch(() => {})
finishSubmit()
```

Or keep the shared cleanup inline without a helper and just use early returns with duplicated cleanup (3 copies of ~6 lines is acceptable for clarity).

**Why**: The `else if` chain with the `iife` condition is particularly hard to read. Flattening to early returns makes the control flow obvious.

---

### 4. `iife` used for inline condition is hard to read (lines 573-578)

The condition for the slash-command branch uses `iife()` to run an inline function, making a complex boolean check harder to parse.

```tsx
// Before (lines 572-578)
} else if (
  inputText.startsWith("/") &&
  iife(() => {
    const firstLine = inputText.split("\n")[0]
    const command = firstLine.split(" ")[0].slice(1)
    return sync.data.command.some((x) => x.name === command)
  })
) {

// After — extract to a named function or inline check
function isSlashCommand(text: string) {
  const firstLine = text.split("\n")[0]
  const name = firstLine.split(" ")[0].slice(1)
  return sync.data.command.some((x) => x.name === name)
}

// Then:
if (inputText.startsWith("/") && isSlashCommand(inputText)) {
```

**Why**: `iife` inside a condition is a cognitive speed bump. A named function communicates intent directly.

---

### 5. `let` where `const` with ternary works (line 536)

```tsx
// Before (line 536)
let inputText = store.prompt.input

// After — since it's reassigned via string surgery below, `let` is necessary here.
```

Actually, on closer inspection `inputText` is mutated in a loop (lines 542-552) so `let` is required. However, the mutation could be replaced with a functional approach:

```tsx
// Before (lines 536-552)
let inputText = store.prompt.input
const allExtmarks = input.extmarks.getAllForTypeId(promptPartTypeId)
const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

for (const extmark of sortedExtmarks) {
  const partIndex = store.extmarkToPartIndex.get(extmark.id)
  if (partIndex !== undefined) {
    const part = store.prompt.parts[partIndex]
    if (part?.type === "text" && part.text) {
      const before = inputText.slice(0, extmark.start)
      const after = inputText.slice(extmark.end)
      inputText = before + part.text + after
    }
  }
}

// After — use reduce to avoid `let`
const inputText = input.extmarks
  .getAllForTypeId(promptPartTypeId)
  .sort((a: { start: number }, b: { start: number }) => b.start - a.start)
  .reduce((text, extmark) => {
    const partIndex = store.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) return text
    const part = store.prompt.parts[partIndex]
    if (part?.type !== "text" || !part.text) return text
    return text.slice(0, extmark.start) + part.text + text.slice(extmark.end)
  }, store.prompt.input)
```

**Why**: Eliminates `let`, uses functional style per style guide ("prefer functional array methods over for loops"), and is more concise.

---

### 6. Unnecessary type annotation on `sortedExtmarks` (line 540)

```tsx
// Before (line 540)
const sortedExtmarks = allExtmarks.sort((a: { start: number }, b: { start: number }) => b.start - a.start)

// After
const sortedExtmarks = allExtmarks.sort((a, b) => b.start - a.start)
```

**Why**: Style guide says "Rely on type inference when possible." The sort callback parameters are inferred from the array type.

---

### 7. Unnecessary explicit type on `part` (line 701)

```tsx
// Before (line 701)
const part: Omit<FilePart, "id" | "messageID" | "sessionID"> = {
  type: "file" as const,
  ...
}

// After — inline into the produce call (see issue #8)
```

**Why**: This type annotation is verbose. The object is only used once (passed to `draft.prompt.parts.push`), so it can be inlined.

---

### 8. Variables used only once should be inlined (multiple locations)

Style guide: "Reduce total variable count by inlining when a value is only used once."

**Line 649-652: `currentOffset`, `extmarkStart`, `extmarkEnd` in `pasteText`**

```tsx
// Before (lines 649-652)
const currentOffset = input.visualCursor.offset
const extmarkStart = currentOffset
const extmarkEnd = extmarkStart + virtualText.length

// After
const start = input.visualCursor.offset
const end = start + virtualText.length
```

`currentOffset` is immediately aliased to `extmarkStart` — just use one variable. The `extmark` prefix is noise since the context is already about extmarks.

**Lines 684-689: Same pattern in `pasteImage`**

```tsx
// Before (lines 684-689)
const currentOffset = input.visualCursor.offset
const extmarkStart = currentOffset
const count = store.prompt.parts.filter((x) => x.type === "file").length
const virtualText = `[Image ${count + 1}]`
const extmarkEnd = extmarkStart + virtualText.length
const textToInsert = virtualText + " "

// After
const start = input.visualCursor.offset
const virtualText = `[Image ${store.prompt.parts.filter((x) => x.type === "file").length + 1}]`
const end = start + virtualText.length

input.insertText(virtualText + " ")
```

`count` is used once, `textToInsert` is used once, `currentOffset` is immediately aliased.

**Lines 529-533: sessionID creation**

```tsx
// Before (lines 529-533)
const sessionID = props.sessionID
  ? props.sessionID
  : await (async () => {
      const sessionID = await sdk.client.session.create({}).then((x) => x.data!.id)
      return sessionID
    })()

// After
const sessionID = props.sessionID ?? (await sdk.client.session.create({}).then((x) => x.data!.id))
```

The async IIFE wrapping a single await is unnecessary. The inner `sessionID` variable shadows the outer one and is returned immediately — just inline it.

**Lines 253-254: `value` in editor command**

```tsx
// Before (lines 253-254)
const value = text
const content = await Editor.open({ value, renderer })

// After
const content = await Editor.open({ value: text, renderer })
```

**Why**: Each of these reduces variable count and makes the code more direct.

---

### 9. `if`/`if` pattern that should be ternary or single expression (lines 108-111)

```tsx
// Before (lines 108-111)
createEffect(() => {
  if (props.disabled) input.cursorColor = theme.backgroundElement
  if (!props.disabled) input.cursorColor = theme.text
})

// After
createEffect(() => {
  input.cursorColor = props.disabled ? theme.backgroundElement : theme.text
})
```

**Why**: The two `if` statements are mutually exclusive but don't read that way. A ternary makes the relationship explicit.

---

### 10. `if`/`if` pattern in visibility effect (lines 377-380)

```tsx
// Before (lines 377-380)
createEffect(() => {
  if (props.visible !== false) input?.focus()
  if (props.visible === false) input?.blur()
})

// After
createEffect(() => {
  if (props.visible === false) return input?.blur()
  input?.focus()
})
```

**Why**: Same issue — two mutually exclusive conditions should be a single branch with early return.

---

### 11. `showVariant` memo is overly verbose (lines 732-737)

```tsx
// Before (lines 732-737)
const showVariant = createMemo(() => {
  const variants = local.model.variant.list()
  if (variants.length === 0) return false
  const current = local.model.variant.current()
  return !!current
})

// After
const showVariant = createMemo(() => local.model.variant.list().length > 0 && !!local.model.variant.current())
```

**Why**: `variants` and `current` are each used once. The entire memo is a simple boolean expression.

---

### 12. Redundant `return` at end of `pasteImage` (line 723)

```tsx
// Before (line 723)
  return
}

// After — just remove the bare return
}
```

**Why**: A bare `return` at the end of a function is dead code.

---

### 13. Duplicate "reset prompt" pattern appears 4+ times

The pattern of clearing the prompt appears in `ref.reset()` (lines 364-370), `submit()` (lines 629-634), stash command (lines 472-476), and clear keybind (lines 835-841). Each time it's:

```tsx
input.extmarks.clear()
input.clear()
setStore("prompt", { input: "", parts: [] })
setStore("extmarkToPartIndex", new Map())
```

This should be extracted into a helper:

```tsx
function clear() {
  input.extmarks.clear()
  input.clear()
  setStore("prompt", { input: "", parts: [] })
  setStore("extmarkToPartIndex", new Map())
}
```

**Why**: DRY. Four copies of the same 4-line sequence is a maintenance hazard — if the reset logic changes, all four must be updated.

---

### 14. `restoreExtmarksFromParts` uses `let` + mutation where unnecessary (lines 387-390)

```tsx
// Before (lines 386-423)
parts.forEach((part, partIndex) => {
  let start = 0
  let end = 0
  let virtualText = ""
  let styleId: number | undefined

  if (part.type === "file" && part.source?.text) {
    start = part.source.text.start
    end = part.source.text.end
    virtualText = part.source.text.value
    styleId = fileStyleId
  } else if (part.type === "agent" && part.source) {
    ...
  }
  ...
})

// After — derive values directly
parts.forEach((part, partIndex) => {
  const info =
    part.type === "file" && part.source?.text
      ? { start: part.source.text.start, end: part.source.text.end, value: part.source.text.value, styleId: fileStyleId }
      : part.type === "agent" && part.source
        ? { start: part.source.start, end: part.source.end, value: part.source.value, styleId: agentStyleId }
        : part.type === "text" && part.source?.text
          ? { start: part.source.text.start, end: part.source.text.end, value: part.source.text.value, styleId: pasteStyleId }
          : undefined

  if (!info) return

  const extmarkId = input.extmarks.create({
    start: info.start,
    end: info.end,
    virtual: true,
    styleId: info.styleId,
    typeId: promptPartTypeId,
  })
  setStore("extmarkToPartIndex", (map: Map<number, number>) => {
    const newMap = new Map(map)
    newMap.set(extmarkId, partIndex)
    return newMap
  })
})
```

**Why**: Eliminates 4 `let` declarations and the mutation pattern. Each branch clearly produces a complete value or nothing.

---

### 15. `syncedSessionID` uses mutable outer variable (lines 138-156)

```tsx
// Before (lines 138-156)
let syncedSessionID: string | undefined
createEffect(() => {
  const sessionID = props.sessionID
  const msg = lastUserMessage()

  if (sessionID !== syncedSessionID) {
    if (!sessionID || !msg) return
    syncedSessionID = sessionID
    ...
  }
})
```

The `let syncedSessionID` is a tracking variable. While it works, the naming `syncedSessionID` is verbose. A shorter name like `synced` would suffice since the context is clear.

```tsx
// After
let synced: string | undefined
```

**Why**: Style guide prefers single-word variable names where possible.

---

### 16. `as const` assertions are unnecessary (lines 668, 702)

```tsx
// Before
type: "text" as const,
type: "file" as const,

// After
type: "text",
type: "file",
```

When the object is used in a context where the literal type is expected (like pushing to a typed array), `as const` is redundant — the store's type already constrains it.

**Why**: Unnecessary type annotations add noise.

---

### 17. `spinnerDef` memo has duplicated config object (lines 739-757)

```tsx
// Before (lines 739-757)
const spinnerDef = createMemo(() => {
  const color = local.agent.color(local.agent.current().name)
  return {
    frames: createFrames({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
    color: createColors({
      color,
      style: "blocks",
      inactiveFactor: 0.6,
      minAlpha: 0.3,
    }),
  }
})

// After
const spinnerDef = createMemo(() => {
  const opts = {
    color: local.agent.color(local.agent.current().name),
    style: "blocks" as const,
    inactiveFactor: 0.6,
    minAlpha: 0.3,
  }
  return {
    frames: createFrames(opts),
    color: createColors(opts),
  }
})
```

**Why**: The identical config object is duplicated. Extract it to avoid drift and reduce visual noise.

---

### 18. Dead prop: `hint` (line 42)

`hint` is declared in `PromptProps` but never read in the component body.

```tsx
// Before (line 42)
hint?: JSX.Element

// After — remove from PromptProps
```

**Why**: Dead props mislead consumers into thinking they can pass a hint that will be rendered.

---

### 19. Dead prop: `showPlaceholder` (line 43)

`showPlaceholder` is declared in `PromptProps` but never referenced in the component.

```tsx
// Before (line 43)
showPlaceholder?: boolean

// After — remove from PromptProps
```

**Why**: Same as above — dead code.

---

### 20. `exit` is declared after `submit` which uses it (line 647)

```tsx
// Before
async function submit() {
  ...
  if (trimmed === "exit" ...) {
    exit()  // used here
    return
  }
  ...
}
const exit = useExit()  // declared here on line 647

// After — move before submit()
const exit = useExit()

async function submit() { ... }
```

**Why**: While JavaScript hoisting makes this work, it's confusing to read. Declaring dependencies before use is a basic readability convention.

---

### 21. Deeply nested IIFE JSX block for retry status (lines 1038-1093)

The retry status display is a ~55-line IIFE inside JSX. This should be extracted into its own component.

```tsx
// Before (lines 1038-1093)
{(() => {
  const retry = createMemo(() => { ... })
  const message = createMemo(() => { ... })
  const isTruncated = createMemo(() => { ... })
  const [seconds, setSeconds] = createSignal(0)
  onMount(() => { ... })
  const handleMessageClick = () => { ... }
  const retryText = () => { ... }
  return (
    <Show when={retry()}>
      <box onMouseUp={handleMessageClick}>
        <text fg={theme.error}>{retryText()}</text>
      </box>
    </Show>
  )
})()}

// After — extract to a component
function RetryStatus(props: { status: () => typeof status }) { ... }

// In JSX:
<RetryStatus status={status} />
```

**Why**: A 55-line IIFE inside JSX is very hard to read. The style guide says "keep things in one function unless composable or reusable" — but this isn't about reuse, it's about the JSX being unreadable with that much logic inline.

---

### 22. Multiple `let` declarations for refs could use definite assignment pattern (lines 59-61)

```tsx
// Before (lines 59-61)
let input: TextareaRenderable
let anchor: BoxRenderable
let autocomplete: AutocompleteRef
```

These are idiomatic in SolidJS for ref callbacks, so this is acceptable. No change needed — just noting that the style guide's `const` preference doesn't apply to SolidJS ref patterns.

---

### 23. Inconsistent `input.clear()` vs `input.setText("")` usage

In some places the code uses `input.clear()` and in others `input.setText(content)`. The `ref.reset()` method calls both `input.clear()` and `input.extmarks.clear()` while `submit()` calls `input.clear()` at the very end (line 645) after already setting the store. This is fine functionally but the ordering in `submit()` is odd — the store is reset on line 630 but the input is cleared on line 645 after the navigation timeout. Moving `input.clear()` next to the other cleanup would be clearer.

---

### 24. Unnecessary variable `nonTextParts` in editor command (line 251)

```tsx
// Before (line 251)
const nonTextParts = store.prompt.parts.filter((p) => p.type !== "text")

// ...25 lines later (line 313)
parts: updatedNonTextParts,
```

`nonTextParts` is used only as the input to the `.map()` chain that produces `updatedNonTextParts`. Could be chained:

```tsx
const updatedParts = store.prompt.parts
  .filter((p) => p.type !== "text")
  .map((part) => { ... })
  .filter((part) => part !== null)
```

**Why**: Reduces variable count per style guide.
