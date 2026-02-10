# Review: `border.tsx`

## Summary

This is a small, 22-line file that defines two shared border configuration objects for TUI components. The code is clean and functional. There is one minor style improvement available, but overall this file is well-written and appropriately scoped.

## Issues

### 1. Repetitive `as const` on individual array elements (line 16)

The `as const` assertion is applied to each string element individually. This is necessary to narrow the array type from `string[]` to `("left" | "right")[]`, which the `border` prop requires. However, applying `as const` to each element separately is noisier than applying it once to the whole array.

**Line 16:**

```tsx
// Before
border: ["left" as const, "right" as const],

// After
border: ["left", "right"] as const,
```

**Why:** Same type narrowing effect with less repetition. `["left", "right"] as const` produces a `readonly ["left", "right"]` tuple, which is assignable to the `border` prop. One assertion instead of two.

---

That's it. The file is concise, exports are well-named, `EmptyBorder` and `SplitBorder` are descriptive single-concept names, and the spread of `EmptyBorder` into `SplitBorder.customBorderChars` is a clean way to override a single property. No unnecessary destructuring, no `let`, no `else`, no `any`, no over-abstraction. This file is in good shape.
