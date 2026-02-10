# Review: `logo.tsx`

## Summary

This is a small 86-line file that renders the ASCII logo with shadow effects. It's mostly fine, but has a few issues: unnecessary destructuring, a mutable imperative loop where a recursive or functional approach would be cleaner, a needless type annotation, and a `let` that could be avoided.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 13)

The style guide says to avoid unnecessary destructuring and prefer dot notation. Only `theme` is used from `useTheme()`, but destructuring it loses the context of where it came from.

**Before:**

```tsx
const { theme } = useTheme()
```

**After:**

```tsx
const ctx = useTheme()
```

Then use `ctx.theme` throughout. However, `theme` is used many times in `renderLine` and the JSX (lines 16, 78, 79), so destructuring a single heavily-used property is arguably justified here. This is a minor/borderline issue -- the guide says "avoid unnecessary destructuring" but when there's a single property used repeatedly, it can go either way. Worth flagging but not urgent.

---

### 2. Explicit type annotation on `renderLine` is unnecessary (line 15)

The return type `: JSX.Element[]` and parameter type for `line` can be inferred or are obvious from usage. The parameter types are needed since this is a callback, but the return type annotation is redundant -- TypeScript will infer it from the function body.

**Before:**

```tsx
const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
```

**After:**

```tsx
const renderLine = (line: string, fg: RGBA, bold: boolean) => {
```

**Why:** The style guide says to rely on type inference when possible. The return type is trivially inferred from the `elements` array and the `return` statement.

---

### 3. Imperative while loop with mutable `let i` and mutable `elements` array (lines 18-70)

This is the biggest issue. The function uses a `while` loop with `let i` and mutates an `elements` array via `.push()`. This is a classic imperative pattern that's harder to follow than a recursive approach or a split-and-map pattern.

The entire `renderLine` function can be rewritten to split the line by the marker regex and map over segments, eliminating `let i`, the `while` loop, and the mutable array.

**Before:**

```tsx
const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
  const shadow = tint(theme.background, fg, 0.25)
  const attrs = bold ? TextAttributes.BOLD : undefined
  const elements: JSX.Element[] = []
  let i = 0

  while (i < line.length) {
    const rest = line.slice(i)
    const markerIndex = rest.search(SHADOW_MARKER)

    if (markerIndex === -1) {
      elements.push(
        <text fg={fg} attributes={attrs} selectable={false}>
          {rest}
        </text>,
      )
      break
    }

    if (markerIndex > 0) {
      elements.push(
        <text fg={fg} attributes={attrs} selectable={false}>
          {rest.slice(0, markerIndex)}
        </text>,
      )
    }

    const marker = rest[markerIndex]
    switch (marker) {
      case "_":
        elements.push(
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>,
        )
        break
      case "^":
        elements.push(
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>,
        )
        break
      case "~":
        elements.push(
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>,
        )
        break
    }

    i += markerIndex + 1
  }

  return elements
}
```

**After:**

```tsx
const renderLine = (line: string, fg: RGBA, bold: boolean) => {
  const shadow = tint(theme.background, fg, 0.25)
  const attrs = bold ? TextAttributes.BOLD : undefined

  return line
    .split(/([_^~])/)
    .filter(Boolean)
    .map((part) => {
      if (part === "_")
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      if (part === "^")
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      if (part === "~")
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {part}
        </text>
      )
    })
}
```

**Why:** This eliminates:

- `let i = 0` (the style guide prefers `const`)
- The mutable `elements` array
- The `while` loop (the style guide prefers functional array methods)
- ~30 lines of code

The `split` with a capture group regex preserves both the separators and the text between them, making this a natural fit. The `.filter(Boolean)` removes any empty strings from the split result.

Note: the hardcoded `[_^~]` duplicates the marker chars, but `marks` is just `"_^~"` so this could use the same source:

```tsx
return line.split(new RegExp(`([${marks}])`)).filter(Boolean).map((part) => {
```

Though since the regex only needs to be built once, you could hoist it:

```tsx
const SHADOW_SPLIT = new RegExp(`([${marks}])`)
```

---

### 4. `SHADOW_MARKER` regex is unused if the split approach is adopted (line 10)

If issue #3 is addressed, `SHADOW_MARKER` on line 10 becomes dead code and should be removed. Even in the current code, the name `SHADOW_MARKER` is slightly misleading -- it's a pattern that _matches_ markers, not a marker itself. A name like `SHADOW_PATTERN` would be marginally clearer, but this is minor.

---

### 5. Intermediate variable `attrs` could be inlined (line 17)

The variable `attrs` is a simple ternary used in multiple places, so keeping it as a variable is fine for DRY reasons. No change needed -- just noting this was considered and is acceptable.

---

### 6. `shadow` variable name is good but `renderLine` is verbose (line 15)

The style guide prefers single-word names. `renderLine` could be just `render` since it's a local function and the context (inside `Logo`) makes it clear what's being rendered.

**Before:**

```tsx
const renderLine = (line: string, fg: RGBA, bold: boolean) => {
```

**After:**

```tsx
const render = (line: string, fg: RGBA, bold: boolean) => {
```

**Why:** Single-word names are preferred. The function is local to `Logo`, so `render` is unambiguous.

---

## Summary of recommended changes

| Priority   | Line(s) | Issue                                                         |
| ---------- | ------- | ------------------------------------------------------------- |
| High       | 18-70   | Replace imperative while loop with `split`/`map`              |
| Medium     | 15      | Remove redundant return type annotation                       |
| Low        | 15      | Rename `renderLine` to `render`                               |
| Low        | 10      | Remove or repurpose `SHADOW_MARKER` if split approach adopted |
| Borderline | 13      | Destructuring `{ theme }` -- acceptable given heavy usage     |
