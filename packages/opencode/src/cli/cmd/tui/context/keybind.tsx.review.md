# Review: `keybind.tsx`

## Summary

The file is compact (~100 lines) and the overall structure is reasonable. However, there are several style guide violations and readability issues: unnecessary `let` where `const` is possible, a redundant guard condition, unnecessary destructuring and type annotations, variable shadowing, a missing return type, and some inlining opportunities. None are severe bugs, but cleaning them up would make the file tighter and more consistent with the codebase style guide.

---

## Issues

### 1. Unnecessary `let` for `focus` (line 26)

`focus` is used as mutable state, which is legitimate here since it's reassigned in the `leader` function and read in the timeout callback. However, it's declared with `let` and no initializer, which could be `let focus: Renderable | null = null` for clarity. This one is acceptable as-is since the mutation is inherent to the pattern.

No change needed -- noting for completeness.

---

### 2. Redundant guard `if (!active)` on line 43

The `leader` function returns early on line 40 when `active` is true. So by the time we reach line 43, `active` is _always_ false. The `if (!active)` check is dead logic that adds nesting for no reason.

**Lines 42-49:**

```tsx
// Before
if (!active) {
  if (focus && !renderer.currentFocusedRenderable) {
    focus.focus()
  }
  setStore("leader", false)
}
```

```tsx
// After
if (focus && !renderer.currentFocusedRenderable) {
  focus.focus()
}
setStore("leader", false)
```

**Why:** The early return on line 40 already guarantees `active` is false here. The redundant check obscures this and adds unnecessary indentation.

---

### 3. Unnecessary type annotation on `parsed` (line 84)

The style guide says to rely on type inference. `result.parse(evt)` already returns `Keybind.Info`, so annotating the variable is redundant.

**Line 84:**

```tsx
// Before
const parsed: Keybind.Info = result.parse(evt)
```

```tsx
// After
const parsed = result.parse(evt)
```

**Why:** The return type of `result.parse` is already `Keybind.Info`. The annotation adds noise without adding safety.

---

### 4. `for` loop in `match` should be `Array.some` (lines 85-89)

The style guide prefers functional array methods over `for` loops. This is a textbook case for `.some()`.

**Lines 82-90:**

```tsx
// Before
      match(key: keyof KeybindsConfig, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed: Keybind.Info = result.parse(evt)
        for (const key of keybind) {
          if (Keybind.match(key, parsed)) {
            return true
          }
        }
      },
```

```tsx
// After
      match(key: keyof KeybindsConfig, evt: ParsedKey) {
        const keybind = keybinds()[key]
        if (!keybind) return false
        const parsed = result.parse(evt)
        return keybind.some((k) => Keybind.match(k, parsed))
      },
```

**Why:** More concise, idiomatic, and avoids the variable shadowing issue (see next point). Also fixes the implicit `undefined` return -- the original function falls through without returning `false` when no keybind matches.

---

### 5. Variable shadowing: `key` parameter shadows `key` loop variable (line 85)

The `match` method parameter is named `key`, and the `for...of` loop variable is also named `key`. This compiles but is confusing.

This is resolved by the `.some()` rewrite above (using `k` as the callback parameter), but worth noting as its own issue.

**Line 81 vs 85:**

```tsx
// The parameter `key` on line 81 is shadowed by the loop variable `key` on line 85
match(key: keyof KeybindsConfig, evt: ParsedKey) {
  ...
  for (const key of keybind) {  // shadows the outer `key`
```

**Why:** Shadowed variables make it unclear which `key` is being referenced and can cause subtle bugs during refactoring.

---

### 6. `result` variable in `print` shadows outer `result` (line 94)

The outer scope defines `const result = { ... }` on line 67. Inside the `print` method, `const result` on line 94 shadows it.

**Lines 91-96:**

```tsx
// Before
      print(key: keyof KeybindsConfig) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        const result = Keybind.toString(first)
        return result.replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
```

```tsx
// After
      print(key: keyof KeybindsConfig) {
        const first = keybinds()[key]?.at(0)
        if (!first) return ""
        return Keybind.toString(first).replace("<leader>", Keybind.toString(keybinds().leader![0]!))
      },
```

**Why:** Eliminates the shadowing _and_ inlines a single-use variable, following the style guide's guidance to reduce variable count when a value is only used once.

---

### 7. `match` has implicit `undefined` return (lines 81-90)

When no keybind matches, the function falls off the end and implicitly returns `undefined`. Callers treat this as a boolean (line 52: `result.match("leader", evt)`), so it works due to truthiness, but it's sloppy -- the function should explicitly return `false`.

This is fixed by the `.some()` rewrite in issue 4, which always returns a boolean.

---

### 8. Unnecessary destructuring of `sync` (line 14)

`sync` is only used once on line 17 as `sync.data.config.keybinds`. It could be inlined, but since `useSync()` is a hook call that must happen at the top level of the init function (SolidJS reactive context), assigning it to a variable is correct here.

No change needed -- noting for completeness that the single-use is acceptable due to hook semantics.

---

### 9. `keybinds` memo has unnecessary `return` with braces (lines 15-20)

The `createMemo` callback wraps a single `pipe()` expression in braces + explicit return. An arrow with implicit return is cleaner.

**Lines 15-20:**

```tsx
// Before
const keybinds = createMemo(() => {
  return pipe(
    sync.data.config.keybinds ?? {},
    mapValues((value) => Keybind.parse(value)),
  )
})
```

```tsx
// After
const keybinds = createMemo(() =>
  pipe(
    sync.data.config.keybinds ?? {},
    mapValues((value) => Keybind.parse(value)),
  ),
)
```

**Why:** Removes a level of braces and the explicit `return` keyword for a single-expression function. More concise without losing clarity.

---

## Summary of Recommended Changes

| #   | Line(s) | Severity | Description                                                           |
| --- | ------- | -------- | --------------------------------------------------------------------- |
| 1   | 42-49   | Medium   | Remove redundant `if (!active)` guard                                 |
| 2   | 84      | Low      | Remove unnecessary `: Keybind.Info` type annotation                   |
| 3   | 85-89   | Medium   | Replace `for` loop with `.some()`, fixing implicit `undefined` return |
| 4   | 85      | Medium   | Fix `key` variable shadowing (resolved by #3)                         |
| 5   | 94-95   | Low      | Inline single-use `result` in `print`, fixing variable shadowing      |
| 6   | 81-90   | Medium   | Explicit `false` return for `match` (resolved by #3)                  |
| 7   | 15-20   | Low      | Use implicit return in memo callback                                  |
