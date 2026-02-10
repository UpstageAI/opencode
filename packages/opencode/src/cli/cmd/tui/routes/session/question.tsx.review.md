# Code Review: `question.tsx`

## Summary

The file is functional but has several style guide violations and readability issues. The main problems are: unnecessary destructuring, unnecessary memos that add indirection without benefit, `else` blocks that should be early returns, intermediate variables used only once, and a large keyboard handler that's hard to follow. The JSX portion is reasonable given the UI complexity, though there are minor simplifications possible.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (line 15)

The style guide says to avoid destructuring and prefer dot notation. `theme` is extracted from `useTheme()` but this is the only field used, adding an unnecessary destructuring step.

**Before (line 15):**

```tsx
const { theme } = useTheme()
```

**After:**

```tsx
const theme = useTheme().theme
```

**Why:** Follows the style guide preference against destructuring. Preserves the origin of the value.

---

### 2. Excessive memo indirection (lines 19-44)

Many of these memos simply re-derive a property from another memo and are called exactly once in the keyboard handler or JSX. They obscure what's happening by forcing the reader to jump back to definitions. Some are warranted (e.g., `question`, `confirm`, `options` — used many times), but several are used only once or twice and just wrap a trivial expression.

Specifically:

- `custom` (line 36) — just `question()?.custom !== false`. Used twice (line 37 and JSX). Borderline, but the name `custom` shadows the parameter name `custom` in `pick()` on line 60, which causes a real bug-risk/confusion issue (see issue #3).
- `other` (line 37) — `custom() && store.selected === options().length`. Used in keyboard handler and JSX. Acceptable as a memo.
- `input` (line 38) — `store.custom[store.tab] ?? ""`. Used several times, fine.
- `multi` (line 39) — `question()?.multiple === true`. Used many times, fine.
- `customPicked` (lines 40-44) — contains an intermediate variable `value` that's used only once.

**Before (lines 40-44):**

```tsx
const customPicked = createMemo(() => {
  const value = input()
  if (!value) return false
  return store.answers[store.tab]?.includes(value) ?? false
})
```

**After:**

```tsx
const customPicked = createMemo(() => {
  if (!input()) return false
  return store.answers[store.tab]?.includes(input()) ?? false
})
```

**Why:** `value` is an intermediate variable for something used only in two spots in a 3-line function. Inlining it is clearer. (Note: in Solid, `input()` is a memo so calling it twice has no perf cost.)

---

### 3. `custom` parameter shadows memo name (line 60)

The `pick` function has a parameter named `custom` that shadows the memo `custom` on line 36. This is confusing and error-prone.

**Before (line 60):**

```tsx
function pick(answer: string, custom: boolean = false) {
```

**After:**

```tsx
function pick(answer: string, isCustom = false) {
```

And update the usage on line 64:

```tsx
if (isCustom) {
```

And the call site on line 184:

```tsx
pick(text, true) // no change needed, positional
```

**Why:** Avoids shadowing the outer `custom` memo. The reader doesn't have to wonder which `custom` is being referenced. Also, the `boolean = false` type annotation is unnecessary — TypeScript infers it from the default value.

---

### 4. Unnecessary type annotation on `custom` parameter (line 60)

**Before:**

```tsx
function pick(answer: string, custom: boolean = false) {
```

**After:**

```tsx
function pick(answer: string, isCustom = false) {
```

**Why:** The type `boolean` is inferred from the default value `false`. The style guide says to rely on type inference when possible.

---

### 5. `else` block in keyboard handler (lines 217-250)

The style guide says to avoid `else` and prefer early returns. The large `if (confirm()) { ... } else { ... }` block on lines 208-250 uses an `else` that makes the code harder to scan.

**Before (lines 208-250):**

```tsx
if (confirm()) {
  if (evt.name === "return") {
    evt.preventDefault()
    submit()
  }
  if (evt.name === "escape" || keybind.match("app_exit", evt)) {
    evt.preventDefault()
    reject()
  }
} else {
  const opts = options()
  const total = opts.length + (custom() ? 1 : 0)
  // ... rest of handler
}
```

**After:**

```tsx
if (confirm()) {
  if (evt.name === "return") {
    evt.preventDefault()
    submit()
  }
  if (evt.name === "escape" || keybind.match("app_exit", evt)) {
    evt.preventDefault()
    reject()
  }
  return
}

const total = options().length + (custom() ? 1 : 0)
const max = Math.min(total, 9)
const digit = Number(evt.name)
// ... rest of handler (no longer nested in else)
```

**Why:** Eliminates the `else` block and reduces nesting by one level. The `return` after the confirm block makes the control flow explicit. The entire non-confirm branch is now at the top level of the callback, making it easier to read.

---

### 6. Intermediate variable `opts` used only for `.length` (line 218)

**Before (lines 218-219):**

```tsx
const opts = options()
const total = opts.length + (custom() ? 1 : 0)
```

**After:**

```tsx
const total = options().length + (custom() ? 1 : 0)
```

**Why:** `opts` is only used for `.length`. Inlining reduces variable count per the style guide.

---

### 7. Intermediate variable `index` used only once (lines 225-227)

**Before (lines 225-227):**

```tsx
const index = digit - 1
moveTo(index)
selectOption()
```

**After:**

```tsx
moveTo(digit - 1)
selectOption()
```

**Why:** `index` is used exactly once. Inlining is clearer and reduces variable count.

---

### 8. Intermediate variable `direction` used only once (line 204)

**Before (lines 204-205):**

```tsx
const direction = evt.shift ? -1 : 1
selectTab((store.tab + direction + tabs()) % tabs())
```

**After:**

```tsx
selectTab((store.tab + (evt.shift ? -1 : 1) + tabs()) % tabs())
```

**Why:** `direction` is used once. The inline ternary is compact and readable enough in context.

---

### 9. `moveTo` function is trivial indirection (lines 91-93)

**Before (lines 91-93):**

```tsx
function moveTo(index: number) {
  setStore("selected", index)
}
```

This function is a single `setStore` call. It's called in 6 places. While it does provide a semantic name, the style guide says to keep things in one function unless composable or reusable. This is technically reusable, so it's borderline acceptable. However, `moveTo` is a vague name — `moveTo` what? It should at least be clearer.

**After:**

```tsx
function select(index: number) {
  setStore("selected", index)
}
```

Or simply inline `setStore("selected", ...)` at call sites since the intent is clear from the store key name.

**Why:** `moveTo` doesn't communicate what is being moved. `select` or direct `setStore` calls would be clearer.

---

### 10. `selectTab` could be simplified (lines 95-98)

**Before:**

```tsx
function selectTab(index: number) {
  setStore("tab", index)
  setStore("selected", 0)
}
```

Minor: two sequential `setStore` calls could use the batch form, but Solid's `createStore` doesn't support multi-key set in one call, so this is fine as-is. No change needed.

---

### 11. Repeated pattern for updating `store.custom` and `store.answers` (lines 61-68, 80-88, 148-179)

The pattern of spreading `store.custom` or `store.answers` into a new array, mutating an index, then calling `setStore` appears 5+ times. This is a candidate for extraction.

**Suggestion — helper functions:**

```tsx
function setCustom(tab: number, value: string) {
  const next = [...store.custom]
  next[tab] = value
  setStore("custom", next)
}

function setAnswers(tab: number, values: string[]) {
  const next = [...store.answers]
  next[tab] = values
  setStore("answers", next)
}
```

Then the `pick` function becomes:

**Before (lines 60-78):**

```tsx
function pick(answer: string, custom: boolean = false) {
  const answers = [...store.answers]
  answers[store.tab] = [answer]
  setStore("answers", answers)
  if (custom) {
    const inputs = [...store.custom]
    inputs[store.tab] = answer
    setStore("custom", inputs)
  }
  // ...
}
```

**After:**

```tsx
function pick(answer: string, isCustom = false) {
  setAnswers(store.tab, [answer])
  if (isCustom) setCustom(store.tab, answer)
  // ...
}
```

Similarly `toggle` simplifies:

**Before (lines 80-89):**

```tsx
function toggle(answer: string) {
  const existing = store.answers[store.tab] ?? []
  const next = [...existing]
  const index = next.indexOf(answer)
  if (index === -1) next.push(answer)
  if (index !== -1) next.splice(index, 1)
  const answers = [...store.answers]
  answers[store.tab] = next
  setStore("answers", answers)
}
```

**After:**

```tsx
function toggle(answer: string) {
  const existing = store.answers[store.tab] ?? []
  const next = existing.includes(answer) ? existing.filter((x) => x !== answer) : [...existing, answer]
  setAnswers(store.tab, next)
}
```

**Why:** Eliminates repeated boilerplate. The `toggle` rewrite also replaces imperative indexOf/splice with functional `filter`/spread, which is more idiomatic per the style guide's preference for functional array methods. The two mutually exclusive `if` statements (lines 84-85) checking the same condition are especially awkward — they should be an if/else or a ternary.

---

### 12. Two mutually exclusive `if` without `else` in `toggle` (lines 84-85)

**Before:**

```tsx
const index = next.indexOf(answer)
if (index === -1) next.push(answer)
if (index !== -1) next.splice(index, 1)
```

These are logically `if/else` but written as two separate `if` checks on opposite conditions. This is confusing — the reader has to verify they're mutually exclusive.

**After (using functional approach from issue #11):**

```tsx
const next = existing.includes(answer) ? existing.filter((x) => x !== answer) : [...existing, answer]
```

**Why:** Mutually exclusive conditions should be expressed as a single branching construct, not two independent `if` statements. The functional approach avoids mutation entirely.

---

### 13. `submit` function has an intermediate `answers` variable (lines 46-52)

**Before:**

```tsx
function submit() {
  const answers = questions().map((_, i) => store.answers[i] ?? [])
  sdk.client.question.reply({
    requestID: props.request.id,
    answers,
  })
}
```

**After:**

```tsx
function submit() {
  sdk.client.question.reply({
    requestID: props.request.id,
    answers: questions().map((_, i) => store.answers[i] ?? []),
  })
}
```

**Why:** `answers` is used once. Inline it to reduce variable count.

---

### 14. `reject` function body could be more concise (lines 54-58)

The object literal is spread across 3 lines for a single property:

**Before:**

```tsx
function reject() {
  sdk.client.question.reject({
    requestID: props.request.id,
  })
}
```

This is fine stylistically. No change needed — just noting it's already concise enough.

---

### 15. `tabHover` signal type is overly broad (line 22)

**Before:**

```tsx
const [tabHover, setTabHover] = createSignal<number | "confirm" | null>(null)
```

The `"confirm"` string literal is used only for the confirm tab. Since confirm is the last tab (index `questions().length`), this could just be `number | null` and use the actual index. But this is a design choice that affects readability of the JSX (`tabHover() === "confirm"` is arguably more readable than `tabHover() === questions().length`). **No change recommended** — this is a reasonable tradeoff.

---

### 16. Large keyboard handler could benefit from extraction (lines 125-251)

The `useKeyboard` callback is ~125 lines. While the style guide says keep things in one function, this handler has two clearly distinct modes (editing mode vs. navigation mode) plus confirm vs. question handling. Breaking the editing-mode handling into a separate function would improve readability.

**Suggestion:**

```tsx
function handleEditing(evt: KeyboardEvent): boolean {
  // returns true if handled
  if (!store.editing || confirm()) return false

  if (evt.name === "escape") {
    evt.preventDefault()
    setStore("editing", false)
    return true
  }
  // ... rest of editing handler
  return true
}
```

Then in `useKeyboard`:

```tsx
useKeyboard((evt) => {
  if (dialog.stack.length > 0) return
  if (handleEditing(evt)) return
  // ... navigation/selection handling
})
```

**Why:** Reduces cognitive load. The reader can understand the keyboard handler's structure at a glance: "skip if dialog open, handle editing mode, handle navigation." Each piece is independently readable.

---

## Summary of Changes by Priority

| Priority | Issue                                                                          | Lines                 |
| -------- | ------------------------------------------------------------------------------ | --------------------- |
| High     | `else` block → early return in keyboard handler                                | 208-250               |
| High     | Mutually exclusive `if` statements in `toggle`                                 | 84-85                 |
| High     | `custom` parameter shadows memo name                                           | 60                    |
| High     | Extract repeated array-update boilerplate                                      | 61-68, 80-88, 148-179 |
| Medium   | Unnecessary destructuring of `useTheme()`                                      | 15                    |
| Medium   | Inline single-use variables (`opts`, `index`, `direction`, `answers`, `value`) | 218, 225, 204, 47, 41 |
| Medium   | Unnecessary type annotation on default parameter                               | 60                    |
| Low      | Rename `moveTo` → `select` or inline                                           | 91-93                 |
| Low      | Extract editing keyboard handler                                               | 125-190               |
| Low      | Inline `answers` in `submit`                                                   | 46-52                 |
