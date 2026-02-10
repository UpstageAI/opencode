# Review: `dialog-help.tsx`

## Summary

This is a small, simple component (41 lines). Overall quality is decent — the structure is clear and the JSX layout is readable. However, there are a few style guide violations and minor issues worth fixing.

---

## Issue 1: Unnecessary destructuring of `useTheme()` (line 9)

The style guide says: **"Avoid unnecessary destructuring. Use dot notation to preserve context."**

Every other dialog in this codebase (`dialog-alert.tsx`, `dialog-confirm.tsx`) also destructures `{ theme }` from `useTheme()` — this is a codebase-wide pattern violation, but it still applies here. Destructuring a single property from a context hook loses the association with its source.

**Before (line 9):**

```tsx
const { theme } = useTheme()
```

**After:**

```tsx
const theme = useTheme().theme
```

This preserves the origin (`useTheme()`) while still giving a clean local name. Alternatively, if other properties of the theme context were used, dot notation (`theme.theme.text`) would be awkward — but since only `.theme` is accessed, extracting it directly is fine.

**Why:** Follows the style guide preference against destructuring. Keeps one clear assignment.

---

## Issue 2: Inconsistent import path style (lines 2–3, 5)

Compare the imports in this file vs. sibling dialog files:

**dialog-help.tsx:**

```tsx
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeybind } from "@tui/context/keybind"
```

**dialog-alert.tsx / dialog-confirm.tsx:**

```tsx
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
```

`dialog-help.tsx` uses the `@tui/` alias for `useTheme` and `useKeybind`, while sibling files use relative paths (`../context/theme`). This is an inconsistency across the dialog files. Either style works, but within the same directory of closely related components, consistency matters.

**Why:** Inconsistent import styles make it harder to grep for usages and create cognitive friction when reading related files.

---

## Issue 3: `useKeyboard` handler could use `||` instead of two comparisons (line 13)

This is very minor, but the condition reads slightly more naturally collapsed:

**Before (line 13):**

```tsx
if (evt.name === "return" || evt.name === "escape") {
```

This is actually fine as-is. No change needed — it's readable and clear. Mentioned only for completeness.

---

## Issue 4: No static `.show()` helper like sibling dialogs

`dialog-alert.tsx` and `dialog-confirm.tsx` both export a static `.show()` method on the component:

```tsx
DialogAlert.show = (dialog: DialogContext, title: string, message: string) => {
  return new Promise<void>((resolve) => {
    dialog.replace(
      () => <DialogAlert title={title} message={message} onConfirm={() => resolve()} />,
      () => resolve(),
    )
  })
}
```

`DialogHelp` has no such helper. If callers need to imperatively show the help dialog, they must manually call `dialog.replace(() => <DialogHelp />)` themselves. This isn't necessarily a bug — if there's only one call site and no need for a promise-based API, it's fine. But it's worth noting as an inconsistency with the sibling pattern.

**Why:** Consistency with sibling dialog components. If help is shown from multiple places, a `.show()` helper avoids duplication.

---

## Issue 5: `useKeybind` is used only once — could be inlined (line 10, 30)

The `keybind` variable is used exactly once, on line 30. Per the style guide: **"Reduce total variable count by inlining when a value is only used once."**

**Before (lines 10, 29–31):**

```tsx
const keybind = useKeybind()

// ...
<text fg={theme.textMuted}>
  Press {keybind.print("command_list")} to see all available actions and commands in any context.
</text>
```

**After:**

```tsx
<text fg={theme.textMuted}>
  Press {useKeybind().print("command_list")} to see all available actions and commands in any context.
</text>
```

**Why:** Removes a variable that exists only to be dereferenced once. Follows the style guide principle of reducing variable count by inlining single-use values.

**Caveat:** In SolidJS, calling `useKeybind()` inside JSX is fine because hooks in Solid are just function calls that read from context — they don't have the React "rules of hooks" restriction. The context lookup happens once during component creation regardless of where the call is placed.

---

## Issue 6: `dialog` variable is used twice — but could still be worth inlining in the keyboard handler (line 8)

`dialog` is used in three places (lines 14, 24, 34), so inlining would not be appropriate here. This is fine as-is.

---

## Suggested cleaned-up version

```tsx
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"

export function DialogHelp() {
  const dialog = useDialog()
  const theme = useTheme().theme

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Help
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>
          Press {useKeybind().print("command_list")} to see all available actions and commands in any context.
        </text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  )
}
```

Changes from original:

1. `const { theme } = useTheme()` → `const theme = useTheme().theme` (no destructuring)
2. Removed `const keybind = useKeybind()` variable, inlined the single usage

---

## What's already good

- Clean, minimal component — does one thing
- Consistent JSX structure matching sibling dialogs
- Proper use of `useKeyboard` for keyboard handling
- No unnecessary type annotations
- No `let`, no `else`, no `try/catch`
- No `any` types
- Single-word variable names (`dialog`, `theme`, `keybind`)
