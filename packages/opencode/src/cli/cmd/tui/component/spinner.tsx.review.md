# Review: `spinner.tsx`

## Summary

This is a small, clean component — only 25 lines. There isn't much wrong with it, but there are a couple of minor issues worth addressing around unnecessary imports, destructuring convention, and a slightly redundant type annotation.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 11)

**Line 11:**

```tsx
const { theme } = useTheme()
```

Per the style guide: "Avoid unnecessary destructuring. Use dot notation to preserve context."

However, `const { theme } = useTheme()` is the **dominant pattern** across the entire codebase (43 of 44 call sites do this exact destructuring). The one exception (`tips.tsx`) uses `const theme = useTheme().theme`. In this case, `useTheme()` returns an object with many properties (`theme`, `selected`, `all`, `syntax`, `mode`, `set`, etc.) and components only need `theme`. Destructuring is the established convention here, so changing it would create inconsistency with the rest of the codebase.

**Verdict:** No change — codebase convention overrides the general guideline.

---

### 2. `JSX.Element` import can be replaced with `ParentProps` from solid-js (lines 4, 10)

`children?: JSX.Element` requires a dedicated type import from `@opentui/solid`. Solid provides `ParentProps` for exactly this pattern, but looking at the codebase, `ParentProps` wraps an existing props type and always includes `children` (not optional). Since `children` is optional here, the current approach is correct.

However, `JSX.Element` could be imported from `solid-js/jsx-runtime` or simply `solid-js` instead of `@opentui/solid` for consistency with how the rest of the codebase imports Solid types. The only other file that imports `JSX` from `@opentui/solid` is `link.tsx` — and it imports from `solid-js` instead.

**Before (line 4):**

```tsx
import type { JSX } from "@opentui/solid"
```

**After:**

```tsx
import type { JSX } from "solid-js"
```

**Why:** Consistency with the rest of the codebase. `link.tsx` imports `JSX` from `solid-js`. Importing from the framework directly is more conventional and doesn't depend on the UI library re-exporting it.

---

### 3. `RGBA` type import is unnecessary — can rely on inference (lines 5, 10)

The `RGBA` type is imported solely to annotate the `color` prop. But the consumers of `Spinner` already know what type they're passing (they get it from `theme.textMuted` or similar), and the `<spinner>` and `<text>` elements that consume `color()` will enforce their own types. The explicit `RGBA` annotation doesn't add safety here — it just adds an import.

**Before (lines 4–5, 10):**

```tsx
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
```

**After:**

```tsx
import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
```

**Verdict:** Keep `RGBA`. This is an exported component, so explicit prop types are appropriate for API clarity. The style guide says "Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for **exports** or clarity." Since `Spinner` is exported, the annotation is justified.

---

### 4. Minor: `color` helper could be inlined (line 13)

**Line 13:**

```tsx
const color = () => props.color ?? theme.textMuted
```

This reactive accessor is used three times (lines 15, 17, 19), so extracting it is the right call. No change needed.

---

## Final Assessment

This file is already well-written. The only actionable change is the `JSX` import source (issue #2). Everything else either follows codebase convention or is appropriately structured for a small exported component.

### Single recommended change

```diff
-import type { JSX } from "@opentui/solid"
+import type { JSX } from "solid-js"
```
