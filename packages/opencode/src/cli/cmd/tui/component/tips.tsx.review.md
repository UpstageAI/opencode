# Code Review: `tips.tsx`

## Summary

The file is relatively clean but has several style guide violations and unnecessary complexity. The main issues are: an overly complex `parse` function using a confusing `reduce` with a mutable accumulator, an unnecessary type alias, unnecessary destructuring, and a few naming/variable issues. The TIPS array and component itself are straightforward.

---

## Issues

### 1. Unnecessary type alias `TipPart` (line 7)

The `TipPart` type is only used as the return type of `parse`, and that return type can be inferred. Defining a named type for a simple shape used in one place adds unnecessary indirection.

**Before:**

```tsx
type TipPart = { text: string; highlight: boolean }

function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
```

**After:**

```tsx
function parse(tip: string) {
  const parts: { text: string; highlight: boolean }[] = []
```

The type annotation on `parts` is still needed to initialize the empty array with the right shape, but the standalone type alias and explicit return type annotation are unnecessary. Inference handles the return type.

---

### 2. `parse` function is needlessly complex (lines 9-31)

The `reduce` with a mutable accumulator object (`{ parts, index }`) is hard to follow. It mutates `acc.parts` (which is the same reference as the outer `parts` variable), making the data flow confusing. A simpler `replaceAll`/`split` approach or a straightforward while-loop with `regex.exec` would be far more readable.

**Before:**

```tsx
function parse(tip: string): TipPart[] {
  const parts: TipPart[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  const found = Array.from(tip.matchAll(regex))
  const state = found.reduce(
    (acc, match) => {
      const start = match.index ?? 0
      if (start > acc.index) {
        acc.parts.push({ text: tip.slice(acc.index, start), highlight: false })
      }
      acc.parts.push({ text: match[1], highlight: true })
      acc.index = start + match[0].length
      return acc
    },
    { parts, index: 0 },
  )

  if (state.index < tip.length) {
    parts.push({ text: tip.slice(state.index), highlight: false })
  }

  return parts
}
```

**After:**

```tsx
function parse(tip: string) {
  const parts: { text: string; highlight: boolean }[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  let last = 0
  for (const match of tip.matchAll(regex)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: tip.slice(last, start), highlight: false })
    parts.push({ text: match[1], highlight: true })
    last = start + match[0].length
  }
  if (last < tip.length) parts.push({ text: tip.slice(last), highlight: false })
  return parts
}
```

The style guide says "prefer functional array methods over for loops," but `reduce` with a mutable accumulator is not meaningfully more functional than a loop -- it's just harder to read. The `for...of` over `matchAll` is the clearest idiom for this regex-walk pattern. The `reduce` version also needlessly creates an intermediate `Array.from()` copy and a wrapper object. The variable `found` (line 12) and `state` (line 13) are both eliminated.

Note: this is one case where `let` is appropriate -- `last` is a loop cursor that must be reassigned.

---

### 3. Unnecessary destructuring of `useTheme()` (line 34)

The style guide says "avoid unnecessary destructuring, use dot notation to preserve context."

**Before:**

```tsx
const theme = useTheme().theme
```

This is actually fine -- it's not destructuring, it's dot access stored in a variable. No change needed.

---

### 4. `themeCount` variable is used only once (line 4-5)

The style guide says "reduce total variable count by inlining when a value is only used once."

**Before:**

```tsx
const themeCount = Object.keys(DEFAULT_THEMES).length
const themeTip = `Use {highlight}/theme{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${themeCount} built-in themes`
```

**After:**

```tsx
const themeTip = `Use {highlight}/theme{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${Object.keys(DEFAULT_THEMES).length} built-in themes`
```

Inlining removes a single-use intermediate variable without hurting readability.

---

### 5. `found` variable is used only once (line 12)

Already addressed in issue #2. `Array.from(tip.matchAll(regex))` is stored in `found` only to be passed to `reduce`. Eliminating the `reduce` pattern removes this variable entirely.

---

### 6. `start` variable is used only once per iteration (line 16)

Inside the reduce callback, `start` is assigned `match.index ?? 0` and used twice. This is borderline -- keeping it is acceptable since it's used in two places within the same block. However, in the simplified version (issue #2), it remains used twice so it's fine to keep.

---

### 7. Inconsistent mutation pattern in `parse` (lines 10, 13, 17-20, 26-28)

The `parts` array is declared on line 10, passed into `reduce` as part of the initial accumulator on line 22, mutated via `acc.parts.push()` on lines 17/19, and then also mutated directly via `parts.push()` on line 27. The fact that `parts` and `acc.parts` are the same reference is not obvious and makes the code confusing. The `state` variable is only used to read `.index` on line 26, while `.parts` is ignored since it's the same as the outer `parts`. This is the strongest reason to rewrite the function as shown in issue #2.

---

## Final Recommended State

```tsx
import { For } from "solid-js"
import { DEFAULT_THEMES, useTheme } from "@tui/context/theme"

const themeTip = `Use {highlight}/theme{/highlight} or {highlight}Ctrl+X T{/highlight} to switch between ${Object.keys(DEFAULT_THEMES).length} built-in themes`

function parse(tip: string) {
  const parts: { text: string; highlight: boolean }[] = []
  const regex = /\{highlight\}(.*?)\{\/highlight\}/g
  let last = 0
  for (const match of tip.matchAll(regex)) {
    const start = match.index ?? 0
    if (start > last) parts.push({ text: tip.slice(last, start), highlight: false })
    parts.push({ text: match[1], highlight: true })
    last = start + match[0].length
  }
  if (last < tip.length) parts.push({ text: tip.slice(last), highlight: false })
  return parts
}

export function Tips() {
  const theme = useTheme().theme
  const parts = parse(TIPS[Math.floor(Math.random() * TIPS.length)])

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} style={{ fg: theme.warning }}>
        ● Tip{" "}
      </text>
      <text flexShrink={1}>
        <For each={parts}>
          {(part) => <span style={{ fg: part.highlight ? theme.text : theme.textMuted }}>{part.text}</span>}
        </For>
      </text>
    </box>
  )
}

const TIPS = [
  // ... unchanged
]
```

Changes:

- Removed unused imports (`createMemo`, `createSignal`)
- Inlined `themeCount`
- Removed `TipPart` type alias
- Replaced `reduce` with a clear `for...of` loop over `matchAll`
- Eliminated `found` and `state` variables

---

## Unused Imports (line 1)

`createMemo` and `createSignal` are imported but never used anywhere in the file. These should be removed.

**Before:**

```tsx
import { createMemo, createSignal, For } from "solid-js"
```

**After:**

```tsx
import { For } from "solid-js"
```

This is the most clear-cut issue in the file -- dead imports add noise and suggest leftover code from a previous iteration.
