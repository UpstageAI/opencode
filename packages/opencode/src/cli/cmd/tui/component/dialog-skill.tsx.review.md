# Review: `dialog-skill.tsx`

## Summary

This is a small, clean component at 37 lines. It's well-structured overall, but there are a few style guide violations and minor readability improvements available.

---

## Issues

### 1. Unnecessary exported type annotation — prefer inference (line 6-8)

`DialogSkillProps` is only used in one place (the `props` parameter of `DialogSkill`). Exporting it as a named type adds a symbol that could just be inlined. However, if consumers need this type externally, it's justified. Given that this is a dialog component typically rendered internally via `dialog.replace()`, the export is likely unnecessary.

**Before:**

```tsx
export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
```

**After:**

```tsx
export function DialogSkill(props: { onSelect: (skill: string) => void }) {
```

**Why:** Reduces exported surface area and avoids a one-use named type. One fewer symbol to track. If it is needed externally, keep it — but verify that first.

---

### 2. Unnecessary explicit type annotation on `createMemo` (line 20)

The generic `<DialogSelectOption<string>[]>` on `createMemo` is redundant. TypeScript can infer the return type from the array of objects being returned, and `DialogSelect` already accepts `DialogSelectOption<T>[]` so the types flow naturally.

**Before:**

```tsx
const options = createMemo<DialogSelectOption<string>[]>(() => {
```

**After:**

```tsx
const options = createMemo(() => {
```

**Why:** The style guide says "rely on type inference when possible; avoid explicit type annotations unless necessary for exports or clarity." The return type is already clear from the mapped object shape.

---

### 3. Unnecessary intermediate variable `list` — inline it (line 21)

`list` is used twice (lines 22 and 23), so it warrants a variable. However, `maxWidth` is computed from `list` and only used once on line 24. The real issue is that `list` could be a more descriptive name, but per the style guide, single-word names are preferred and `list` is fine.

No change needed here — `list` is used twice so it's justified.

---

### 4. Unnecessary destructuring in import (line 2)

This is fine as-is. `createResource` and `createMemo` are standalone functions from solid-js, not methods on an object. Import destructuring for module imports is standard and not the same as the "avoid destructuring objects" rule which refers to runtime `const { a, b } = obj` patterns.

No change needed.

---

### 5. `result.data ?? []` could mask errors (line 17)

If the API call fails, `result.data` will be undefined and this silently returns an empty array. There's no error handling or user feedback. The `sdk.client.app.skills()` call could fail (network error, server down), and the user would just see an empty skills list with no indication of why.

**Before:**

```tsx
const [skills] = createResource(async () => {
  const result = await sdk.client.app.skills()
  return result.data ?? []
})
```

**After:**

```tsx
const [skills] = createResource(async () => {
  const result = await sdk.client.app.skills()
  return result.data ?? []
})
```

This is a minor concern, not a style issue. `createResource` does capture errors via `skills.error`, but it's not used here. Noting it for awareness — not necessarily a change to make.

---

### 6. Inline `result` — it's only used once (line 16-17)

The variable `result` is assigned and immediately accessed on the next line. It can be inlined.

**Before:**

```tsx
const [skills] = createResource(async () => {
  const result = await sdk.client.app.skills()
  return result.data ?? []
})
```

**After:**

```tsx
const [skills] = createResource(async () => {
  return (await sdk.client.app.skills()).data ?? []
})
```

**Why:** The style guide says "reduce total variable count by inlining when a value is only used once." `result` is only used to access `.data`.

---

### 7. `maxWidth` is only used once — could inline (line 22)

`maxWidth` is used only on line 24 inside `padEnd()`. It could be inlined, but this is borderline — the `Math.max(0, ...list.map(...))` expression is already complex, and inlining it into `padEnd()` would hurt readability. Keeping it as-is is reasonable.

No change needed — readability wins over strict inlining here.

---

## Final Assessment

The file is compact and well-organized. The main actionable improvements are:

1. **Remove the explicit generic on `createMemo` (line 20)** — let inference work
2. **Inline `result` variable (lines 16-17)** — used only once
3. **Consider inlining `DialogSkillProps`** — if not imported elsewhere

These are minor polish items. The component is straightforward and easy to understand.
