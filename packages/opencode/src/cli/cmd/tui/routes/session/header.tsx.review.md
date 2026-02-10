# Code Review: `header.tsx`

## Summary

The file is reasonably clean but has several style guide violations: unnecessary destructuring, a `let` that should be `const`, an intermediate variable that should be inlined, and repeated hover-button JSX that could be extracted. There are also minor readability wins around type annotations and naming.

---

## Issues

### 1. Unnecessary destructuring of `useTheme()` (lines 13, 22, 62)

`{ theme }` is destructured in three places. Per the style guide, prefer dot notation to preserve context.

**Lines 13, 22, 62:**

```tsx
// Before
const { theme } = useTheme()

// After
const theme = useTheme().theme
```

This is a marginal call since `useTheme()` only returns `theme`, but dot notation is more consistent with the style guide and makes it clear what object it came from. Alternatively, if `useTheme` could just return the theme directly, that would be even better -- but that's outside this file's scope.

---

### 2. `let result` should be `const` with ternary (lines 55-58)

The style guide says to prefer `const` over `let` and use ternaries instead of reassignment.

**Lines 55-58:**

```tsx
// Before
let result = total.toLocaleString()
if (model?.limit.context) {
  result += "  " + Math.round((total / model.limit.context) * 100) + "%"
}
return result

// After
const base = total.toLocaleString()
return model?.limit.context ? base + "  " + Math.round((total / model.limit.context) * 100) + "%" : base
```

Eliminates `let` and the mutation. The variable `result` is vague anyway -- renaming to `base` or just inlining avoids the issue.

---

### 3. Intermediate variable `total` in `cost` memo can be inlined (lines 39-46)

`total` is only used once (in `format()`). Per the style guide: "Reduce total variable count by inlining when a value is only used once."

**Lines 38-47:**

```tsx
// Before
const cost = createMemo(() => {
  const total = pipe(
    messages(),
    sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
  )
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(total)
})

// After
const cost = createMemo(() =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(
    pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    ),
  ),
)
```

This is a judgment call -- the original is also readable. But it does follow the style guide more closely.

---

### 4. Intermediate variable `total` in `context` memo (lines 52-53)

`total` is used twice (line 53 computation and line 57 formatting), so it can't be inlined. However, the variable name `total` is reused across both `cost` and `context` memos for different things. In `cost` it means total dollar cost; in `context` it means total token count. This is fine since they're in different scopes, but renaming to `tokens` in the `context` memo would better communicate intent.

**Lines 52-53:**

```tsx
// Before
const total =
  last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write

// After (if kept as a variable)
const tokens =
  last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
```

---

### 5. `model` variable is only used once -- inline it (line 54)

The `model` variable is only referenced on line 56. It can be inlined into the condition.

**Lines 54-58:**

```tsx
// Before
const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
let result = total.toLocaleString()
if (model?.limit.context) {
  result += "  " + Math.round((total / model.limit.context) * 100) + "%"
}
return result

// After
const limit = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]?.limit.context
const base = tokens.toLocaleString()
return limit ? base + "  " + Math.round((tokens / limit) * 100) + "%" : base
```

This collapses three variables (`model`, `result`) into two (`limit`, `base`), eliminates the `let`, and is more direct about what we actually care about: the context limit number.

---

### 6. Repeated hover-button pattern (lines 92-121)

The three navigation buttons (Parent, Prev, Next) follow an identical pattern with only the label, hover key, command, and keybind differing. This is a clear candidate for extraction into a small local component to reduce the ~30 lines of near-duplicate JSX.

**Lines 92-121:**

```tsx
// Before (repeated 3 times)
<box
  onMouseOver={() => setHover("parent")}
  onMouseOut={() => setHover(null)}
  onMouseUp={() => command.trigger("session.parent")}
  backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
>
  <text fg={theme.text}>
    Parent <span style={{ fg: theme.textMuted }}>{keybind.print("session_parent")}</span>
  </text>
</box>

// After -- extract a local helper used three times
const NavButton = (props: {
  id: "parent" | "prev" | "next"
  label: string
  command: string
  bind: string
}) => (
  <box
    onMouseOver={() => setHover(props.id)}
    onMouseOut={() => setHover(null)}
    onMouseUp={() => command.trigger(props.command)}
    backgroundColor={hover() === props.id ? theme.backgroundElement : theme.backgroundPanel}
  >
    <text fg={theme.text}>
      {props.label} <span style={{ fg: theme.textMuted }}>{keybind.print(props.bind)}</span>
    </text>
  </box>
)

// Usage:
<box flexDirection="row" gap={2}>
  <NavButton id="parent" label="Parent" command="session.parent" bind="session_parent" />
  <NavButton id="prev" label="Prev" command="session.child.previous" bind="session_child_cycle_reverse" />
  <NavButton id="next" label="Next" command="session.child.next" bind="session_child_cycle" />
</box>
```

This cuts ~20 lines of duplicated JSX and makes it trivial to add/remove/reorder navigation buttons. The style guide says "keep things in one function unless composable or reusable" -- these buttons are reusable within the component.

---

### 7. `Title` component may be unnecessary (lines 12-19)

`Title` is only used once (line 127). It could be inlined into the JSX at the call site, removing a component boundary and the explicit type annotation on `props`.

**Lines 12-19 and 127:**

```tsx
// Before
const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}
// ...
<Title session={session} />

// After (inline at line 127)
<text fg={theme.text}>
  <span style={{ bold: true }}>#</span> <span style={{ bold: true }}>{session().title}</span>
</text>
```

This removes an extra component, an extra `useTheme()` call, and a type annotation. The `theme` variable is already in scope in `Header`.

---

### 8. `ContextInfo` component may be unnecessary (lines 21-30)

`ContextInfo` is used twice (lines 89, 128), so extraction is justified. However, it takes two `Accessor` props with explicit type annotations. The type annotation `Accessor<string | undefined>` on `context` could be dropped if the component were inlined or if the type were inferred from usage. This is a minor point -- keeping the component is fine since it's used twice.

No change recommended, just noting the explicit types.

---

### 9. Unused `narrow()` duplication (line 85)

`narrow()` is called three times in the subagent branch (lines 85, 85, 85 -- twice in the same expression). This is fine for a reactive signal but worth noting: `narrow()` appears in `flexDirection={narrow() ? "column" : "row"}` and `gap={narrow() ? 1 : 0}`. This is acceptable in SolidJS.

No change needed.

---

## Combined refactor of `context` memo

Applying issues 4 and 5 together, the full `context` memo becomes:

```tsx
// Before (lines 49-60)
const context = createMemo(() => {
  const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
  if (!last) return
  const total =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
  let result = total.toLocaleString()
  if (model?.limit.context) {
    result += "  " + Math.round((total / model.limit.context) * 100) + "%"
  }
  return result
})

// After
const context = createMemo(() => {
  const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
  if (!last) return
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  const limit = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]?.limit.context
  const base = tokens.toLocaleString()
  return limit ? base + "  " + Math.round((tokens / limit) * 100) + "%" : base
})
```

Changes: `let` eliminated, `model` inlined to just extract `limit`, `total` renamed to `tokens` for clarity.
