# Review: `dialog-alert.tsx`

## Summary

This is a small, focused component. Overall quality is decent -- the JSX structure is clean and the `show` static method is a nice pattern. However, there are a few style guide violations and one minor readability improvement.

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 14)

The style guide says: "Avoid unnecessary destructuring. Use dot notation to preserve context."

`useTheme()` returns an object with `theme`, `selected`, `syntax`, etc. Destructuring `{ theme }` here loses that context. Since only `theme` is used, dot notation via a single variable is cleaner.

**Before:**

```tsx
const dialog = useDialog()
const { theme } = useTheme()
```

**After:**

```tsx
const dialog = useDialog()
const ctx = useTheme()
```

Then replace all `theme.` references with `ctx.theme.` (lines 25, 28, 33, 39, 45).

However -- looking at the broader codebase, `const { theme } = useTheme()` is used pervasively (including in `dialog.tsx` line 16). This is a codebase-wide pattern, not a local issue. Changing it here alone would create inconsistency. If the style guide is to be enforced, it should be done as a sweeping change. **Pragmatically, this is low priority.**

### 2. Unused import: `DialogContext` type (line 3)

`DialogContext` is imported on line 3 but is only used in the `show` static method parameter on line 52. This is fine -- it _is_ used. No issue here on second look.

### 3. Duplicated confirm-and-close logic (lines 17-20, 40-43)

The keyboard handler and the button's `onMouseUp` both do the same thing:

```tsx
// line 17-20
props.onConfirm?.()
dialog.clear()

// line 40-43
props.onConfirm?.()
dialog.clear()
```

This is a small duplication. Extracting it into a local function would reduce the chance of them diverging:

**Before:**

```tsx
useKeyboard((evt) => {
  if (evt.name === "return") {
    props.onConfirm?.()
    dialog.clear()
  }
})

// ... later in JSX:
onMouseUp={() => {
  props.onConfirm?.()
  dialog.clear()
}}
```

**After:**

```tsx
function confirm() {
  props.onConfirm?.()
  dialog.clear()
}

useKeyboard((evt) => {
  if (evt.name === "return") confirm()
})

// ... later in JSX:
onMouseUp = { confirm }
```

**Why:** Eliminates duplication. If the confirm behavior ever changes (e.g., adding analytics or animation), you only update one place. Also makes the JSX more concise.

That said, the style guide says "Keep things in one function unless composable or reusable" -- and this _is_ reused (twice), so extraction is justified.

### 4. No other issues

The file is clean. Naming is fine (`dialog`, `props`). No `let` where `const` would work. No `else` statements. No `try/catch`. No `any` type. No unnecessary type annotations (the exported `DialogAlertProps` type is necessary for the public API). No for loops. The component is short and readable.

## Final Assessment

One actionable improvement: extract the duplicated confirm+clear logic into a local `confirm` function. Everything else is consistent with codebase conventions.
