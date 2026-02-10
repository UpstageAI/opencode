# Review: `toast.tsx`

## Summary

This file is reasonably clean for its size. The `Toast` component is straightforward. The main issues are in the `init` function: unnecessary destructuring, a `let` that could be avoided, an `any` type, and some redundant type annotations. A few naming and inlining improvements would tighten it up.

## Issues

### 1. Unnecessary destructuring in `show` (line 60)

The `duration` is destructured out of `parsedOptions` just to pass the remainder to `setStore`. But `duration` is an optional field on the schema and ends up on `currentToast` in the store type anyway (since `ToastOptions` includes it). The destructuring creates a throwaway `currentToast` variable that shadows the concept of the store field. Just pass the whole object and read `duration` via dot notation.

```tsx
// before (lines 59-61)
const parsedOptions = TuiEvent.ToastShow.properties.parse(options)
const { duration, ...currentToast } = parsedOptions
setStore("currentToast", currentToast)
if (timeoutHandle) clearTimeout(timeoutHandle)
timeoutHandle = setTimeout(() => {
  setStore("currentToast", null)
}, duration).unref()
```

```tsx
// after
const parsed = TuiEvent.ToastShow.properties.parse(options)
setStore("currentToast", parsed)
if (timeoutHandle) clearTimeout(timeoutHandle)
timeoutHandle = setTimeout(() => {
  setStore("currentToast", null)
}, parsed.duration).unref()
```

**Why:** Eliminates a rest-destructure and an extra variable. `parsed.duration` is clearer than a destructured `duration` floating in scope. Also renames `parsedOptions` to `parsed` — shorter, single-concept name per the style guide.

### 2. `let` for `timeoutHandle` (line 55)

`timeoutHandle` is a mutable `let` used to track the current timeout across calls. This is a legitimate use of `let` since it's mutated inside a closure across multiple invocations — no ternary trick applies here. **No change needed.** Noting it was evaluated.

### 3. `any` type on `error` parameter (line 67)

The style guide says avoid `any`. The parameter `err` is typed as `any` but only used via `instanceof Error`. It should be `unknown`.

```tsx
// before (line 67)
error: (err: any) => {
```

```tsx
// after
error: (err: unknown) => {
```

**Why:** `unknown` is type-safe and forces the `instanceof` check the code already does. `any` silently allows unsafe access.

### 4. `error` uses implicit fall-through instead of early return (lines 67-77)

The `error` method uses `return toast.show(...)` for the `Error` case but falls through for the else case. Adding an explicit `return` to the second call makes the parallel structure clearer.

```tsx
// before (lines 67-77)
error: (err: any) => {
  if (err instanceof Error)
    return toast.show({
      variant: "error",
      message: err.message,
    })
  toast.show({
    variant: "error",
    message: "An unknown error has occurred",
  })
},
```

```tsx
// after
error: (err: unknown) => {
  if (err instanceof Error)
    return toast.show({
      variant: "error",
      message: err.message,
    })
  return toast.show({
    variant: "error",
    message: "An unknown error has occurred",
  })
},
```

This is minor — the current code works — but the explicit `return` makes it immediately obvious both branches exit the function. Without it, a reader has to mentally confirm there's no code after the second `toast.show`.

### 5. Unnecessary type annotation on `currentToast` getter (line 78)

The return type `: ToastOptions | null` is redundant — it's inferred from `store.currentToast` which is already typed as `ToastOptions | null` on line 52.

```tsx
// before (line 78)
get currentToast(): ToastOptions | null {
  return store.currentToast
},
```

```tsx
// after
get currentToast() {
  return store.currentToast
},
```

**Why:** Style guide says rely on type inference. The annotation adds no safety here since the store is already typed.

### 6. Unnecessary type annotation on `timeoutHandle` (line 55)

The type `NodeJS.Timeout | null` is inferred from the `null` initializer and the `setTimeout` assignment.

```tsx
// before (line 55)
let timeoutHandle: NodeJS.Timeout | null = null
```

```tsx
// after
let timeoutHandle: ReturnType<typeof setTimeout> | null = null
```

Actually, `NodeJS.Timeout` won't be inferred from `null` alone — TypeScript would type it as `null`. The annotation is necessary here. However, `ReturnType<typeof setTimeout>` is more portable than `NodeJS.Timeout` if Bun's `setTimeout` returns something different. In practice, Bun matches Node's types here, so either works. **No change needed** — the annotation is justified.

### 7. `useToast` could be simplified (lines 94-100)

The `if` block with braces could be a one-liner.

```tsx
// before (lines 94-100)
export function useToast() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider")
  }
  return value
}
```

```tsx
// after
export function useToast() {
  const value = useContext(ctx)
  if (!value) throw new Error("useToast must be used within a ToastProvider")
  return value
}
```

**Why:** Single-statement `throw` doesn't benefit from braces. The one-liner form matches the early-return pattern used elsewhere in the codebase.

### 8. `{ theme }` destructuring on line 14

The style guide says to avoid unnecessary destructuring and prefer dot notation. However, `const { theme } = useTheme()` is the dominant convention across the entire TUI codebase (40+ files). Changing it here alone would be inconsistent. **No change recommended** for this file in isolation.

## Consolidated diff

If all recommended changes were applied:

```tsx
function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: NodeJS.Timeout | null = null

  const toast = {
    show(options: ToastOptions) {
      const parsed = TuiEvent.ToastShow.properties.parse(options)
      setStore("currentToast", parsed)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null)
      }, parsed.duration).unref()
    },
    error: (err: unknown) => {
      if (err instanceof Error)
        return toast.show({
          variant: "error",
          message: err.message,
        })
      return toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      })
    },
    get currentToast() {
      return store.currentToast
    },
  }
  return toast
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) throw new Error("useToast must be used within a ToastProvider")
  return value
}
```
