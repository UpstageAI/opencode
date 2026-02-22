# Fork Clean Summary Design

## Problem

`continueOnNewBranch`로 세션을 fork하면, 새 세션의 리뷰 패널에 **원본 세션의 파일 변경 내역**이 그대로 표시된다.

### Root Cause

`Session.fork()`가 모든 message parts를 그대로 복사하는데, 이 중 `step-start`/`step-finish` parts에 `snapshot` 참조가 포함되어 있다.

```
step-start { snapshot: "abc123" }  ← 원본 세션의 git snapshot
step-finish { snapshot: "def456" } ← 원본 세션의 git snapshot
```

`SessionSummary.computeDiff()`는 이 snapshot들을 스캔하여 `Snapshot.diffFull(from, to)`로 파일 변경을 계산한다. fork된 세션에서도 원본의 snapshot이 그대로 있으므로, 동일한 diff가 재생성된다.

### Data Flow

```
fork() → copies parts (with snapshots intact)
       ↓
summarize() triggered (by any agent activity on forked session)
       ↓
computeDiff() → scans step-start/step-finish parts → finds old snapshots
       ↓
Snapshot.diffFull(oldFrom, oldTo) → returns original session's file diffs
       ↓
setSummary() + Storage.write(["session_diff", newSessionID], diffs)
       ↓
Bus.publish(Session.Event.Diff) → frontend shows stale file changes
```

## Solution

User's chosen approach: **"대화만 복사, summary 초기화"**

### Changes

**1. `packages/opencode/src/session/index.ts` — `fork()` function**

parts 복사 시 `step-start`/`step-finish`의 `snapshot` 필드를 `undefined`로 설정:

```typescript
for (const part of msg.parts) {
  const data = { ...part }
  // strip snapshots so computeDiff returns [] for forked session
  if (data.type === "step-start" || data.type === "step-finish") {
    data.snapshot = undefined
  }
  await updatePart({
    ...data,
    id: Identifier.ascending("part"),
    messageID: cloned.id,
    sessionID: session.id,
  })
}
```

**2. 같은 함수, fork 완료 후 — empty summary + empty diff 초기화**

```typescript
await setSummary({
  sessionID: session.id,
  summary: { additions: 0, deletions: 0, files: 0 },
})
await Storage.write(["session_diff", session.id], [])
Bus.publish(Event.Diff, { sessionID: session.id, diff: [] })
```

### Why Both Steps

| Step                 | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| snapshot 제거        | `computeDiff()`가 향후 재계산해도 빈 결과 반환 보장        |
| empty summary 초기화 | fork 직후 frontend에서 즉시 0/0/0 표시, SSE로 빈 diff 전파 |

### What Is NOT Changed

- `fork()` schema — 새로운 파라미터 불필요
- Frontend — 기존 `session_diff` store 로직 그대로 동작
- SDK — regeneration 불필요
- 대화 내역 — message text, tool results 등은 그대로 보존 (snapshot 참조만 제거)

## Affected Files

| File                                     | Change                                         |
| ---------------------------------------- | ---------------------------------------------- |
| `packages/opencode/src/session/index.ts` | `fork()` — strip snapshots, init empty summary |

## Verification

1. `bun x tsc -b` in `packages/opencode` — type check
2. `bun run test:unit` in `packages/app` — unit tests
3. `bun x tsc -b && bunx --bun vite build` in `packages/app` — frontend build
4. Manual: "Continue on new branch" → 새 세션의 리뷰 패널에 파일 변경 0건 확인
