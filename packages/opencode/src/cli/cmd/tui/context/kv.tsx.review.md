# Review: `packages/opencode/src/cli/cmd/tui/context/kv.tsx`

## Summary

This is a small file (53 lines) providing a key-value store context backed by a JSON file. The overall structure is reasonable, but there are several style guide violations and readability issues — unnecessary destructuring, unused imports, `any` types that could be narrowed, verbose function expressions, and an intermediate variable that could be inlined.

---

## Issues

### 1. Unnecessary destructuring of `createSignal` (line 10)

The style guide says to avoid destructuring and prefer dot notation. However, `createSignal` returns a tuple, not an object — destructuring tuples is idiomatic in Solid and unavoidable here. **No change needed.**

---

### 2. `Record<string, any>` store type (line 11)

The `any` type is explicitly discouraged by the style guide. Since the KV store holds JSON-serializable values loaded from a file, `unknown` is more appropriate. The `get` and `set` methods already act as the boundary where callers provide their own types via `signal<T>` or cast at the call site.

**Before:**

```tsx
const [store, setStore] = createStore<Record<string, any>>()
```

**After:**

```tsx
const [store, setStore] = createStore<Record<string, unknown>>()
```

**Why:** Replacing `any` with `unknown` forces callers to handle the type explicitly, catching bugs at compile time. The `signal` method already has a generic `<T>` to manage this. The `get` method's return type also becomes more honest.

---

### 3. `any` in `get` and `set` parameter types (lines 42, 45)

Same issue — `any` should be narrowed.

**Before:**

```tsx
get(key: string, defaultValue?: any) {
  return store[key] ?? defaultValue
},
set(key: string, value: any) {
```

**After:**

```tsx
get<T>(key: string, defaultValue?: T): T {
  return (store[key] as T) ?? (defaultValue as T)
},
set(key: string, value: unknown) {
```

**Why:** The `get` method is always called with a default value at every call site (e.g. `kv.get("animations_enabled", true)`, `kv.get("theme_mode", props.mode)`). Making it generic lets TypeScript infer the return type from the default, eliminating implicit `any` at all 15+ call sites. `set` accepts `unknown` since the store holds `unknown`.

---

### 4. Unused import: `Setter` (line 2)

`Setter` is imported but the `signal` method's setter parameter on line 37 types `next` as `Setter<T>`, which means callers would pass a function `(prev: T) => T` — but `result.set` on line 38 just passes `next` directly to `setStore`, which doesn't support the Solid setter protocol. The `Setter` type is misleading here. Looking at actual usage:

```tsx
setShowThinking((prev) => !prev)
```

The consumer passes a function `(prev) => !prev`, but `result.set` at line 38 calls `setStore(key, value)` which does **not** invoke the function — it stores the function literal as the value. This is a **bug**, not just a style issue. But from a style perspective, the import is unused in the way it claims to work.

However, since fixing the bug is out of scope for a style review, at minimum the type should honestly reflect what actually happens — it accepts any value:

**Before:**

```tsx
import { createSignal, type Setter } from "solid-js"
```

**After:**

```tsx
import { createSignal } from "solid-js"
```

**Why:** Removing the unused/misleading import reduces noise.

---

### 5. Verbose `function` expressions in `signal` (lines 34-39)

The two function expressions inside `signal` are unnecessarily verbose. Arrow functions are more concise and consistent with the rest of the codebase.

**Before:**

```tsx
signal<T>(name: string, defaultValue: T) {
  if (store[name] === undefined) setStore(name, defaultValue)
  return [
    function () {
      return result.get(name)
    },
    function setter(next: Setter<T>) {
      result.set(name, next)
    },
  ] as const
},
```

**After:**

```tsx
signal<T>(name: string, defaultValue: T) {
  if (store[name] === undefined) setStore(name, defaultValue as unknown)
  return [
    () => result.get<T>(name, defaultValue),
    (next: unknown) => result.set(name, next),
  ] as const
},
```

**Why:** Arrow functions are shorter and more readable. The named `function setter` serves no purpose — the name isn't used for recursion or stack traces in any meaningful way. Passing `defaultValue` to `get` also ensures a consistent fallback.

---

### 6. Unnecessary intermediate `result` variable (lines 24-50)

The `result` variable exists so that `signal`'s inner functions can reference `result.get` and `result.set`. This self-reference is needed, so the variable can't be fully eliminated. However, the `return result` on line 50 could be inlined if the self-references used the methods directly instead. Since `get` and `set` are simple one-liners, the signal closures could capture `store`/`setStore` directly rather than going through the result object.

**Before:**

```tsx
const result = {
  get ready() {
    return ready()
  },
  get store() {
    return store
  },
  signal<T>(name: string, defaultValue: T) {
    if (store[name] === undefined) setStore(name, defaultValue)
    return [
      function () {
        return result.get(name)
      },
      function setter(next: Setter<T>) {
        result.set(name, next)
      },
    ] as const
  },
  get(key: string, defaultValue?: any) {
    return store[key] ?? defaultValue
  },
  set(key: string, value: any) {
    setStore(key, value)
    Bun.write(file, JSON.stringify(store, null, 2))
  },
}
return result
```

**After:**

```tsx
function get<T>(key: string, defaultValue?: T): T {
  return (store[key] as T) ?? (defaultValue as T)
}

function set(key: string, value: unknown) {
  setStore(key, value)
  Bun.write(file, JSON.stringify(store, null, 2))
}

return {
  get ready() {
    return ready()
  },
  get store() {
    return store
  },
  signal<T>(name: string, defaultValue: T) {
    if (store[name] === undefined) setStore(name, defaultValue as unknown)
    return [() => get<T>(name, defaultValue), (next: unknown) => set(name, next)] as const
  },
  get,
  set,
}
```

**Why:** Extracting `get` and `set` as standalone functions removes the need for the `result` self-reference pattern. The return object can be returned directly without assigning it to a variable first. This follows the style guide's preference for reducing variable count.

---

### 7. Multiline `.then`/`.catch`/`.finally` chain (lines 14-22)

The promise chain has unnecessary line breaks inside each callback.

**Before:**

```tsx
file
  .json()
  .then((x) => {
    setStore(x)
  })
  .catch(() => {})
  .finally(() => {
    setReady(true)
  })
```

**After:**

```tsx
file
  .json()
  .then((x) => setStore(x))
  .catch(() => {})
  .finally(() => setReady(true))
```

**Why:** Each callback is a single expression. The block form with braces adds 6 extra lines for no benefit. The concise arrow form is easier to scan.

---

### 8. `file` variable could be inlined (line 12)

The `file` variable is used in two places (the initial `.json()` read and in `set` for writing), so it can't be inlined. **No change needed.**

---

## Potential Bug (informational)

The `signal` method's setter (line 37-39) accepts `Setter<T>` which in Solid's API means it can be either a raw value or a function `(prev: T) => T`. But `result.set` at line 38 passes whatever it receives directly to `setStore(key, value)`. When consumers call `setShowThinking((prev) => !prev)`, the function `(prev) => !prev` is passed to `set`, and `setStore` from `solid-js/store` does handle function setters — so this actually works by coincidence via Solid's store setter behavior. However, the typing is misleading: the parameter should match what `setStore`'s path-based setter accepts, not Solid's signal `Setter` type. This isn't a style-only issue but worth noting.

---

## Complete Suggested Rewrite

```tsx
import { Global } from "@/global"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import path from "path"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, unknown>>()
    const file = Bun.file(path.join(Global.Path.state, "kv.json"))

    file
      .json()
      .then((x) => setStore(x))
      .catch(() => {})
      .finally(() => setReady(true))

    function get<T>(key: string, defaultValue?: T): T {
      return (store[key] as T) ?? (defaultValue as T)
    }

    function set(key: string, value: unknown) {
      setStore(key, value)
      Bun.write(file, JSON.stringify(store, null, 2))
    }

    return {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue as unknown)
        return [() => get<T>(name, defaultValue), (next: unknown) => set(name, next)] as const
      },
      get,
      set,
    }
  },
})
```

Changes from original: 53 lines → 47 lines. Removes `any` (×3), removes unused `Setter` import, eliminates `result` self-reference variable, simplifies function expressions, and compresses the promise chain.
