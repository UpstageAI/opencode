# OpenCode Web Conductor-Style Redesign Plan

## Goal

`opencode web`의 현재 강점(세션/리뷰/터미널/토큰 기반 테마)을 유지하면서, Conductor 스타일의 "워크스페이스 오케스트레이션" 경험으로 재구성한다.

## Non-Goals

- 백엔드 프로토콜/세션 모델을 Conductor와 동일하게 변경하지 않는다.
- 기존 기능(권한 요청, 질문/응답, 리뷰, 파일 트리, 터미널)을 제거하지 않는다.
- `packages/web` 문서 사이트를 제품 앱처럼 리디자인하지 않는다.

## Active Scope (Only What You Asked)

이번 계획의 구현 범위는 2개만 포함한다.

1. **Session 상태 가시화**: 진행(in progress) / 리뷰(in review) / 완결(done) 상태를 사이드바와 세션 뷰에서 즉시 파악 가능하게 만들기.
2. **New Workspace 흐름 가시화**: 새 작업공간 생성 시 git worktree 기반 생성-준비-실패 상태를 사용자에게 명확히 보여주기.

나머지 영역(전체 테마 리뉴얼, 다른 페이지 구조 변경)은 제외한다.

## Implementation Map (Existing Ownership)

### App (UI) Ownership

- 세션/워크스페이스 리스트 렌더링: `packages/app/src/pages/layout/sidebar-workspace.tsx`
- 세션 상태(working/permission/error/unseen) 계산: `packages/app/src/pages/layout/sidebar-items.tsx`
- 새 워크스페이스 생성/삭제/리셋 액션: `packages/app/src/pages/layout.tsx`
- worktree 준비/실패 이벤트 반영: `packages/app/src/pages/layout.tsx`
- 세션 리뷰 지표(변경 수): `packages/app/src/pages/session/session-side-panel.tsx`
- 레이아웃 지속 상태(사이드바/workspaces on-off 등): `packages/app/src/context/layout.tsx`

### Server (Worktree) Ownership

- API 라우트: `packages/opencode/src/server/routes/experimental.ts`
  - `POST /experimental/worktree` (`worktree.create`)
  - `GET /experimental/worktree` (`worktree.list`)
  - `DELETE /experimental/worktree` (`worktree.remove`)
  - `POST /experimental/worktree/reset` (`worktree.reset`)
- 구현: `packages/opencode/src/worktree/index.ts`
  - `Worktree.create`
  - `Worktree.remove`
  - `Worktree.reset`

## Git Worktree Call Chain (Concrete)

### Create

1. UI: `layout.tsx:createWorkspace()` -> `globalSDK.client.worktree.create({ directory: project.worktree })`
2. Route: `server/routes/experimental.ts` `POST /experimental/worktree`
3. Service: `Worktree.create()`
4. Git ops:
   - `git worktree add --no-checkout -b <branch> <directory>`
   - async `git reset --hard` (worktree populate)
5. Event:
   - success: `worktree.ready`
   - failure: `worktree.failed`

### Remove

1. UI: `layout.tsx:deleteWorkspace()` -> `globalSDK.client.worktree.remove()`
2. Route: `DELETE /experimental/worktree`
3. Service: `Worktree.remove()`
4. Git ops:
   - `git worktree list --porcelain`
   - `git worktree remove --force <path>`
   - `git branch -D <branch>`

### Reset

1. UI: `layout.tsx:resetWorkspace()` -> `globalSDK.client.worktree.reset()`
2. Route: `POST /experimental/worktree/reset`
3. Service: `Worktree.reset()`
4. Git ops:
   - 기본 브랜치 탐색(main/master or remote HEAD)
   - `git reset --hard <target>`
   - `git clean -ffdx`
   - submodule reset/clean/update

## Reference: Conductor Workspace Sidebar (Screenshot)

![Conductor workspace sidebar](conductor-workspace-sidebar.png)

```
┌──────────────────────────────────────┐
│  History              ≡  +           │
│  All repos ▾                         │
├──────────────────────────────────────┤
│ ● Done  4                            │
│                                      │
│  Ⓜ knight-upstage/doc-understandi…  │
│     +2 -2                            │
│     monrovia · PR #262 · 🗄 Archive  │
│                                  ⌘1  │
│                                      │
│  Ⓜ feat: add extraBuildImages sup…  │
│     +410                             │
│     bangalore · PR #40 · 🗄 Archive  │
│                                  ⌘2  │
│                                      │
│  Ⓜ [cosmic-signoz] fix: formula …   │
│     +122 -2                          │
│     davis · PR #250 · 🗄 Archive     │
│                                  ⌘3  │
│                                      │
│  Ⓜ [cosmic-signoz, cosmo-oncall]…   │
│     +1734 -1                         │
│     chennai · PR #244 · 🗄 Archive   │
│                                  ⌘4  │
├──────────────────────────────────────┤
│ ● In review  0                       │
├──────────────────────────────────────┤
│ ● In progress  3                     │
│                                      │
│  Ⓜ knight-upstage/doc-understandi…  │
│     +11347                           │
│     jerusalem                    ⌘5  │
│                                      │
│  Ⓜ knight-upstage/addis-ababa-v1    │
│     +5                               │
│     addis-ababa                  ⌘6  │
│                                      │
│  Ⓒ knight-upstage/atlanta-v2        │
│     atlanta                      ⌘7  │
├──────────────────────────────────────┤
│ ○ Backlog  0                         │
├──────────────────────────────────────┤
│ ⊘ Cancelled  0                       │
└──────────────────────────────────────┘
```

### 워크스페이스 행 구조 (2-line layout)

```
┌──────────────────────────────────────┐
│ [Avatar] branch/workspace-name  +N -M│
│          agent · PR #NNN · Archive ⌘K│
└──────────────────────────────────────┘
```

- **Line 1**: 색상 아바타(원형, 알파벳 1글자) + 브랜치/워크스페이스 이름(truncate) + diff 배지(초록 `+N`, 빨강 `-M`)
- **Line 2**: 에이전트명 · PR 번호(있으면) · Archive 표시(아카이브됐으면) + 키보드 단축키 `⌘1`~`⌘9` (우측 정렬)

### 상태 그룹 헤더

- 색상 원형 아이콘 + 라벨 + 개수
- **Done**: 초록 ● + "Done" + N
- **In review**: 노랑 ● + "In review" + N
- **In progress**: 파랑 ● + "In progress" + N
- **Backlog**: 회색 ○ + "Backlog" + N
- **Cancelled**: 회색 ⊘ + "Cancelled" + N
- 개수가 0이어도 **항상 표시** (접혀있되, 라벨+카운트는 보임)

### OpenCode 매핑

| Conductor 요소        | OpenCode 대응                                                  |
| --------------------- | -------------------------------------------------------------- |
| 브랜치/워크스페이스명 | `workspaceStore.vcs.branch` 또는 session title                 |
| 에이전트명            | session에서 사용된 모델명 (예: claude-sonnet)                  |
| PR #NNN               | OpenCode에 없음 — 생략 또는 향후 확장                          |
| Archive 표시          | session archived 상태                                          |
| diff +N -M            | `session.summary.additions` / `session.summary.deletions`      |
| 색상 아바타           | 모델 provider 첫 글자 (C=Claude, G=GPT 등) 또는 브랜치 첫 글자 |
| ⌘1~⌘9 단축키          | 전체 history 순서대로 번호 부여                                |
| Backlog               | idle 세션 (busy/retry 아니고, diff도 없고, done도 아닌)        |
| Cancelled             | 향후 확장 또는 생략                                            |

## Focused UI Changes (Conductor-like)

## A) Session: progress/review/done at a glance

### Target files

- `packages/app/src/pages/layout/sidebar-items.tsx`
- `packages/app/src/pages/layout/sidebar-workspace.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`

### Changes

- `SessionItem`에 상태 pill 추가:
  - `in_progress`: `session_status`가 `busy|retry` 또는 permission/question pending
  - `in_review`: diff/summary 기반 변경 존재(리뷰 필요)
  - `done`: archived or clean + no pending actions
- 세션 제목 오른쪽에 compact metrics 추가:
  - 변경 파일 수
  - diff +/- 요약
  - 최근 업데이트 시간(상대 시간)
- 우측 패널 상단에 "Review readiness" 고정 요약(현재 reviewCount 재활용) 추가.

## B) New Workspace: creation lifecycle visibility

### Target files

- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/layout/sidebar-workspace.tsx`

### Changes

- 기존 `createWorkspace()`에서 이미 설정되는 `WorktreeState.pending`을 UI에 직접 노출:
  - pending: spinner + "preparing"
  - ready: branch badge + "ready"
  - failed: error badge + retry action
- 이벤트 처리(`worktree.ready`, `worktree.failed`) 이후 상태를 workspace row badge로 즉시 반영.
- 새 workspace 생성 직후 세션 화면으로 이동하되, 준비 완료 전에는 상단 인디케이터를 유지.

## Delivery Sequence (Small, Safe)

1. `SessionItem` 상태 모델 정리 + 상태 pill 추가.
2. workspace row에 `pending/ready/failed` badge 추가.
3. review readiness 요약을 session side panel 상단에 추가.
4. 텍스트/아이콘 polish (토큰 기반 색상만 사용).

## Acceptance Criteria (This Scope)

- 사이드바에서 각 세션이 `in_progress` / `in_review` / `done`으로 즉시 구분된다.
- 새 workspace 생성 시 최소 3상태(`pending`, `ready`, `failed`)가 사용자에게 보인다.
- worktree API 호출 체인은 기존 라우트/서비스를 그대로 사용한다.
- 기존 세션 생성/아카이브/리셋/삭제 동작은 회귀 없이 유지된다.

## Verification Checklist

- `packages/app` 기준 타입체크/테스트 통과.
- session/workspace 관련 E2E 또는 UI 회귀 시나리오 통과.
- 수동 검증:
  - 새 workspace 생성 -> pending 표시 -> ready/failed 표시
  - 세션 작업 중 상태 전환(in_progress -> in_review -> done) 확인
