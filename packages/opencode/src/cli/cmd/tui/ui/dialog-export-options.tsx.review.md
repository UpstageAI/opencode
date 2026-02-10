# Review: `dialog-export-options.tsx`

## Summary

The file works but has significant repetition and inconsistency with the project style guide. The main problems: (1) the checkbox UI is copy-pasted four times with no abstraction, (2) the confirm payload is assembled identically in two places, (3) unnecessary destructuring and unused imports, and (4) the `onConfirm` callback in `show()` wraps `resolve` for no reason.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 26)

The style guide says to avoid unnecessary destructuring and use dot notation. Every other reference is `theme.something`, so `theme` is fine, but the `{ theme }` destructure is consistent with the rest of the codebase (`dialog-confirm.tsx`, `dialog-prompt.tsx` all do this). **No change needed here** -- it's an established codebase pattern.

### 2. Duplicated confirm payload (lines 37-44, 92-99)

The exact same object is assembled in two places: the `useKeyboard` handler and the `onSubmit` handler. This is a maintenance hazard -- if a new option is added, both must be updated.

**Before (lines 36-45 and 91-100):**

```tsx
// in useKeyboard
if (evt.name === "return") {
  props.onConfirm?.({
    filename: textarea.plainText,
    thinking: store.thinking,
    toolDetails: store.toolDetails,
    assistantMetadata: store.assistantMetadata,
    openWithoutSaving: store.openWithoutSaving,
  })
}

// in onSubmit
onSubmit={() => {
  props.onConfirm?.({
    filename: textarea.plainText,
    thinking: store.thinking,
    toolDetails: store.toolDetails,
    assistantMetadata: store.assistantMetadata,
    openWithoutSaving: store.openWithoutSaving,
  })
}}
```

**After:**

```tsx
function confirm() {
  props.onConfirm?.({
    filename: textarea.plainText,
    thinking: store.thinking,
    toolDetails: store.toolDetails,
    assistantMetadata: store.assistantMetadata,
    openWithoutSaving: store.openWithoutSaving,
  })
}

// in useKeyboard
if (evt.name === "return") confirm()

// in JSX
onSubmit = { confirm }
```

**Why:** Eliminates duplication. One place to update when options change.

### 3. Redundant type annotation on `order` array (lines 47-53)

The `order` array has a verbose inline type annotation that just repeats the union literal already used by `store.active`. The `as const` assertion would give the same type safety more concisely.

**Before:**

```tsx
const order: Array<"filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"> = [
  "filename",
  "thinking",
  "toolDetails",
  "assistantMetadata",
  "openWithoutSaving",
]
```

**After:**

```tsx
const order = ["filename", "thinking", "toolDetails", "assistantMetadata", "openWithoutSaving"] as const
```

**Why:** The type is already fully expressed by the literal values. The annotation is redundant noise. `as const` preserves the narrow types for `indexOf` and indexing.

### 4. Checkbox toggle logic is repetitive (lines 59-64)

Four nearly identical `if` statements that each check `store.active` and toggle the matching field.

**Before:**

```tsx
if (evt.name === "space") {
  if (store.active === "thinking") setStore("thinking", !store.thinking)
  if (store.active === "toolDetails") setStore("toolDetails", !store.toolDetails)
  if (store.active === "assistantMetadata") setStore("assistantMetadata", !store.assistantMetadata)
  if (store.active === "openWithoutSaving") setStore("openWithoutSaving", !store.openWithoutSaving)
  evt.preventDefault()
}
```

**After:**

```tsx
if (evt.name === "space") {
  const field = store.active
  if (field !== "filename") setStore(field, !store[field])
  evt.preventDefault()
}
```

**Why:** Eliminates four branches that do the same thing. Adding a new checkbox option won't require touching this block.

### 5. Massively repeated checkbox JSX (lines 111-159)

Four checkbox `<box>` blocks are copy-pasted with only the field name and label text changing. This is the biggest readability issue in the file.

**Before (lines 111-159):** ~48 lines of near-identical JSX repeated 4 times.

**After:**

```tsx
{
  ;(["thinking", "toolDetails", "assistantMetadata", "openWithoutSaving"] as const).map((field) => (
    <box
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      backgroundColor={store.active === field ? theme.backgroundElement : undefined}
      onMouseUp={() => setStore("active", field)}
    >
      <text fg={store.active === field ? theme.primary : theme.textMuted}>{store[field] ? "[x]" : "[ ]"}</text>
      <text fg={store.active === field ? theme.primary : theme.text}>{labels[field]}</text>
    </box>
  ))
}
```

With a simple mapping at the top of the component:

```tsx
const labels = {
  thinking: "Include thinking",
  toolDetails: "Include tool details",
  assistantMetadata: "Include assistant metadata",
  openWithoutSaving: "Open without saving",
} as const
```

**Why:** 48 lines become ~15. Every checkbox is guaranteed to have consistent structure. Adding a new option means adding one entry to `labels` and one field to the store -- not copy-pasting another 12-line block.

### 6. Unnecessary callback wrapper in `show()` (line 200)

**Before:**

```tsx
onConfirm={(options) => resolve(options)}
```

**After:**

```tsx
onConfirm = { resolve }
```

**Why:** The wrapper lambda does nothing -- it just passes its argument through. Direct reference is cleaner and is what `dialog-confirm.tsx` does (line 78: `onConfirm={() => resolve(true)}`; that one is different because it transforms the value).

### 7. Unused import: `Show` from solid-js is used, but `JSX` is not (line 5)

**Before:**

```tsx
import { onMount, Show, type JSX } from "solid-js"
```

**After:**

```tsx
import { onMount, Show } from "solid-js"
```

**Why:** `JSX` is imported but never referenced in this file. Dead imports add noise.

### 8. Unused import: `createStore` from solid-js/store (line 4) -- actually used; ignore.

Actually `createStore` is used on line 28. Disregard.

### 9. `show()` takes too many positional boolean arguments (lines 177-183)

Six positional parameters where four are booleans is error-prone at call sites. It's easy to swap two booleans and get a silent bug.

**Before:**

```tsx
DialogExportOptions.show = (
  dialog: DialogContext,
  defaultFilename: string,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
  defaultOpenWithoutSaving: boolean,
) => {
```

**After:**

```tsx
DialogExportOptions.show = (
  dialog: DialogContext,
  defaults: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  },
) => {
```

And inside:

```tsx
<DialogExportOptions
  defaultFilename={defaults.filename}
  defaultThinking={defaults.thinking}
  ...
```

**Why:** An options object prevents boolean-swap bugs at call sites and is self-documenting. Compare:

```tsx
// Before -- which boolean is which?
DialogExportOptions.show(dialog, "file.md", true, false, true, false)

// After -- obvious
DialogExportOptions.show(dialog, {
  filename: "file.md",
  thinking: true,
  toolDetails: false,
  assistantMetadata: true,
  openWithoutSaving: false,
})
```

This is a larger API change so it depends on how many call sites exist, but it's worth flagging.

---

## Summary of Changes by Impact

| Priority | Issue                                 | Lines Saved | Risk                |
| -------- | ------------------------------------- | ----------- | ------------------- |
| High     | Extract checkbox into loop (#5)       | ~33         | Low                 |
| High     | Deduplicate confirm payload (#2)      | ~8          | Low                 |
| Medium   | Simplify toggle logic (#4)            | ~3          | Low                 |
| Medium   | Remove redundant type annotation (#3) | ~4          | Low                 |
| Low      | Remove unused `JSX` import (#7)       | 0           | None                |
| Low      | Inline `resolve` wrapper (#6)         | 0           | None                |
| Low      | Options object for `show()` (#9)      | 0           | Medium (API change) |
