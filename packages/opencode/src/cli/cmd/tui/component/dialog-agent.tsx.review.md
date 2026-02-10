# Review: `dialog-agent.tsx`

## Summary

This is a small, clean file (32 lines). It follows most style conventions and is easy to read. There are only two minor issues worth addressing.

## Issues

### 1. Unnecessary block body in `.map()` callback (line 11-17)

The `.map()` uses a block body with an explicit `return` when a concise arrow body would suffice. Every sibling dialog file (e.g. `dialog-skill.tsx:23`) uses the concise form for the same pattern.

**Before:**

```tsx
const options = createMemo(() =>
  local.agent.list().map((item) => {
    return {
      value: item.name,
      title: item.name,
      description: item.native ? "native" : item.description,
    }
  }),
)
```

**After:**

```tsx
const options = createMemo(() =>
  local.agent.list().map((item) => ({
    value: item.name,
    title: item.name,
    description: item.native ? "native" : item.description,
  })),
)
```

**Why:** Removes the unnecessary `return` keyword and braces. The implicit-return form is the established pattern in the codebase (see `dialog-skill.tsx`, `dialog-model.tsx`) and is slightly easier to scan because there's less syntactic noise.

### 2. Verbose `onSelect` handler could be inlined further (lines 25-28)

Minor, but the `onSelect` handler destructures nothing and could be slightly tighter by putting both calls on separate lines without the extra blank-line feel. This is a style-only nit -- the current form is perfectly acceptable.

No change recommended here. Both calls depend on `option` so no simplification is possible, and the current formatting is consistent with the rest of the codebase.

## No issues found

The following were checked and found to be clean:

- **No unnecessary destructuring** -- `local.agent.list()`, `local.agent.current().name`, `local.agent.set()`, `dialog.clear()` all use dot notation correctly.
- **No unnecessary type annotations** -- types are fully inferred; the explicit `DialogSelectOption` annotation that `dialog-skill.tsx:20` uses is absent here, which is correct per the style guide.
- **No `let` where `const` would work** -- no `let` usage at all.
- **No `else` statements** -- none present.
- **No `try`/`catch`** -- none present.
- **No `any` type** -- none present.
- **No unnecessary variables** -- `local` and `dialog` are each used more than once (or exactly once but needed for context hook semantics). `options` is a reactive memo, necessarily a variable.
- **Naming** -- `local`, `dialog`, `options`, `item` are all single-word, clear names. Good.
- **Single responsibility** -- the component does one thing: renders a `DialogSelect` with agent options. No extractable sub-functions needed.
