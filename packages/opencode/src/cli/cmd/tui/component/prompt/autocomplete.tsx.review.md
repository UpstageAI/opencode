# Code Review: `autocomplete.tsx`

## Summary

The file is functional but has a number of style guide violations and readability issues. The main problems are: unnecessary destructuring, multi-word variable names, `let` where `const` would work, `else` branches that should be early returns, for-loops where functional methods are preferred, single-use variables that should be inlined, and overly verbose type annotations. There are also some dead/redundant code patterns and inconsistent naming.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 81)

Destructuring `{ theme }` loses context about where `theme` comes from. Per style guide: "Avoid unnecessary destructuring. Use dot notation to preserve context."

However, `theme` is used ~20 times throughout the JSX, so accessing it as `useTheme().theme` every time would be worse. This one is borderline acceptable since it's used so heavily and `theme` is clear enough on its own. **Low priority.**

---

### 2. Multi-word variable names (lines 92, 137, 153, 247, 260, 385-392)

The style guide says "Prefer single word variable names where possible."

**Line 92 -- `positionTick` / `setPositionTick`:**
This is a Solid signal, so the naming is driven by convention. Acceptable.

**Line 137 -- `search` / `setSearch`:**
Fine -- single word.

**Lines 385-387 -- `filesValue`, `agentsValue`, `commandsValue`:**
These are needlessly suffixed with `Value`.

```tsx
// Before (line 385-387)
const filesValue = files()
const agentsValue = agents()
const commandsValue = commands()

// After -- just inline them since they're only used once each
const mixed: AutocompleteOption[] =
  store.visible === "@" ? [...agents(), ...(files() || []), ...mcpResources()] : [...commands()]
```

This also eliminates 3 single-use variables per the "reduce variable count by inlining" rule.

---

### 3. Single-use variable `searchValue` should be inlined (line 392)

```tsx
// Before (lines 392-396)
const searchValue = search()

if (!searchValue) {
  return mixed
}

// After
if (!search()) {
  return mixed
}
```

But note `search()` is also used on line 402. Since it's a signal call, calling it twice is fine (signals are cached), but if you want to avoid the double-call, a single `const s = search()` is cleaner than `searchValue`.

```tsx
// Alternative
const s = search()
if (!s) return mixed

// ...
const result = fuzzysort.go(removeLineRange(s), mixed, { ... })
```

---

### 4. Unnecessary `let` in `move()` -- use modular arithmetic (lines 428-435)

```tsx
// Before
function move(direction: -1 | 1) {
  if (!store.visible) return
  if (!options().length) return
  let next = store.selected + direction
  if (next < 0) next = options().length - 1
  if (next >= options().length) next = 0
  moveTo(next)
}

// After -- const with modular wrap
function move(direction: -1 | 1) {
  if (!store.visible) return
  const len = options().length
  if (!len) return
  moveTo((store.selected + direction + len) % len)
}
```

Eliminates `let`, two `if` reassignments, and the intermediate variable. Cleaner wrap-around logic.

---

### 5. `else` in `tab` handler (lines 571-577)

Style guide says "Avoid `else` statements. Prefer early returns."

```tsx
// Before (lines 571-578)
if (name === "tab") {
  const selected = options()[store.selected]
  if (selected?.isDirectory) {
    expandDirectory()
  } else {
    select()
  }
  e.preventDefault()
  return
}

// After
if (name === "tab") {
  const selected = options()[store.selected]
  if (selected?.isDirectory) expandDirectory()
  else select()
  e.preventDefault()
  return
}
```

Since both branches are single expressions and the function continues after, this is a minor style point. But the cleanest version removes the `else`:

```tsx
if (name === "tab") {
  if (options()[store.selected]?.isDirectory) expandDirectory()
  else select()
  e.preventDefault()
  return
}
```

This also inlines the single-use `selected` variable.

---

### 6. `else if` chain in `insertPart` (lines 202-210)

```tsx
// Before (lines 202-210)
if (part.type === "file" && part.source?.text) {
  part.source.text.start = extmarkStart
  part.source.text.end = extmarkEnd
  part.source.text.value = virtualText
} else if (part.type === "agent" && part.source) {
  part.source.start = extmarkStart
  part.source.end = extmarkEnd
  part.source.value = virtualText
}
```

This is within a closure passed to `setPrompt`, not a standalone function, so early returns aren't applicable here. The `else if` is acceptable in this context since it's a type-discriminated branch. **Low priority.**

---

### 7. For-loop should be functional `map` (lines 303-328 -- `mcpResources`)

Style guide: "Prefer functional array methods (flatMap, filter, map) over for loops."

```tsx
// Before (lines 300-331)
const mcpResources = createMemo(() => {
  if (!store.visible || store.visible === "/") return []

  const options: AutocompleteOption[] = []
  const width = props.anchor().width - 4

  for (const res of Object.values(sync.data.mcp_resource)) {
    const text = `${res.name} (${res.uri})`
    options.push({
      display: Locale.truncateMiddle(text, width),
      value: text,
      description: res.description,
      onSelect: () => { ... },
    })
  }

  return options
})

// After
const mcpResources = createMemo(() => {
  if (!store.visible || store.visible === "/") return []

  const width = props.anchor().width - 4
  return Object.values(sync.data.mcp_resource).map((res): AutocompleteOption => {
    const text = `${res.name} (${res.uri})`
    return {
      display: Locale.truncateMiddle(text, width),
      value: text,
      description: res.description,
      onSelect: () => {
        insertPart(res.name, {
          type: "file",
          mime: res.mimeType ?? "text/plain",
          filename: res.name,
          url: res.uri,
          source: {
            type: "resource",
            text: { start: 0, end: 0, value: "" },
            clientName: res.client,
            uri: res.uri,
          },
        })
      },
    }
  })
})
```

Eliminates the mutable `options` array and the imperative loop.

---

### 8. For-loop should be functional `map`/`flatMap` (lines 358-372 -- `commands`)

Same issue as above.

```tsx
// Before (lines 358-372)
for (const serverCommand of sync.data.command) {
  if (serverCommand.source === "skill") continue
  const label = serverCommand.source === "mcp" ? ":mcp" : ""
  results.push({
    display: "/" + serverCommand.name + label,
    description: serverCommand.description,
    onSelect: () => { ... },
  })
}

// After
const results: AutocompleteOption[] = [
  ...command.slashes(),
  ...sync.data.command
    .filter((cmd) => cmd.source !== "skill")
    .map((cmd): AutocompleteOption => {
      const label = cmd.source === "mcp" ? ":mcp" : ""
      return {
        display: "/" + cmd.name + label,
        description: cmd.description,
        onSelect: () => {
          const text = "/" + cmd.name + " "
          const cursor = props.input().logicalCursor
          props.input().deleteRange(0, 0, cursor.row, cursor.col)
          props.input().insertText(text)
          props.input().cursorOffset = Bun.stringWidth(text)
        },
      }
    }),
]
```

---

### 9. Redundant variable in `agents` memo (lines 333-335)

```tsx
// Before (lines 333-335)
const agents = createMemo(() => {
  const agents = sync.data.agent
  return agents
    .filter(...)

// After
const agents = createMemo(() => {
  return sync.data.agent
    .filter(...)
```

The inner `const agents = sync.data.agent` shadows the outer `agents` and is only used once. Inline it.

---

### 10. Ternary for `setSearch` (lines 139-141)

```tsx
// Before (line 140)
setSearch(next ? next : "")

// After
setSearch(next ?? "")
```

`next` is `string | undefined`, so `??` is more precise and idiomatic than a truthy check (which would also coerce empty string to `""`). Actually since `filter()` returns `string | undefined`, `?? ""` is clearer about intent.

---

### 11. Single-use variables that should be inlined in `insertPart` (lines 152-156)

```tsx
// Before (lines 152-156)
const input = props.input()
const currentCursorOffset = input.cursorOffset

const charAfterCursor = props.value.at(currentCursorOffset)
const needsSpace = charAfterCursor !== " "
const append = "@" + text + (needsSpace ? " " : "")

// After
const input = props.input()
const offset = input.cursorOffset
const append = "@" + text + (props.value.at(offset) !== " " ? " " : "")
```

`input` is used many times so keeping it is fine. But `charAfterCursor` and `needsSpace` are single-use and can be inlined. Also `currentCursorOffset` is a long name -- `offset` is sufficient.

---

### 12. Same pattern in `expandDirectory` (lines 460-461)

```tsx
// Before (lines 460-461)
const input = props.input()
const currentCursorOffset = input.cursorOffset

// After
const input = props.input()
const offset = input.cursorOffset
```

`currentCursorOffset` is verbose. `offset` is clear enough given the surrounding code.

---

### 13. `let scroll` should use a different pattern (line 606)

```tsx
// Before (line 606)
let scroll: ScrollBoxRenderable
```

This is a ref pattern common in Solid.js -- assigning via `ref={(r) => (scroll = r)}`. The `let` is unavoidable here due to how Solid refs work. **No change needed**, but adding `!` (definite assignment) could be considered if the type system complains, though it doesn't appear to here.

---

### 14. Unnecessary explicit type annotation on `options` memo (line 384)

```tsx
// Before (line 384)
const options = createMemo((prev: AutocompleteOption[] | undefined) => {

// This is acceptable -- the `prev` parameter type annotation is needed because
// createMemo's accumulator pattern requires it for the overload resolution.
```

**No change needed.**

---

### 15. `displayText` / `path` intermediate in `expandDirectory` (lines 463-464)

```tsx
// Before (lines 463-464)
const displayText = selected.display.trimEnd()
const path = displayText.startsWith("@") ? displayText.slice(1) : displayText

// After -- inline displayText since it's only used once
const display = selected.display.trimEnd()
const path = display.startsWith("@") ? display.slice(1) : display
```

Or even more aggressively:

```tsx
const path = selected.display.trimEnd().replace(/^@/, "")
```

This is cleaner and eliminates both variables into one.

---

### 16. Unnecessary empty `options` array + spread in `files` resource (lines 233, 248)

```tsx
// Before (lines 233, 247-287)
const options: AutocompleteOption[] = []

if (!result.error && result.data) {
  // ...
  options.push(
    ...sortedFiles.map(...)
  )
}

return options

// After -- early return pattern
if (result.error || !result.data) return []

const width = props.anchor().width - 4
return result.data
  .sort((a, b) => { ... })
  .map((item): AutocompleteOption => { ... })
```

This eliminates the mutable `options` array, the `push(...spread)` pattern, and the wrapping `if` block. Cleaner control flow with early return.

---

### 17. Redundant comment blocks (lines 228, 234-235)

```tsx
// Get files from SDK          <- obvious from the code
// Add file options             <- obvious from the code
```

These comments describe _what_ the code does, not _why_. They add noise without value. Remove them.

---

### 18. `newText` variable used once in `commands` (lines 365-369)

```tsx
// Before (lines 365-369)
const newText = "/" + serverCommand.name + " "
const cursor = props.input().logicalCursor
props.input().deleteRange(0, 0, cursor.row, cursor.col)
props.input().insertText(newText)
props.input().cursorOffset = Bun.stringWidth(newText)

// After -- `newText` is used twice (insertText + stringWidth), so keeping it is correct.
```

Actually `newText` is used twice here, so it should stay. **No change needed.**

---

### 19. Inconsistent `if` / `return` style in `onKeyDown` (lines 582-593)

The `store.visible` block uses early returns consistently, but the `!store.visible` block at lines 582-593 doesn't return after `show("@")`:

```tsx
// Before (lines 582-593)
if (!store.visible) {
  if (e.name === "@") {
    const cursorOffset = props.input().cursorOffset
    const charBeforeCursor = cursorOffset === 0 ? undefined : props.input().getTextRange(cursorOffset - 1, cursorOffset)
    const canTrigger = charBeforeCursor === undefined || charBeforeCursor === "" || /\s/.test(charBeforeCursor)
    if (canTrigger) show("@")
  }

  if (e.name === "/") {
    if (props.input().cursorOffset === 0) show("/")
  }
}

// After -- flatten and inline
if (!store.visible && e.name === "@") {
  const offset = props.input().cursorOffset
  const before = offset === 0 ? undefined : props.input().getTextRange(offset - 1, offset)
  if (before === undefined || before === "" || /\s/.test(before)) show("@")
  return
}
if (!store.visible && e.name === "/") {
  if (props.input().cursorOffset === 0) show("/")
  return
}
```

This also renames `cursorOffset` -> `offset` and `charBeforeCursor` -> `before`, and removes the single-use `canTrigger`.

---

### 20. `extractLineRange` could use early return instead of nesting (lines 22-47)

The function is structured well with early returns already. **No change needed.**

---

## Priority Summary

| Priority | Issue                                                                                                             | Lines                              |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| High     | For-loops should be `.map()` / `.filter()`                                                                        | 303-328, 358-372                   |
| High     | Inline single-use variables / reduce variable count                                                               | 233-288, 385-392, 463-464, 582-593 |
| Medium   | `let` in `move()` -- use modular arithmetic                                                                       | 428-435                            |
| Medium   | Redundant inner variable shadowing outer name                                                                     | 333-335                            |
| Medium   | Verbose variable names (`currentCursorOffset`, `charBeforeCursor`, `charAfterCursor`, `needsSpace`, `filesValue`) | 152-156, 460-461, 385-387, 584-587 |
| Medium   | `next ? next : ""` should be `next ?? ""`                                                                         | 140                                |
| Low      | Redundant comments                                                                                                | 228, 234-235                       |
| Low      | `else` in tab handler                                                                                             | 571-577                            |
| Low      | Mutable `options` array pattern in `files` resource                                                               | 233-288                            |
