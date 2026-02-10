# Review: `packages/opencode/src/cli/cmd/tui/context/args.tsx`

## Summary

This is a 16-line file that is already quite clean. There is only one real issue worth flagging. The file follows the established `createSimpleContext` pattern used across the codebase and is consistent with sibling context files.

## Issues

### 1. Exported `Args` interface -- potentially unnecessary? (lines 3-10)

The `Args` interface is exported, but it's only used as the parameter type for `init`. Since `createSimpleContext` infers `Props` from the `init` function's parameter type, the interface could theoretically be inlined. However, `Args` is imported in `app.tsx` (`import { ArgsProvider, useArgs, type Args } from "./context/args"`), so the named export is justified. No change needed.

### 2. No issues found with the remaining code

The rest of the file is clean:

- `init: (props: Args) => props` is the simplest possible passthrough -- no unnecessary logic.
- Destructuring in `const { use: useArgs, provider: ArgsProvider }` is the established pattern across all sibling context files (`exit.tsx`, `sdk.tsx`, `theme.tsx`, etc.) and is required by the `createSimpleContext` API shape. This is not gratuitous destructuring.
- No `let`, no `else`, no `try/catch`, no `any`, no loops, no unnecessary variables.
- Naming is fine -- `Args` is a single word, `useArgs` and `ArgsProvider` follow the React/Solid convention established by every other context file in this directory.

## Verdict

This file is essentially already at the quality bar set by the style guide. The only potential change (inlining the interface) depends on whether `Args` is imported elsewhere, and even if it isn't, the current form is defensible for readability. No action required.
