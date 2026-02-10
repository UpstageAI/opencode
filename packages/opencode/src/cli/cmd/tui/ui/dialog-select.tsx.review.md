# Review: `dialog-select.tsx`

## Summary

The file is reasonably well-structured but has several style guide violations: unnecessary destructuring, unnecessary variables, a `let` that could be `const`, commented-out code, and some verbose patterns that reduce readability. The `Option` component has an unused prop. Most issues are minor but collectively they add friction when reading the code.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (lines 51, 356)

The style guide says to avoid destructuring and prefer dot notation. `theme` is used extensively, so destructuring isn't terrible here, but it violates the convention. Since `theme` is used dozens of times in JSX, this one is borderline -- keeping dot notation would be verbose in the JSX. However, both instances destructure identically and should at least be consistent with the rest of the codebase's direction.

```tsx
// Before (line 51)
const { theme } = useTheme()

// After
const theme = useTheme().theme
```

Same at line 356. This preserves the single variable while avoiding destructuring syntax.

---

### 2. Unnecessary intermediate variable `result` in `filtered` memo (lines 85-92)

The `result` variable is only used once. Inline it.

```tsx
// Before (lines 85-92)
const result = fuzzysort
  .go(needle, options, {
    keys: ["title", "category"],
    scoreFn: (r) => r[0].score * 2 + r[1].score,
  })
  .map((x) => x.obj)

return result

// After
return fuzzysort
  .go(needle, options, {
    keys: ["title", "category"],
    scoreFn: (r) => r[0].score * 2 + r[1].score,
  })
  .map((x) => x.obj)
```

**Why:** Reduces variable count. The value is used exactly once, so the name adds no clarity.

---

### 3. Unnecessary intermediate variable `result` in `grouped` memo (lines 103-111)

Same pattern -- `result` assigned and immediately returned.

```tsx
// Before (lines 103-111)
const grouped = createMemo(() => {
  const result = pipe(
    filtered(),
    groupBy((x) => x.category ?? ""),
    entries(),
  )
  return result
})

// After
const grouped = createMemo(() =>
  pipe(
    filtered(),
    groupBy((x) => x.category ?? ""),
    entries(),
  ),
)
```

**Why:** Removes dead weight. Also removes the commented-out `mapValues` line (line 107), which is noise.

---

### 4. Commented-out code (line 107)

```tsx
// mapValues((x) => x.sort((a, b) => a.title.localeCompare(b.title))),
```

Dead code should be removed. Version control exists for history.

---

### 5. Unnecessary `return` wrapper in `flat` memo (lines 113-118)

```tsx
// Before (lines 113-118)
const flat = createMemo(() => {
  return pipe(
    grouped(),
    flatMap(([_, options]) => options),
  )
})

// After
const flat = createMemo(() =>
  pipe(
    grouped(),
    flatMap(([_, options]) => options),
  ),
)
```

**Why:** Arrow with expression body is more concise than arrow with block body containing a single return.

---

### 6. `let` used for `input` (line 72)

`input` is assigned once via `ref` callback and never reassigned in normal flow. This is a DOM ref pattern so `let` is actually necessary here (assigned in JSX ref callback). No change needed -- this is an acceptable use of `let` for ref capture.

---

### 7. `move` function uses `let` where modular arithmetic would work (lines 142-148)

```tsx
// Before (lines 142-148)
function move(direction: number) {
  if (flat().length === 0) return
  let next = store.selected + direction
  if (next < 0) next = flat().length - 1
  if (next >= flat().length) next = 0
  moveTo(next, true)
}

// After
function move(direction: number) {
  const len = flat().length
  if (len === 0) return
  moveTo((((store.selected + direction) % len) + len) % len, true)
}
```

**Why:** Replaces `let` with `const` and removes two conditionals. The modular arithmetic pattern `((n % len) + len) % len` is standard for wrapping indices. However, if the team considers the modular arithmetic less readable, a simpler improvement:

```tsx
// Alternative
function move(direction: number) {
  if (flat().length === 0) return
  const next = store.selected + direction
  moveTo(next < 0 ? flat().length - 1 : next >= flat().length ? 0 : next, true)
}
```

---

### 8. `moveTo` uses `else` (lines 160-173)

```tsx
// Before (lines 160-173)
if (center) {
  const centerOffset = Math.floor(scroll.height / 2)
  scroll.scrollBy(y - centerOffset)
} else {
  if (y >= scroll.height) {
    scroll.scrollBy(y - scroll.height + 1)
  }
  if (y < 0) {
    scroll.scrollBy(y)
    if (isDeepEqual(flat()[0].value, selected()?.value)) {
      scroll.scrollTo(0)
    }
  }
}

// After
if (center) {
  scroll.scrollBy(y - Math.floor(scroll.height / 2))
  return
}
if (y >= scroll.height) {
  scroll.scrollBy(y - scroll.height + 1)
}
if (y < 0) {
  scroll.scrollBy(y)
  if (isDeepEqual(flat()[0].value, selected()?.value)) {
    scroll.scrollTo(0)
  }
}
```

**Why:** Early return eliminates `else` block and reduces nesting by one level. Also inlines the single-use `centerOffset` variable.

---

### 9. Unused `onMouseOver` prop in `Option` component (line 354)

```tsx
// Before (line 354)
function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
  onMouseOver?: () => void // <-- never used in the component body
})
```

`onMouseOver` is declared in the props type but never referenced in the component's JSX or logic. Remove it.

```tsx
// After
function Option(props: {
  title: string
  description?: string
  active?: boolean
  current?: boolean
  footer?: JSX.Element | string
  gutter?: JSX.Element
})
```

**Why:** Dead code in a type definition is misleading -- it suggests the component handles mouse events when it doesn't.

---

### 10. Verbose `for...of` loop for keybind matching (lines 197-206)

```tsx
// Before (lines 197-206)
for (const item of props.keybind ?? []) {
  if (item.disabled || !item.keybind) continue
  if (Keybind.match(item.keybind, keybind.parse(evt))) {
    const s = selected()
    if (s) {
      evt.preventDefault()
      item.onTrigger(s)
    }
  }
}

// After
const s = selected()
const parsed = keybind.parse(evt)
for (const item of props.keybind ?? []) {
  if (item.disabled || !item.keybind) continue
  if (!Keybind.match(item.keybind, parsed)) continue
  if (!s) continue
  evt.preventDefault()
  item.onTrigger(s)
}
```

**Why:** `keybind.parse(evt)` and `selected()` are called inside a loop but don't change per iteration -- hoist them. Also flattens nesting with early `continue`. Note: the style guide prefers functional array methods, but in this case the early-exit behavior (`evt.preventDefault`) makes `for...of` acceptable. Alternatively:

```tsx
const s = selected()
if (!s) return
const parsed = keybind.parse(evt)
;(props.keybind ?? [])
  .filter((item) => !item.disabled && item.keybind && Keybind.match(item.keybind, parsed))
  .forEach((item) => {
    evt.preventDefault()
    item.onTrigger(s)
  })
```

---

### 11. `any` type in `DialogSelectOption` (line 32)

```tsx
// Before (line 32)
export interface DialogSelectOption<T = any> {
```

The style guide says to avoid `any`. Consider `unknown` as the default:

```tsx
// After
export interface DialogSelectOption<T = unknown> {
```

**Why:** `unknown` is type-safe. Consumers that don't pass a type parameter will need to narrow, which prevents accidental misuse. This may require downstream changes, so verify callsites first.

---

### 12. Duplicate `isDeepEqual` import (lines 4 and 8)

`isDeepEqual` is imported from `remeda` on line 8 separately from the other `remeda` imports on line 3. Consolidate:

```tsx
// Before (lines 3, 8)
import { entries, filter, flatMap, groupBy, pipe, take } from "remeda"
...
import { isDeepEqual } from "remeda"

// After
import { entries, filter, flatMap, groupBy, isDeepEqual, pipe, take } from "remeda"
```

**Why:** Two import statements from the same module is messy and suggests the second was added as an afterthought.

---

### 13. Unused import: `take` (line 3)

`take` is imported from `remeda` but never used in the file. Remove it.

```tsx
// Before
import { entries, filter, flatMap, groupBy, pipe, take } from "remeda"

// After
import { entries, filter, flatMap, groupBy, isDeepEqual, pipe } from "remeda"
```

**Why:** Dead imports are noise and may confuse readers into thinking the function is used somewhere.

---

### 14. Variable name `s` is too terse (line 200)

```tsx
const s = selected()
```

While the style guide says prefer single-word names, `s` is a single _letter_ and provides no context. In a block where `selected` is the memo, call the result `option` to match the pattern used on line 188.

```tsx
// Before (line 200)
const s = selected()
if (s) {
  evt.preventDefault()
  item.onTrigger(s)
}

// After
const option = selected()
if (option) {
  evt.preventDefault()
  item.onTrigger(option)
}
```

**Why:** `option` communicates what the value represents. `s` requires the reader to look up what `selected()` returns.

---

### 15. `paddingLeft={3}` on text inside `Option` (line 378)

The `Option` component has `paddingLeft={3}` on its text element, while the parent `<box>` in `DialogSelect` conditionally sets `paddingLeft` to 1 or 3. This padding logic is split across two components, making layout reasoning harder. Not a code quality bug per se, but worth noting for maintainability -- consider consolidating padding decisions in one place.

---

## Minor Nits

- **Line 55**: The `as` cast `"keyboard" as "keyboard" | "mouse"` is fine but could also be expressed with `satisfies` or a type annotation on the store. Low priority.
- **Line 268**: `ref={(r: ScrollBoxRenderable) => (scroll = r)}` -- the explicit type annotation on `r` may be unnecessary if the JSX intrinsic types provide it. Worth checking.
