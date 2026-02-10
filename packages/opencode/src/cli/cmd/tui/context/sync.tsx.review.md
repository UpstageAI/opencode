# Review: `sync.tsx`

## Summary

The file implements a SolidJS store + event sync layer for the TUI. The event handler switch is reasonable in structure, but `bootstrap()` is a tangled mess of redundant `.then()` chains, unnecessary re-awaiting of already-resolved promises, and gratuitous destructuring. There are also scattered style guide violations throughout: `let`-style patterns via mutable arrays, unnecessary intermediate variables, destructuring where dot notation would suffice, and a `for` loop where a functional method would work.

---

## Issues

### 1. Unnecessary intermediate variable `event` (line 108)

`event` is just an alias for `e.details` and adds an extra name for no reason.

**Before (line 107-109):**

```tsx
sdk.event.listen((e) => {
  const event = e.details
  switch (event.type) {
```

**After:**

```tsx
sdk.event.listen((e) => {
  switch (e.details.type) {
```

Then replace all `event.properties` with `e.details.properties` and `event.type` with `e.details.type` throughout the handler. Alternatively, name the callback parameter `event` directly:

```tsx
sdk.event.listen(({ details: event }) => {
  switch (event.type) {
```

**Why:** Reduces variable count. The style guide says to inline when a value is only used to access properties. That said, `event` is used many times, so the destructured-parameter form is the cleanest option here -- it avoids a new line while keeping the short name.

---

### 2. Unnecessary destructuring in `permission.asked` and `question.asked` (lines 129, 167)

`request` is destructured from `event.properties` just to save characters, but the style guide says to prefer dot notation over destructuring.

**Before (line 129-130):**

```tsx
case "permission.asked": {
  const request = event.properties
  const requests = store.permission[request.sessionID]
```

**After:**

```tsx
case "permission.asked": {
  const requests = store.permission[event.properties.sessionID]
```

Then use `event.properties` directly in place of `request` throughout the case block. Same for `question.asked` at line 167.

**Why:** The style guide explicitly says avoid unnecessary destructuring, use dot notation. `request` is just an alias for `event.properties`.

---

### 3. `bootstrap()` re-awaits already-resolved promises (lines 352-370)

After `Promise.all(blockingRequests)` resolves, all the individual promises (`providersPromise`, etc.) are already settled. The code then calls `.then()` on each one _again_ to extract `.data`, wraps those in _another_ `Promise.all`, then destructures the results by index. This is convoluted.

**Before (lines 351-381):**

```tsx
await Promise.all(blockingRequests).then(() => {
  const providersResponse = providersPromise.then((x) => x.data!)
  const providerListResponse = providerListPromise.then((x) => x.data!)
  const agentsResponse = agentsPromise.then((x) => x.data ?? [])
  const configResponse = configPromise.then((x) => x.data!)
  const sessionListResponse = args.continue ? sessionListPromise : undefined

  return Promise.all([
    providersResponse,
    providerListResponse,
    agentsResponse,
    configResponse,
    ...(sessionListResponse ? [sessionListResponse] : []),
  ]).then((responses) => {
    const providers = responses[0]
    const providerList = responses[1]
    const agents = responses[2]
    const config = responses[3]
    const sessions = responses[4]

    batch(() => {
      setStore("provider", reconcile(providers.providers))
      setStore("provider_default", reconcile(providers.default))
      setStore("provider_next", reconcile(providerList))
      setStore("agent", reconcile(agents))
      setStore("config", reconcile(config))
      if (sessions !== undefined) setStore("session", reconcile(sessions))
    })
  })
})
```

Since the promises are already resolved, just await them directly:

**After:**

```tsx
const [providers, providerList, agents, config] = await Promise.all([
  providersPromise,
  providerListPromise,
  agentsPromise,
  configPromise,
  ...(args.continue ? [sessionListPromise] : []),
])

const sessions = args.continue ? await sessionListPromise : undefined

batch(() => {
  setStore("provider", reconcile(providers.data!.providers))
  setStore("provider_default", reconcile(providers.data!.default))
  setStore("provider_next", reconcile(providerList.data!))
  setStore("agent", reconcile(agents.data ?? []))
  setStore("config", reconcile(config.data!))
  if (sessions !== undefined) setStore("session", reconcile(sessions))
})
```

**Why:** The original creates 5 unnecessary intermediate variables, 2 unnecessary `Promise.all` calls, and 2 unnecessary `.then()` chains for promises that are already settled. This is the biggest readability problem in the file.

---

### 4. Chained `.then()` where `async`/`await` would be clearer (lines 351-409)

The entire `bootstrap()` function is `async` but uses `.then().then().catch()` chaining instead of `await` + `try`/`catch`. Normally we avoid `try`/`catch`, but the current `.then().then().catch()` chain is harder to follow than either approach. Since the error handling calls `exit()`, a top-level catch is reasonable here.

**Before (lines 351-409):**

```tsx
await Promise.all(blockingRequests)
  .then(() => {
    // ... 30 lines of re-awaiting
  })
  .then(() => {
    if (store.status !== "complete") setStore("status", "partial")
    // non-blocking
    Promise.all([...]).then(() => {
      setStore("status", "complete")
    })
  })
  .catch(async (e) => {
    Log.Default.error("tui bootstrap failed", { ... })
    await exit(e)
  })
```

**After:**

```tsx
async function bootstrap() {
  console.log("bootstrapping")
  const start = Date.now() - 30 * 24 * 60 * 60 * 1000

  const sessionListPromise = sdk.client.session
    .list({ start })
    .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))

  const providersPromise = sdk.client.config.providers({}, { throwOnError: true })
  const providerListPromise = sdk.client.provider.list({}, { throwOnError: true })
  const agentsPromise = sdk.client.app.agents({}, { throwOnError: true })
  const configPromise = sdk.client.config.get({}, { throwOnError: true })

  const [providers, providerList, agents, config] = await Promise.all([
    providersPromise,
    providerListPromise,
    agentsPromise,
    configPromise,
    ...(args.continue ? [sessionListPromise] : []),
  ]).catch(async (e) => {
    Log.Default.error("tui bootstrap failed", {
      error: e instanceof Error ? e.message : String(e),
      name: e instanceof Error ? e.name : undefined,
      stack: e instanceof Error ? e.stack : undefined,
    })
    await exit(e)
    throw e // unreachable but satisfies types
  })

  const sessions = args.continue ? await sessionListPromise : undefined

  batch(() => {
    setStore("provider", reconcile(providers.data!.providers))
    setStore("provider_default", reconcile(providers.data!.default))
    setStore("provider_next", reconcile(providerList.data!))
    setStore("agent", reconcile(agents.data ?? []))
    setStore("config", reconcile(config.data!))
    if (sessions !== undefined) setStore("session", reconcile(sessions))
  })

  if (store.status !== "complete") setStore("status", "partial")

  // non-blocking
  Promise.all([
    ...(args.continue ? [] : [sessionListPromise.then((s) => setStore("session", reconcile(s)))]),
    sdk.client.command.list().then((x) => setStore("command", reconcile(x.data ?? []))),
    sdk.client.lsp.status().then((x) => setStore("lsp", reconcile(x.data!))),
    sdk.client.mcp.status().then((x) => setStore("mcp", reconcile(x.data!))),
    sdk.client.experimental.resource.list().then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
    sdk.client.formatter.status().then((x) => setStore("formatter", reconcile(x.data!))),
    sdk.client.session.status().then((x) => setStore("session_status", reconcile(x.data!))),
    sdk.client.provider.auth().then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
    sdk.client.vcs.get().then((x) => setStore("vcs", reconcile(x.data))),
    sdk.client.path.get().then((x) => setStore("path", reconcile(x.data!))),
  ]).then(() => {
    setStore("status", "complete")
  })
}
```

**Why:** Flat async/await is easier to follow than nested `.then()` chains. The original has 3 levels of `.then()` nesting which makes the control flow hard to trace.

---

### 5. Unnecessary shorthand `{ start: start }` (line 335)

**Before (line 334-335):**

```tsx
const start = Date.now() - 30 * 24 * 60 * 60 * 1000
const sessionListPromise = sdk.client.session.list({ start: start })
```

**After:**

```tsx
const start = Date.now() - 30 * 24 * 60 * 60 * 1000
const sessionListPromise = sdk.client.session.list({ start })
```

**Why:** Redundant property name. ES6 shorthand is cleaner.

---

### 6. Mutable array used for `blockingRequests` (lines 343-349)

`blockingRequests` is a `const` array but is built with a spread conditional. This is fine syntactically, but the variable itself is only used once on the very next line. It should be inlined.

**Before (lines 343-351):**

```tsx
const blockingRequests: Promise<unknown>[] = [
  providersPromise,
  providerListPromise,
  agentsPromise,
  configPromise,
  ...(args.continue ? [sessionListPromise] : []),
]

await Promise.all(blockingRequests)
```

**After:**

```tsx
await Promise.all([
  providersPromise,
  providerListPromise,
  agentsPromise,
  configPromise,
  ...(args.continue ? [sessionListPromise] : []),
])
```

**Why:** Style guide says to inline when a value is only used once. Also removes an explicit type annotation (`Promise<unknown>[]`) that only exists because the intermediate variable needs it.

---

### 7. `for` loop in `session.sync` (line 457)

**Before (lines 456-459):**

```tsx
draft.message[sessionID] = messages.data!.map((x) => x.info)
for (const message of messages.data!) {
  draft.part[message.info.id] = message.parts
}
```

**After:**

```tsx
draft.message[sessionID] = messages.data!.map((x) => x.info)
messages.data!.forEach((x) => {
  draft.part[x.info.id] = x.parts
})
```

Alternatively, since this is inside a `produce` and we're doing side effects (mutations), the `for` loop is arguably acceptable here. But the style guide says to prefer functional array methods. Either way, this is a minor point.

**Why:** Style guide prefers functional array methods over `for` loops.

---

### 8. `console.log` left in `bootstrap` (line 332)

**Before (line 332):**

```tsx
console.log("bootstrapping")
```

The codebase has a `Log` utility. This should either use `Log.Default.info(...)` or be removed.

**Why:** Inconsistent with the rest of the file which uses `Log.Default.error` at line 403. Stray `console.log` calls look like debugging leftovers.

---

### 9. Unnecessary explicit type annotation on the store (lines 35-76)

The store's type is a 40-line inline type annotation. This is a necessary evil since `createStore` needs to know the shape, and the initial value has empty arrays/objects that can't infer the element types. However, the annotation could be extracted to a named type alias above to keep the `createStore` call readable.

This is not strictly a violation but a readability suggestion. The `init` function is already very long; extracting the type would help.

---

### 10. Repeated `event.properties.sessionID` / `event.properties.info` (throughout)

Several case blocks repeatedly access `event.properties.sessionID` or `event.properties.info` 3-4 times. For example in `message.updated` (lines 228-265), `event.properties.info` is referenced 6 times. This is a tension with the "no destructuring" rule. Given the repetition, a local alias here is justified -- but it should be for `event.properties.info`, not a destructuring.

**Before (lines 228-232):**

```tsx
case "message.updated": {
  const messages = store.message[event.properties.info.sessionID]
  if (!messages) {
    setStore("message", event.properties.info.sessionID, [event.properties.info])
    break
  }
```

**After:**

```tsx
case "message.updated": {
  const msg = event.properties.info
  const messages = store.message[msg.sessionID]
  if (!messages) {
    setStore("message", msg.sessionID, [msg])
    break
  }
```

**Why:** When a deeply nested path is accessed 6+ times, a short alias improves readability without violating the spirit of "avoid destructuring." This isn't destructuring -- it's a named reference to a nested object.

---

### 11. Inconsistent callback parameter naming in `.then()` chains

The non-blocking section uses `(x)` uniformly (line 386-397), which is fine. But the `session.status` callback at line 392-394 has an unnecessary block body:

**Before (lines 392-394):**

```tsx
sdk.client.session.status().then((x) => {
  setStore("session_status", reconcile(x.data!))
}),
```

**After:**

```tsx
sdk.client.session.status().then((x) => setStore("session_status", reconcile(x.data!))),
```

**Why:** Every other `.then()` in the same block uses a concise arrow. This one has braces and a newline for no reason. Consistency matters.

---

## Priority

1. **High -- `bootstrap()` rewrite (issues 3, 4, 6):** The nested `.then()` chains with redundant re-awaiting of settled promises is the single biggest quality problem. It makes the most critical function in the file unnecessarily hard to follow.
2. **Medium -- Alias `event.properties.info` where used heavily (issue 10):** Reduces noise in the longest case blocks.
3. **Medium -- Remove `console.log` or use `Log` (issue 8):** Consistency with existing patterns.
4. **Low -- Everything else:** Minor style nits that improve consistency but don't affect comprehension significantly.
