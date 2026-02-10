# Review: `exit.tsx`

## Summary

This is a small file (~50 lines) that's reasonably well-structured. The main issues are: an unnecessary intermediate variable, an exported type that could be inlined/removed, unnecessary destructuring via the `store` variable, and a slightly verbose exit function body. No major structural problems.

---

## Issues

### 1. Unnecessary `store` variable (lines 17-29)

The `store` object is created, then immediately assigned to `exit.message`. It's only used in one place (the `Object.assign` on line 48) and once internally (line 42). The internal usage (`store.get()`) could just reference `message` directly since it's in the same closure.

**Why:** The style guide says to reduce variable count by inlining values used only once. `store` adds an intermediary name that doesn't clarify anything.

```tsx
// Before (lines 17-49)
const store = {
  set: (value?: string) => {
    const prev = message
    message = value
    return () => {
      message = prev
    }
  },
  clear: () => {
    message = undefined
  },
  get: () => message,
}
const exit: Exit = Object.assign(
  async (reason?: unknown) => {
    renderer.setTerminalTitle("")
    renderer.destroy()
    await input.onExit?.()
    if (reason) {
      const formatted = FormatError(reason) ?? FormatUnknownError(reason)
      if (formatted) {
        process.stderr.write(formatted + "\n")
      }
    }
    const text = store.get()
    if (text) process.stdout.write(text + "\n")
    process.exit(0)
  },
  {
    message: store,
  },
)

// After
const exit: Exit = Object.assign(
  async (reason?: unknown) => {
    renderer.setTerminalTitle("")
    renderer.destroy()
    await input.onExit?.()
    if (reason) {
      const formatted = FormatError(reason) ?? FormatUnknownError(reason)
      if (formatted) {
        process.stderr.write(formatted + "\n")
      }
    }
    if (message) process.stdout.write(message + "\n")
    process.exit(0)
  },
  {
    message: {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    },
  },
)
```

**Why this helps:** Removes a variable that exists solely to be passed through. The `message` closure variable is right there -- calling `store.get()` to retrieve it is indirect. The `message` object shape is now visible at the `Object.assign` call site where it matters.

---

### 2. Unnecessary `text` variable (line 42-43)

`text` is used exactly once, immediately after assignment.

```tsx
// Before (lines 42-43)
const text = store.get()
if (text) process.stdout.write(text + "\n")

// After
if (message) process.stdout.write(message + "\n")
```

**Why this helps:** Style guide says to inline values used only once. Since `message` is already in scope, there's no need for the indirection through `store.get()` and a temp variable.

---

### 3. Exported `Exit` type may be unnecessary (lines 4-10)

The `Exit` type is defined at module scope but never imported by any other file -- it's only used on line 30 to annotate `exit`. Since `createSimpleContext` infers the return type from `init`, and callers get the type through `useExit()`, this annotation is redundant.

```tsx
// Before (lines 4-10, 30)
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}
// ...
const exit: Exit = Object.assign(

// After
const exit = Object.assign(
```

**Why this helps:** The style guide prefers relying on type inference. `Object.assign` produces a well-typed result here. The type annotation duplicates what TypeScript already infers, and removing it means one less thing to keep in sync. If explicit typing is desired for documentation purposes, this is a judgment call -- but it doesn't need to be exported or even named.

---

### 4. Nested `if` could be flattened (lines 36-41)

The nested `if` inside the `reason` block can be simplified. `FormatUnknownError` always returns a string, so `formatted` is always truthy when `FormatError` returns `undefined` -- meaning the inner `if (formatted)` guard is only needed because `FormatError` can return `""` (for `CancelledError`). This is subtle and worth a comment, or could be simplified.

```tsx
// Before (lines 36-41)
if (reason) {
  const formatted = FormatError(reason) ?? FormatUnknownError(reason)
  if (formatted) {
    process.stderr.write(formatted + "\n")
  }
}

// After
if (reason) {
  const formatted = FormatError(reason) ?? FormatUnknownError(reason)
  if (formatted) process.stderr.write(formatted + "\n")
}
```

**Why this helps:** Minor -- collapses the inner block to a single-line conditional, matching the style used on line 43 (`if (text) process.stdout.write(...)`). The file is inconsistent: line 43 uses single-line `if`, but lines 38-40 use a block for the same pattern.

---

### 5. `input` parameter name shadows conceptual meaning (line 14)

The `init` callback receives `input` which represents component props (specifically `{ onExit?: () => Promise<void> }`). In a SolidJS context, `props` is the conventional name and is used everywhere else in the codebase.

```tsx
// Before (line 14)
init: (input: { onExit?: () => Promise<void> }) => {

// After
init: (props: { onExit?: () => Promise<void> }) => {
```

And on line 35:

```tsx
// Before
await input.onExit?.()

// After
await props.onExit?.()
```

**Why this helps:** `input` is vague. These are component props passed through `ExitProvider`. Using `props` is consistent with SolidJS conventions and the `helper.tsx` file which names these `Props`.
