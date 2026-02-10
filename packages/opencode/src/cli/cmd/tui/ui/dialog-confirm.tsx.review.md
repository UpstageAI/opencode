# Review: dialog-confirm.tsx

## Summary

This is a small, well-structured component. The code is clean and readable overall. There are only a few minor issues worth addressing — an unused import, an unnecessary callback parameter, and one `export` that could arguably be dropped.

---

## Issues

### 1. Unused import: `For` from `solid-js` could be dropped in favor of a simpler pattern (line 5)

`For` is a SolidJS control flow component for rendering dynamic lists. Here the array `["cancel", "confirm"]` is a static literal — it never changes. Using `For` adds indirection for something that could just be two inline `<box>` elements, removing the runtime overhead of a reactive list and the need for the `For` import entirely.

However, this is a **minor tradeoff**: the `For` approach avoids duplicating the `<box>` + `<text>` markup. Both are reasonable. If the team prefers DRY over simplicity here, the current code is fine. But the duplication is only ~8 lines, and inlining makes each button's intent immediately visible without mentally mapping `key === "confirm"` / `key === "cancel"` branches.

**Before (lines 48-65):**

```tsx
<For each={["cancel", "confirm"]}>
  {(key) => (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={key === store.active ? theme.primary : undefined}
      onMouseUp={(evt) => {
        if (key === "confirm") props.onConfirm?.()
        if (key === "cancel") props.onCancel?.()
        dialog.clear()
      }}
    >
      <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>{Locale.titlecase(key)}</text>
    </box>
  )}
</For>
```

**After:**

```tsx
{
  ;(["cancel", "confirm"] as const).map((key) => (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={key === store.active ? theme.primary : undefined}
      onMouseUp={() => {
        if (key === "confirm") props.onConfirm?.()
        if (key === "cancel") props.onCancel?.()
        dialog.clear()
      }}
    >
      <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>{Locale.titlecase(key)}</text>
    </box>
  ))
}
```

**Why:** For a static array, `.map()` is simpler and removes the `For` import. The `For` component exists for reactive lists where items can be added/removed — overkill for a fixed 2-element array. This also aligns with the style guide's preference for functional array methods (`map`, `filter`, `flatMap`) over alternatives.

---

### 2. Unused `evt` parameter in `onMouseUp` callback (line 54)

The `onMouseUp` handler inside the `For` loop declares `(evt) => { ... }` but never uses `evt`.

**Before (line 54):**

```tsx
onMouseUp={(evt) => {
```

**After:**

```tsx
onMouseUp={() => {
```

**Why:** Unused parameters are noise. Removing `evt` signals to the reader that the event object isn't needed, which makes the callback's intent clearer at a glance.

---

### 3. `DialogConfirmProps` type export may be unnecessary (line 9)

`DialogConfirmProps` is exported but likely only consumed internally by this file. If no external consumer imports it, the `export` keyword adds false surface area to the module's public API.

**Before (line 9):**

```tsx
export type DialogConfirmProps = {
```

**After (if no external consumers):**

```tsx
type DialogConfirmProps = {
```

**Why:** Keeping exports minimal makes it easier to understand what a module's public contract is. If this type is imported elsewhere, keep the export.

---

## Non-issues (things that look like issues but aren't)

### `const { theme } = useTheme()` (line 18)

This destructuring violates the style guide's "avoid unnecessary destructuring" rule in isolation. However, every single dialog file in the `ui/` directory uses this exact pattern (`dialog-alert.tsx`, `dialog-select.tsx`, `dialog-prompt.tsx`, `dialog-help.tsx`, `dialog.tsx`, `toast.tsx`). This is clearly an established codebase convention for `useTheme()`. Changing it only in this file would create inconsistency, which is worse than the destructuring itself. If this pattern should change, it should change everywhere at once.

### `createStore` with inline type cast (line 20)

```tsx
const [store, setStore] = createStore({
  active: "confirm" as "confirm" | "cancel",
})
```

The `as` cast is necessary here because TypeScript would infer the type as `string` without it, and the store needs the narrower union type for the equality checks on lines 25-26 and 31 to be type-safe. This is fine.

### The `show` static method pattern (lines 71-85)

Attaching `show` as a static method on `DialogConfirm` is an established pattern in this codebase (same pattern exists on `DialogAlert.show`). It cleanly encapsulates the Promise-based dialog flow. No issue here.

---

## Final Assessment

This file is in good shape. The only concrete fix is removing the unused `evt` parameter (issue #2). Issues #1 and #3 are judgment calls that depend on team preference. The file is concise, follows codebase conventions, and is easy to understand.
