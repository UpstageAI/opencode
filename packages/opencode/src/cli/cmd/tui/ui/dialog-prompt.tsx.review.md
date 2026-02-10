# Code Review: `dialog-prompt.tsx`

## Overall Quality

This is a small, focused component — 81 lines total. It's reasonably clean already, but there are several style guide violations and minor readability issues worth addressing.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 18)

The style guide says: _"Avoid unnecessary destructuring. Use dot notation to preserve context."_

`theme` is extracted from `useTheme()` but `theme` alone loses the context that it came from the theme system. Using dot notation is more consistent with the rest of the codebase pattern (though notably `dialog.tsx` also destructures — both should be fixed).

**Before:**

```tsx
const { theme } = useTheme()
```

**After:**

```tsx
const theme = useTheme()
```

Then all references to `theme.text` become `theme.theme.text`, etc.

However — looking at the broader codebase, `dialog.tsx` also uses `const { theme } = useTheme()` (line 16). This is a pervasive pattern across the TUI code. The destructuring here is arguably justified because `useTheme()` returns an object with multiple fields (`theme`, `selected`, `syntax`, etc.) and `theme` is the only one used. Accessing `theme.theme.text` everywhere would actually hurt readability. **This one is debatable** — the destructuring removes a level of nesting that would otherwise be redundant noise in JSX. I'd leave it as-is given how the `useTheme` API is designed, but flag it for awareness.

---

### 2. `let` used where it could be avoided (line 19)

```tsx
let textarea: TextareaRenderable
```

This is assigned via a `ref` callback on line 54. In SolidJS, `ref` callbacks require `let` — the framework assigns the value after render. This is an accepted SolidJS pattern and **cannot be replaced with `const`**. No change needed, but the missing `!` (definite assignment) or initialization is worth noting for clarity — the variable is used in `onMount` and `useKeyboard` before it's guaranteed to be assigned. The `onMount` callback on line 30 does guard against this with `if (!textarea || textarea.isDestroyed)`, but the `useKeyboard` handler on line 23 does not — it accesses `textarea.plainText` without checking if `textarea` is defined.

**Before:**

```tsx
useKeyboard((evt) => {
  if (evt.name === "return") {
    props.onConfirm?.(textarea.plainText)
  }
})
```

**After:**

```tsx
useKeyboard((evt) => {
  if (evt.name === "return") {
    if (!textarea) return
    props.onConfirm?.(textarea.plainText)
  }
})
```

**Why:** Defensive consistency. The `onMount` handler already guards against `textarea` being undefined/destroyed, but the keyboard handler doesn't. If the keyboard event fires before the ref is assigned (unlikely but possible during rapid mount/unmount cycles), this would throw.

---

### 3. Duplicate `onConfirm` logic (lines 22-25 and 49-51)

The confirm action is wired up in two places: the `useKeyboard` handler (line 22) and the `onSubmit` prop of `<textarea>` (line 49). The `<textarea>` already has `keyBindings={[{ name: "return", action: "submit" }]}` which maps Enter to the `onSubmit` callback. This means the `useKeyboard` handler for "return" is redundant — the textarea's own key binding will handle it.

**Before:**

```tsx
useKeyboard((evt) => {
  if (evt.name === "return") {
    props.onConfirm?.(textarea.plainText)
  }
})

// ... later in JSX:
<textarea
  onSubmit={() => {
    props.onConfirm?.(textarea.plainText)
  }}
  keyBindings={[{ name: "return", action: "submit" }]}
  ...
/>
```

**After:**
Remove the `useKeyboard` handler entirely. The `<textarea>` already handles Enter via its `keyBindings` + `onSubmit`. If both are needed (e.g., to catch Enter when the textarea isn't focused), this should be documented with a comment explaining why.

```tsx
// Remove lines 21-25 entirely, or add a comment:
// Handles enter when textarea is not focused
useKeyboard((evt) => {
  if (evt.name === "return") {
    if (!textarea) return
    props.onConfirm?.(textarea.plainText)
  }
})
```

**Why:** Duplicate logic is a maintenance burden. If the confirm behavior changes, you'd need to update two places. If both are genuinely needed, a comment should explain the distinction.

---

### 4. Unnecessary `onCancel` prop that is never triggered (lines 13, 75)

The `DialogPromptProps` type declares `onCancel` (line 13), and `DialogPrompt.show` passes a cancel handler (line 75), but nothing in the component ever calls `props.onCancel`. Cancellation is handled by the dialog's `onClose` callback passed to `dialog.replace()` on line 77. The `onCancel` prop on the component itself is dead code.

**Before:**

```tsx
export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}
```

**After:**

```tsx
export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
}
```

And on line 75:

```tsx
// Before:
<DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />

// After:
<DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} />
```

**Why:** Dead props add confusion. A reader would expect `onCancel` to be called somewhere in the component, and its absence suggests a bug. The cancel path is already handled by the second argument to `dialog.replace()`.

---

### 5. Verbose `onSubmit` callback (lines 49-51)

The `onSubmit` handler wraps a single expression in braces unnecessarily.

**Before:**

```tsx
onSubmit={() => {
  props.onConfirm?.(textarea.plainText)
}}
```

**After:**

```tsx
onSubmit={() => props.onConfirm?.(textarea.plainText)}
```

**Why:** Reduces visual noise. Single-expression arrow functions are more concise without braces.

---

### 6. `onConfirm` callback in `show` could be simplified (line 75)

**Before:**

```tsx
onConfirm={(value) => resolve(value)}
```

**After:**

```tsx
onConfirm = { resolve }
```

**Why:** `resolve` already accepts a `string | null` and `onConfirm` passes a `string`. The wrapping arrow function is unnecessary indirection. `resolve` can be passed directly since it matches the expected signature.

---

### 7. Missing `dialog.clear()` after confirm (line 23, 50)

When the user confirms, `onConfirm` is called but the dialog is never dismissed. The caller (`DialogPrompt.show`) resolves the promise but doesn't call `dialog.clear()`. This means the dialog remains visible until the consumer explicitly clears it. If this is intentional (the consumer decides when to close), it should be documented. If not, confirm should also close the dialog.

Looking at the pattern: `dialog.replace` sets up an `onClose` that resolves null (line 77), and pressing Escape triggers that via the dialog system. But pressing Enter calls `onConfirm` without closing. This is likely a bug or at minimum inconsistent — the promise resolves but the dialog stays open until the consumer acts.

---

### 8. Unused import: `type DialogContext` partially used (line 3)

`DialogContext` is imported as a type on line 3 and used only in the `show` static method's parameter on line 71. This is fine — just noting it's correctly typed as a type-only import.

---

### 9. The `ref` callback has an unnecessary type annotation (line 54)

**Before:**

```tsx
ref={(val: TextareaRenderable) => (textarea = val)}
```

**After:**

```tsx
ref={(val) => (textarea = val)}
```

**Why:** The style guide says to rely on type inference when possible. SolidJS/OpenTUI should infer the type of the ref callback parameter from the `<textarea>` element. If it doesn't (due to framework typing limitations), the annotation is justified — but it's worth trying without it first.

---

## Summary of Recommended Changes

| Priority | Issue                                                | Lines        |
| -------- | ---------------------------------------------------- | ------------ |
| Medium   | Duplicate confirm logic (useKeyboard + onSubmit)     | 21-25, 49-51 |
| Medium   | Dead `onCancel` prop never called                    | 13, 75       |
| Medium   | Missing null guard on `textarea` in keyboard handler | 23           |
| Low      | Verbose `onSubmit` callback                          | 49-51        |
| Low      | Wrapping arrow in `onConfirm={resolve}`              | 75           |
| Low      | Unnecessary type annotation on ref callback          | 54           |
| Info     | Dialog not cleared on confirm — possible bug         | 23, 50       |
