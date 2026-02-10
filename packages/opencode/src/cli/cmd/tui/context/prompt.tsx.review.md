# Review: `packages/opencode/src/cli/cmd/tui/context/prompt.tsx`

## Summary

This is a small 19-line file that creates a SolidJS context for holding a mutable reference to a `PromptRef`. The code is clean and follows existing patterns in the codebase (matches `exit.tsx`, `kv.tsx`, etc.). There are only minor style nits.

## Issues

### 1. Unnecessary type annotation on `set` parameter (line 13)

The `PromptRef | undefined` annotation on the `set` method parameter is redundant — the type of `current` already constrains what can be assigned. However, since `current` is a local `let` variable and not a typed field, the annotation here does serve as documentation for consumers of this context. This is borderline; the annotation is not harmful but could be dropped if you want maximal inference.

```tsx
// before (line 13)
set(ref: PromptRef | undefined) {
  current = ref
},

// after — relies on inference from usage, but loses the import of PromptRef
// which makes the parameter type opaque to callers. Keep as-is.
```

**Verdict**: No change recommended. The annotation is justified here because it's part of a public API surface and the type can't be inferred from context alone.

### 2. `let` on line 7 — is `const` with a different pattern possible?

The style guide prefers `const` over `let`. However, this is a mutable ref holder — `let current` is the entire point of this context. There's no ternary or early-return that could replace it. A `const` wrapper (e.g., `const ref = { current: undefined as PromptRef | undefined }`) would be an alternative but is arguably worse:

```tsx
// alternative with const — not an improvement
const ref = { current: undefined as PromptRef | undefined }
return {
  get current() {
    return ref.current
  },
  set(r: PromptRef | undefined) {
    ref.current = r
  },
}
```

**Verdict**: No change recommended. `let` is the right tool here for a simple mutable binding.

### 3. Destructuring in the export (line 4)

The export destructures `createSimpleContext()`'s return value to rename `use` → `usePromptRef` and `provider` → `PromptRefProvider`. The style guide says "avoid unnecessary destructuring, use dot notation." However, this is an export-site rename, not a consumption-site destructure — dot notation isn't applicable since you can't rename exports via dot access. Every other context file in this directory (`exit.tsx`, `kv.tsx`, `route.tsx`, etc.) uses the exact same pattern.

```tsx
// current (line 4) — consistent with every other context file
export const { use: usePromptRef, provider: PromptRefProvider } = createSimpleContext({
```

**Verdict**: No change recommended. This is the established codebase pattern and the destructuring is necessary for the rename.

## Overall Assessment

This file is clean. It's 19 lines, follows the codebase conventions, matches the pattern of every sibling context file, and has no real issues. The `let` is justified, the type annotation is reasonable for an API boundary, and the export destructure is the standard pattern. No changes recommended.
