# Review: `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`

## Summary

This file is reasonably clean overall. It sets up an SDK context with event batching/flushing logic and SSE fallback. The main issues are: multiple `let` variables that form mutable state (acceptable here given the batching pattern), some unnecessary verbosity, an exported type that could be inlined, and a minor style inconsistency with `else`-like control flow. Most of the batching logic is well-structured and the file is short enough to be readable.

---

## Issues

### 1. Unnecessary exported type `EventSource` (lines 6-8)

The `EventSource` type is only used once, as the type of `props.events`. Defining and exporting it separately adds indirection. If nothing outside this file imports it, it should be inlined.

**Before:**

```tsx
export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
}

// ... later in props:
events?: EventSource
```

**After:**

```tsx
// inline in props:
events?: {
  on: (handler: (event: Event) => void) => () => void
}
```

Check whether `EventSource` is imported elsewhere first. If it is, keep the export but move it closer to where it's relevant or into a shared types file. If not, inline it and remove the export.

---

### 2. Unnecessary intermediate variable `events` (line 75)

The `events` variable is only used once on the very next line to access `.stream`. Inline it per the style guide ("reduce variable count by inlining when a value is only used once").

**Before (lines 75-82):**

```tsx
const events = await sdk.event.subscribe(
  {},
  {
    signal: abort.signal,
  },
)

for await (const event of events.stream) {
```

**After:**

```tsx
const response = await sdk.event.subscribe(
  {},
  {
    signal: abort.signal,
  },
)

for await (const event of response.stream) {
```

Actually, looking more carefully, the variable _is_ only used once. But renaming to `response` doesn't help. The real simplification is to just chain or keep the name short. This one is borderline - the multi-line `await` makes true inlining awkward. The current form is acceptable, though a shorter name like `sse` would be slightly better than the generic `events` which shadows the conceptual "events" used elsewhere in the function.

**Suggested:**

```tsx
const sse = await sdk.event.subscribe(
  {},
  {
    signal: abort.signal,
  },
)

for await (const event of sse.stream) {
```

This avoids confusion with the `queue` of `Event[]` also referred to as "events" on line 38.

---

### 3. Redundant `if` guard around `flush()` (lines 88-90)

`flush()` already has a guard `if (queue.length === 0) return` at line 37. The extra check on line 88 is redundant.

**Before (lines 87-90):**

```tsx
if (timer) clearTimeout(timer)
if (queue.length > 0) {
  flush()
}
```

**After:**

```tsx
if (timer) clearTimeout(timer)
flush()
```

**Why:** `flush()` is already a no-op when the queue is empty. Removing the redundant guard reduces noise and avoids the reader wondering if there's a subtle reason for the double-check.

---

### 4. `while (true)` with `if (break)` instead of while condition (lines 73-74)

The `break` on a condition at the top of the loop is an `if/break` pattern that can be expressed as the loop condition directly.

**Before (lines 73-74):**

```tsx
while (true) {
  if (abort.signal.aborted) break
```

**After:**

```tsx
while (!abort.signal.aborted) {
```

**Why:** Puts the termination condition where the reader expects it - in the loop header. Reduces one line and one level of indentation for the condition check.

---

### 5. `for...of` loop inside `batch()` could use `forEach` (lines 44-46)

The style guide prefers functional array methods over `for` loops. Since this is a simple iteration with a side effect (emitting), `forEach` is a natural fit and slightly more concise.

**Before (lines 43-47):**

```tsx
batch(() => {
  for (const event of events) {
    emitter.emit(event.type, event)
  }
})
```

**After:**

```tsx
batch(() => {
  events.forEach((event) => emitter.emit(event.type, event))
})
```

**Why:** More concise, consistent with the style guide's preference for functional array methods. The callback is a single expression, so the one-liner reads cleanly.

---

### 6. Variable name `last` is ambiguous (line 34)

`last` stores the timestamp of the last flush, but the name doesn't communicate that. In a file dealing with events and queues, `last` could mean many things.

**Before (line 34):**

```tsx
let last = 0
```

**After:**

```tsx
let flushed = 0
```

Then on line 41: `flushed = Date.now()` and line 52: `const elapsed = Date.now() - flushed`.

**Why:** `flushed` immediately communicates "the last time we flushed," making the elapsed-time calculation on line 52 self-documenting.

---

### 7. Unnecessary intermediate variable `unsub` (line 67)

Used only once on the next line. Inline it.

**Before (lines 67-68):**

```tsx
const unsub = props.events.on(handleEvent)
onCleanup(unsub)
```

**After:**

```tsx
onCleanup(props.events.on(handleEvent))
```

**Why:** Style guide says to reduce variable count by inlining when a value is only used once. The one-liner is still clear about what's happening.

---

### 8. Unnecessary intermediate variable `elapsed` (line 52)

Used only once on the next meaningful line. Could be inlined.

**Before (lines 52, 57):**

```tsx
const elapsed = Date.now() - last

if (timer) return
if (elapsed < 16) {
```

**After:**

```tsx
if (timer) return
if (Date.now() - last < 16) {
```

**Why:** `elapsed` is used exactly once. Inlining it puts the computation right where it's evaluated, reducing the variable count. The expression `Date.now() - last < 16` is simple enough to read inline.

---

### 9. The `flush` function reassigns `queue` via `let` (lines 32, 38-39)

The mutable `queue`/`timer`/`last` trio uses `let` with reassignment. This is a case where `let` is genuinely necessary (the batching pattern requires mutable state), so this is not a violation per se. However, an alternative pattern using a mutable object would use `const`:

**Alternative (not necessarily better, just noting):**

```tsx
const state = { queue: [] as Event[], timer: undefined as Timer | undefined, flushed: 0 }
```

This is a tradeoff - it trades three `let` bindings for one `const` object with mutable properties. The current approach with `let` is arguably clearer for this particular case since the variables are closely related but independently updated. **No change recommended** - just noting for completeness.

---

## Summary of Recommended Changes

| Priority | Line(s) | Issue                                                          |
| -------- | ------- | -------------------------------------------------------------- |
| Medium   | 73-74   | `while (true)` + `if/break` -> `while (!abort.signal.aborted)` |
| Medium   | 88-90   | Redundant `queue.length > 0` guard before `flush()`            |
| Low      | 67-68   | Inline `unsub` variable                                        |
| Low      | 75      | Rename `events` to `sse` to avoid ambiguity                    |
| Low      | 34      | Rename `last` to `flushed` for clarity                         |
| Low      | 52      | Inline `elapsed` variable                                      |
| Low      | 44-46   | `for...of` -> `forEach`                                        |
| Low      | 6-8     | Consider inlining `EventSource` type if not imported elsewhere |
