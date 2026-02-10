# Review: `todo-item.tsx`

## Summary

This is a small, 33-line component. It's reasonably clean, but has a few style guide violations and a duplicated expression that hurts readability. None of the issues are severe, but fixing them would make the file tighter and more consistent with project conventions.

---

## Issues

### 1. Exported interface is unnecessary (lines 3-6)

The `TodoItemProps` interface is exported but only consumed internally by the `TodoItem` function on line 8. No other file imports `TodoItemProps` -- callers just pass `status` and `content` as JSX attributes. Exporting it adds noise to the module's public API for no benefit. Additionally, an inline type annotation avoids the need for a named interface entirely, which is preferred when the type isn't reused.

If keeping the interface is desired for documentation purposes, it should at minimum not be exported. But per the style guide ("rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity"), an inline type is cleaner here.

**Before (lines 3-8):**

```tsx
export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
```

**After:**

```tsx
export function TodoItem(props: { status: string; content: string }) {
```

**Why:** Removes a standalone type that isn't imported anywhere. Fewer exports, fewer lines, less indirection. One less name to track.

---

### 2. Duplicated color expression (lines 16 and 25)

The same ternary `props.status === "in_progress" ? theme.warning : theme.textMuted` appears identically on lines 16 and 25. This is a readability issue -- if the color logic changes, you'd need to update two places. Extract it to a local variable once.

**Before (lines 12-29):**

```tsx
<box flexDirection="row" gap={0}>
  <text
    flexShrink={0}
    style={{
      fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
    }}
  >
    [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
  </text>
  <text
    flexGrow={1}
    wrapMode="word"
    style={{
      fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
    }}
  >
    {props.content}
  </text>
</box>
```

**After:**

```tsx
const color = props.status === "in_progress" ? theme.warning : theme.textMuted

return (
  <box flexDirection="row" gap={0}>
    <text flexShrink={0} style={{ fg: color }}>
      [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
    </text>
    <text flexGrow={1} wrapMode="word" style={{ fg: color }}>
      {props.content}
    </text>
  </box>
)
```

**Why:** DRY. The duplicated ternary is the longest expression in the component and it appears twice. Extracting it makes both `<text>` style props trivially readable and ensures the two elements always share the same color.

---

### 3. Nested ternary for the icon is hard to scan (line 19)

The checkbox icon expression is a double-nested ternary on a single line:

```tsx
[{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
```

This is dense. A local variable with a clearer name makes the three states explicit and easier to scan.

**Before (line 19):**

```tsx
[{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]{" "}
```

**After:**

```tsx
const icon = props.status === "completed"
  ? "✓"
  : props.status === "in_progress"
    ? "•"
    : " "

// then in JSX:
[{icon}]{" "}
```

**Why:** The nested ternary inlined in JSX is the densest expression in the file. Breaking it out gives it a name (`icon`) and vertical formatting that makes the three branches scannable at a glance. This also lets the JSX line focus on structure rather than logic.

---

### 4. Destructuring `{ theme }` from `useTheme()` (line 9)

Per the style guide: "Avoid unnecessary destructuring. Use dot notation to preserve context."

However, `const { theme } = useTheme()` is the dominant pattern across the entire codebase (42 occurrences vs 1 use of dot notation). Changing this single file would make it the odd one out. **This is a codebase-wide inconsistency, not a per-file fix.** Flagging it for awareness but recommending no change in isolation.

---

### 5. `status` type is `string` but only three values are valid (line 4)

The `status` prop is typed as `string`, but the component only handles three states: `"completed"`, `"in_progress"`, and an implicit default (pending/empty). A union type would make the contract explicit and catch typos at compile time.

**Before:**

```tsx
status: string
```

**After:**

```tsx
status: "completed" | "in_progress" | "pending"
```

**Why:** The component already branches on specific string values. A union type documents the valid states and gives TypeScript the ability to flag invalid usage. That said, if the status values come from an external API/SDK type, it may be better to reference that type directly rather than duplicating the union.

---

## Suggested final version

Applying issues 1, 2, 3 (and optionally 5):

```tsx
import { useTheme } from "../context/theme"

export function TodoItem(props: { status: string; content: string }) {
  const { theme } = useTheme()
  const color = props.status === "in_progress" ? theme.warning : theme.textMuted
  const icon = props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: color }}>
        [{icon}]{" "}
      </text>
      <text flexGrow={1} wrapMode="word" style={{ fg: color }}>
        {props.content}
      </text>
    </box>
  )
}
```

This version is 21 lines (down from 33), removes the duplicated ternary, eliminates the exported interface, and makes the icon logic scannable.
