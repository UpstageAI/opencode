# Review: `packages/opencode/src/cli/cmd/tui/ui/link.tsx`

## Summary

This is a small, focused component — only 29 lines. It's already in reasonable shape, but there are a few issues that conflict with the project's style guide.

## Issues

### 1. Unnecessary intermediate variable `displayText` (line 16)

`displayText` is used exactly once (line 25). Per the style guide: _"Reduce total variable count by inlining when a value is only used once."_

**Before:**

```tsx
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      fg={props.fg}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
```

**After:**

```tsx
export function Link(props: LinkProps) {
  return (
    <text
      fg={props.fg}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {props.children ?? props.href}
    </text>
  )
}
```

Also, `displayText` is a two-word name. The style guide prefers single-word names. Inlining removes the problem entirely.

### 2. Exported `LinkProps` interface may be unnecessary (lines 5-9)

The `LinkProps` interface is exported but only consumed internally by `Link` in this same file. No other file imports `LinkProps` (only `Link` is imported, in `dialog-provider.tsx`). If it doesn't need to be exported, the export can be dropped. Better yet, the type can be inlined directly into the function signature to reduce boilerplate, since it's only used once:

**Before:**

```tsx
export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function Link(props: LinkProps) {
```

**After:**

```tsx
export function Link(props: { href: string; children?: JSX.Element | string; fg?: RGBA }) {
```

This is a judgment call — the named interface does improve readability for a public component API, and keeping it is defensible. But per the style guide's preference for reducing unnecessary type annotations and keeping things concise, inlining is the more consistent choice. If the interface is kept, at minimum drop the `export` keyword since nothing imports it.

### 3. JSDoc comment adds no value (lines 11-14)

The comment restates what the code already makes obvious from the component name, props, and the `open()` call. It doesn't describe any non-obvious behavior or edge cases.

**Before:**

```tsx
/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
```

**After:**

```tsx
export function Link(props: LinkProps) {
```

Comments should explain _why_, not restate _what_. A function named `Link` with an `href` prop and an `onMouseUp` handler that calls `open()` is self-documenting.

### 4. Unnecessary braces in `onMouseUp` callback (lines 21-23)

The arrow function body wraps a single expression in braces. This can be simplified to a concise arrow.

**Before:**

```tsx
onMouseUp={() => {
  open(props.href).catch(() => {})
}}
```

**After:**

```tsx
onMouseUp={() => open(props.href).catch(() => {})}
```

Minor, but consistent with keeping things concise.

## Full suggested rewrite

Applying all of the above:

```tsx
import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"

export function Link(props: { href: string; children?: JSX.Element | string; fg?: RGBA }) {
  return (
    <text fg={props.fg} onMouseUp={() => open(props.href).catch(() => {})}>
      {props.children ?? props.href}
    </text>
  )
}
```

This cuts the file from 29 lines to 10 lines with no loss of clarity or functionality.
