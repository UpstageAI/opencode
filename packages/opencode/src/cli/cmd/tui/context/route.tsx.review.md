# Review: `packages/opencode/src/cli/cmd/tui/context/route.tsx`

## Summary

This is a small, well-structured file. There are only a few minor issues worth addressing - mostly around unnecessary destructuring, a stray `console.log`, and a type annotation that could be simplified.

## Issues

### 1. Unnecessary destructuring of `createStore` (line 21)

The `[store, setStore]` destructuring is fine here since both values are used, but the variable names could be shortened. More importantly, this is idiomatic SolidJS and acceptable as-is. No change needed.

### 2. Stray `console.log` left in (line 34)

This looks like a debug statement that was never removed. It will pollute terminal output on every navigation.

**Before (line 34):**

```tsx
navigate(route: Route) {
  console.log("navigate", route)
  setStore(route)
},
```

**After:**

```tsx
navigate(route: Route) {
  setStore(route)
},
```

**Why:** Debug logging left in production code adds noise. If logging is intentional, it should use the project's `Log.create()` pattern, not raw `console.log`.

### 3. Unnecessary type annotation on `useRouteData` parameter (line 43)

The generic constraint `T extends Route["type"]` is fine, but the `type` parameter's annotation `type: T` could be inferred. However, since this is an exported function signature, the explicit type is acceptable for clarity. That said, the `typeof type` in the return type is redundant - `T` already is the type.

**Before (lines 43-46):**

```tsx
export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
```

**After:**

```tsx
export function useRouteData<T extends Route["type"]>(_type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: T }>
}
```

**Why:** `typeof type` resolves to `T` anyway, so using `T` directly is clearer and avoids an unnecessary `typeof` indirection. Also, the `type` parameter is never actually used at runtime - it only exists to capture the generic `T`. Prefixing with `_` communicates that intent. Alternatively, this function could be removed entirely (see issue 5).

### 4. Unnecessary intermediate variable in `useRouteData` (line 44)

The `route` variable is used only once, so it can be inlined.

**Before (lines 43-46):**

```tsx
export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
```

**After:**

```tsx
export function useRouteData<T extends Route["type"]>(_type: T) {
  return useRoute().data as Extract<Route, { type: T }>
}
```

**Why:** Per the style guide, reduce variable count by inlining when a value is only used once.

### 5. `useRouteData` may be dead or low-value code (lines 43-46)

This function takes a `type` parameter that is never used at runtime - it only serves as a generic type hint. The caller must already know which route type they're on, meaning this is just a cast helper. Consider whether callers could simply use `useRoute().data as SessionRoute` directly, which would be more explicit about the cast happening.

This isn't necessarily wrong, but it's worth verifying that this function is actually used, and if so, whether it provides enough value to justify its existence.

### 6. Inconsistent object formatting (lines 23-26)

Minor nitpick: the fallback object in the ternary has a trailing comma on the only property, which is fine but the closing brace alignment is slightly awkward due to the nesting inside `createStore()`.

**Before (lines 21-27):**

```tsx
const [store, setStore] = createStore<Route>(
  process.env["OPENCODE_ROUTE"]
    ? JSON.parse(process.env["OPENCODE_ROUTE"])
    : {
        type: "home",
      },
)
```

**After:**

```tsx
const [store, setStore] = createStore<Route>(
  process.env["OPENCODE_ROUTE"] ? JSON.parse(process.env["OPENCODE_ROUTE"]) : { type: "home" },
)
```

**Why:** The object only has one property. Keeping it on a single line is more readable and reduces vertical noise.

## Combined suggested state

Applying all fixes, the file would look like:

```tsx
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  initialPrompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  initialPrompt?: PromptInfo
}

export type Route = HomeRoute | SessionRoute

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [store, setStore] = createStore<Route>(
      process.env["OPENCODE_ROUTE"] ? JSON.parse(process.env["OPENCODE_ROUTE"]) : { type: "home" },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(route)
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(_type: T) {
  return useRoute().data as Extract<Route, { type: T }>
}
```
