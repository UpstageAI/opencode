# Review: `dialog-message.tsx`

## Summary

The file is reasonably short and focused, but has a clear **duplicated logic block** (the prompt-info extraction pattern appears twice identically), some unnecessary intermediate variables, and a few style guide violations around `let`-style mutation inside `reduce` accumulators. Overall the structure is readable but could be tighter.

---

## Issues

### 1. Duplicated prompt extraction logic (lines 37–47 and 86–96)

The reduce block that builds `{ input, parts }` from message parts is copy-pasted verbatim in "Revert" and "Fork". This violates DRY and makes future changes error-prone — you'd have to update both. Extract it to a local helper.

**Before:**

```tsx
// lines 37–47 (in Revert)
const parts = sync.data.part[msg.id]
const promptInfo = parts.reduce(
  (agg, part) => {
    if (part.type === "text") {
      if (!part.synthetic) agg.input += part.text
    }
    if (part.type === "file") agg.parts.push(part)
    return agg
  },
  { input: "", parts: [] as PromptInfo["parts"] },
)

// lines 86–96 (in Fork — identical)
const parts = sync.data.part[msg.id]
return parts.reduce(
  (agg, part) => {
    if (part.type === "text") {
      if (!part.synthetic) agg.input += part.text
    }
    if (part.type === "file") agg.parts.push(part)
    return agg
  },
  { input: "", parts: [] as PromptInfo["parts"] },
)
```

**After:**

```tsx
function prompt(msgID: string): PromptInfo {
  const parts = sync.data.part[msgID]
  return {
    input: parts
      .filter((p) => p.type === "text" && !p.synthetic)
      .map((p) => (p as { text: string }).text)
      .join(""),
    parts: parts.filter((p) => p.type === "file") as PromptInfo["parts"],
  }
}
```

This also replaces the mutation-heavy `reduce` with functional `filter`/`map` (style guide: prefer functional array methods). The `reduce` here mutates `agg.input` via `+=` and `agg.parts` via `.push()` — both are imperative patterns that a `filter`+`map` avoids.

---

### 2. Unnecessary IIFE in Fork handler (lines 83–97)

The `initialPrompt` is assigned via an immediately-invoked function expression. This adds a layer of indentation and cognitive overhead for no composability benefit.

**Before:**

```tsx
const initialPrompt = (() => {
  const msg = message()
  if (!msg) return undefined
  const parts = sync.data.part[msg.id]
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text") {
        if (!part.synthetic) agg.input += part.text
      }
      if (part.type === "file") agg.parts.push(part)
      return agg
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  )
})()
```

**After** (with the helper from issue 1):

```tsx
const msg = message()
if (!msg) return
const result = await sdk.client.session.fork({
  sessionID: props.sessionID,
  messageID: props.messageID,
})
route.navigate({
  sessionID: result.data!.id,
  type: "session",
  initialPrompt: prompt(msg.id),
})
dialog.clear()
```

The early return on `!msg` eliminates the need for the IIFE. This also moves the guard to the top of the handler, consistent with the other two handlers.

---

### 3. Unnecessary intermediate variable `text` in Copy handler (lines 62–68)

The `text` variable is only used once, on the very next line. Inline it.

**Before:**

```tsx
const parts = sync.data.part[msg.id]
const text = parts.reduce((agg, part) => {
  if (part.type === "text" && !part.synthetic) {
    agg += part.text
  }
  return agg
}, "")

await Clipboard.copy(text)
```

**After** (with the shared helper or inline):

```tsx
await Clipboard.copy(
  sync.data.part[msg.id]
    .filter((p) => p.type === "text" && !p.synthetic)
    .map((p) => (p as { text: string }).text)
    .join(""),
)
```

Or, if the shared `prompt` helper exists, just `Clipboard.copy(prompt(msg.id).input)`.

---

### 4. `result` variable in Fork only used for `result.data!.id` (line 79–99)

The `result` variable is only used once to access `.data!.id`. It could be destructured or inlined, but more importantly the handler calls `sdk.client.session.fork` _before_ checking if the message exists (the IIFE at line 83 checks `message()` after the fork call). This means a fork API call fires even if the message is somehow null.

**Before:**

```tsx
onSelect: async (dialog) => {
  const result = await sdk.client.session.fork({
    sessionID: props.sessionID,
    messageID: props.messageID,
  })
  const initialPrompt = (() => {
    const msg = message()
    if (!msg) return undefined
    ...
  })()
  route.navigate({
    sessionID: result.data!.id,
    ...
  })
```

**After:**

```tsx
onSelect: async (dialog) => {
  const msg = message()
  if (!msg) return

  const result = await sdk.client.session.fork({
    sessionID: props.sessionID,
    messageID: props.messageID,
  })
  route.navigate({
    sessionID: result.data!.id,
    type: "session",
    initialPrompt: prompt(msg.id),
  })
  dialog.clear()
},
```

Guard first, then do work. Consistent with Revert and Copy handlers.

---

### 5. Inconsistent guard placement across handlers

Revert (line 28–29) and Copy (line 59–60) both guard `message()` at the top of the handler. Fork (line 83–85) buries it inside an IIFE after already making an API call. All three should follow the same pattern: guard at the top, bail early.

---

### 6. Variable name `agg` in reduce callbacks (lines 39, 63, 88)

`agg` is fine for a generic accumulator, but the functional rewrite proposed in issue 1 eliminates the reduces entirely, making this moot. If reduces are kept, `agg` is acceptable but `acc` is more conventional in this codebase — though either is a minor nit.

---

### 7. Variable `msg` shadows the reactive accessor pattern unnecessarily

In every handler, `const msg = message()` is called. This is fine — it unwraps the memo. But in the Fork handler the variable name `msg` is repeated inside the IIFE creating an inner scope shadow. With the IIFE removed (issue 2), this goes away.

---

## Suggested Full Rewrite

```tsx
import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))

  function prompt(msgID: string): PromptInfo {
    const parts = sync.data.part[msgID]
    return {
      input: parts
        .filter((p) => p.type === "text" && !p.synthetic)
        .map((p) => (p as { text: string }).text)
        .join(""),
      parts: parts.filter((p) => p.type === "file") as PromptInfo["parts"],
    }
  }

  return (
    <DialogSelect
      title="Message Actions"
      options={[
        {
          title: "Revert",
          value: "session.revert",
          description: "undo messages and file changes",
          onSelect: (dialog) => {
            const msg = message()
            if (!msg) return
            sdk.client.session.revert({
              sessionID: props.sessionID,
              messageID: msg.id,
            })
            if (props.setPrompt) props.setPrompt(prompt(msg.id))
            dialog.clear()
          },
        },
        {
          title: "Copy",
          value: "message.copy",
          description: "message text to clipboard",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return
            await Clipboard.copy(prompt(msg.id).input)
            dialog.clear()
          },
        },
        {
          title: "Fork",
          value: "session.fork",
          description: "create a new session",
          onSelect: async (dialog) => {
            const msg = message()
            if (!msg) return
            const result = await sdk.client.session.fork({
              sessionID: props.sessionID,
              messageID: props.messageID,
            })
            route.navigate({
              sessionID: result.data!.id,
              type: "session",
              initialPrompt: prompt(msg.id),
            })
            dialog.clear()
          },
        },
      ]}
    />
  )
}
```

### What changed

| Change                                 | Lines affected      | Why                                                    |
| -------------------------------------- | ------------------- | ------------------------------------------------------ |
| Extract `prompt()` helper              | 37–47, 62–68, 86–96 | Eliminates triple duplication of part-extraction logic |
| Replace `reduce` with `filter`/`map`   | 38–47, 63–68, 87–96 | Functional style, no mutation, easier to read          |
| Remove IIFE in Fork                    | 83–97               | Unnecessary complexity; early return is cleaner        |
| Move guard before fork API call        | 83–85               | Don't call API if message is null                      |
| Inline `text` / `promptInfo` variables | 62, 38              | Each used only once; inlining reduces noise            |
| Reorder `route`/`message` declarations | 16–17               | Group hooks together before derived state              |
