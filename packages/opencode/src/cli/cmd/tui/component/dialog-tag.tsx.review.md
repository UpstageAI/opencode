# Review: `dialog-tag.tsx`

## Summary

This is a small 44-line file so the issues are minor, but there are a few style guide violations and unnecessary patterns worth cleaning up: an unused store setter, an intermediate variable that should be inlined, unnecessary destructuring via `createStore` when a simple signal would suffice, and an unused import.

---

## Issues

### 1. Unused store setter from `createStore` (line 11)

`createStore` returns `[store, setStore]`, but only `store` is used. Since `filter` is never written to (no `setStore` call anywhere), the entire store is dead code -- the `filter` property is always `""` and `store.filter` never changes.

This means the `createResource` dependency on `store.filter` is pointless -- the resource only ever fetches once with an empty query, and the `query` parameter is always `""`.

If the intent was to wire this store to `DialogSelect`'s `onFilter` callback (which the component supports), that wiring is missing. As written, the store serves no purpose and should be removed.

**Before (lines 11-13):**

```tsx
const [store] = createStore({
  filter: "",
})
```

**After:**

```tsx
// Remove entirely. If filtering is needed, wire DialogSelect's onFilter
// to a signal/store and use it as the resource dependency.
```

And update the resource to remove the dead dependency:

**Before (lines 15-25):**

```tsx
const [files] = createResource(
  () => [store.filter],
  async () => {
    const result = await sdk.client.find.files({
      query: store.filter,
    })
    if (result.error) return []
    const sliced = (result.data ?? []).slice(0, 5)
    return sliced
  },
)
```

**After:**

```tsx
const [files] = createResource(async () => {
  const result = await sdk.client.find.files({ query: "" })
  if (result.error) return []
  return (result.data ?? []).slice(0, 5)
})
```

This removes the fake reactivity and makes it clear this is a one-shot fetch. If reactive filtering is intended, it needs to actually be wired up -- but that's a feature gap, not a style fix.

**Why:** Dead code obscures intent. A reader has to trace through the store to realize it never changes. Removing it makes the actual behavior obvious.

---

### 2. Unnecessary intermediate variable `sliced` (line 23)

The variable `sliced` is assigned and immediately returned on the next line. Per the style guide: "Reduce total variable count by inlining when a value is only used once."

**Before (lines 22-23):**

```tsx
const sliced = (result.data ?? []).slice(0, 5)
return sliced
```

**After:**

```tsx
return (result.data ?? []).slice(0, 5)
```

**Why:** The variable name adds no clarity beyond what the expression already communicates. Inlining removes a line and reduces cognitive overhead.

---

### 3. Unused import: `createStore` (line 5)

If the store is removed per issue #1, `createStore` from `"solid-js/store"` becomes unused and should be removed.

**Before (line 5):**

```tsx
import { createStore } from "solid-js/store"
```

**After:**
Remove the line entirely.

**Why:** Unused imports are noise.

---

### 4. `createMemo` import may be unnecessary (line 1)

The `createMemo` on line 27 wraps a simple `.map()` over `files()`. In Solid, `files()` is already reactive (it's a resource signal). The memo only prevents re-running the `.map()` when unrelated state changes cause re-evaluation, but in this component there's essentially no other state that could trigger that. Given the tiny data size (max 5 items), the memo provides negligible value and adds complexity.

That said, memos are idiomatic in Solid for derived data, so this is a soft suggestion -- keeping it is defensible.

---

## Suggested final version

```tsx
import { createResource } from "solid-js"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"

export function DialogTag(props: { onSelect?: (value: string) => void }) {
  const sdk = useSDK()
  const dialog = useDialog()

  const [files] = createResource(async () => {
    const result = await sdk.client.find.files({ query: "" })
    if (result.error) return []
    return (result.data ?? []).slice(0, 5)
  })

  return (
    <DialogSelect
      title="Autocomplete"
      options={(files() ?? []).map((file) => ({
        value: file,
        title: file,
      }))}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
```

This version:

- Removes the dead `createStore` and its import
- Inlines the `sliced` variable
- Inlines the `options` memo into the JSX (since the mapping is trivial and only used once)
- Removes the unused `createMemo` import
- Goes from 44 lines to 27 lines with no behavioral change
