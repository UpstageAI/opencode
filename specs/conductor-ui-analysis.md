# Conductor UI Analysis (for OpenCode Web Redesign)

## Goal

`opencode web` UI를 Conductor 스타일로 재구성하기 전에, Conductor UI의 정보 구조/시각 언어/상호작용 패턴을 확인 가능한 근거 중심으로 분석한다.

## Requested Focus (Narrowed)

- 이번 범위는 전체 리디자인이 아니라 다음 2개만 포함한다.
  - 세션(Session) 진행/리뷰/완결 상태를 한눈에 보이게 하는 정보 구조
  - 새 작업 공간(New Workspace) 생성/상태 추적을 Conductor처럼 보이게 하는 흐름
- 그 외(전역 테마, docs 사이트, 기타 기능 추가)는 제외한다.

## Scope and Terminology

- 이 문서의 "Conductor"는 `conductor.build`의 Mac 앱(병렬 코딩 에이전트 오케스트레이션 UI)을 기준으로 한다.
- "OpenCode web"은 실제 사용자 인터페이스 기준으로 `packages/app`(Solid SPA) + `packages/ui`(토큰/컴포넌트 시스템)를 의미한다.
- `packages/web`은 문서 사이트(Starlight)이며, 제품 앱 셸과는 별개다.

## Evidence Sources

### Official Sources

- https://conductor.build/
- https://docs.conductor.build/
- https://docs.conductor.build/workflow
- https://docs.conductor.build/core/diff-viewer
- https://docs.conductor.build/core/parallel-agents
- https://docs.conductor.build/core/todos
- https://docs.conductor.build/core/checkpoints
- https://blog.conductor.build/checkpointing/

### Screenshot References Used

- `conductor.build` 히어로 스크린샷 (`dark-screenshot-no-bg.png`)
- Workflow/Develop 스크린샷 (`develop.png`)
- Diff Viewer 스크린샷 (`diff2.png`, `diff1.png`)
- Workspaces 목록 스크린샷 (`workspaces-list.png`)

## Confirmed vs Inferred

### Confirmed (docs/screenshots에서 직접 확인)

- 병렬 에이전트 중심 UX: "workspace per task" 모델, 단축키 기반 생성 (`cmd+n`).
- 기본 구조는 탐색 사이드바 + 중앙 작업 영역 + 우측 컨텍스트(변경/터미널/PR 등)의 다중 패널 구성.
- Diff viewer는 단순 코드 diff가 아니라 "merge-ready 상태"까지 안내하는 워크플로우 단계 UI를 제공.
- Todos가 워크스페이스 merge readiness에 직접 연결되어, "완료 전 병합 방지" 성격을 가진다.
- Checkpoint는 turn 단위 스냅샷/복원 기능을 제공하고, Git ref 기반으로 로컬 저장된다.

### Inferred (스크린샷 + 동작 문맥에서 추론)

- 색채 사용은 대부분 중립 계열(다크 기반) + 상태 색(성공/위험/경고) 중심이며, 강조색은 매우 절제되어 있다.
- "정보 밀도 높은 생산성 UI"가 목표이므로 카드형 장식보다 텍스트/배지/상태 인디케이터 중심의 계층을 쓴다.
- 마우스보다 키보드 사용을 전제로, 빠른 액션 전환(생성/전환/리뷰/병합)에 최적화된 상호작용을 선호한다.

## Conductor UI Design Characteristics

## 1) Information Architecture

- 1차 단위는 "프로젝트"가 아니라 "워크스페이스"이며, 워크스페이스는 기능 단위 브랜치/PR/작업 흐름과 결합된다.
- 좌측은 전역 탐색과 워크스페이스 트리, 중앙은 대화/작업 로그, 우측은 실행 가능한 컨텍스트 패널(파일 변경/터미널/PR)을 담당한다.
- 사용자는 한 화면에서 "지시 -> 실행 관찰 -> 변경 검토 -> 병합" 루프를 완료한다.

## 2) Layout System

- 고정형 상단 바 + 좌측 네비게이션 + 중앙 메인 + 우측 멀티패널 구조의 앱 셸.
- 가변 폭/리사이즈 가능한 생산성 패널(특히 diff/터미널/컨텍스트)이 핵심.
- 모바일 확장보다 데스크톱 집중 워크플로우를 우선하는 구성이다.

## 3) Typography

- 본문은 가독성 높은 산세리프, 코드/경로/터미널은 모노스페이스 분리.
- 제목 과장보다 밀도 높은 본문/메타 텍스트를 통한 계층 표현이 중심.
- 상태/맥락 전달은 폰트 스타일보다 레이블/배지/아이콘 조합에 의존한다.

## 4) Color and Surface Strategy

- 다크 바탕에서 패널 레벨을 표면 명도 차이로 구분.
- 의미 색상은 성공(초록), 위험(빨강), 경고(황색 계열)처럼 목적성 있는 최소 세트만 강하게 사용.
- 배경 그라데이션/얕은 보더/미세 그림자로 영역을 구분하고, 과도한 글로우는 피한다.

## 5) Component Patterns

- 워크스페이스 리스트: 상태 아이콘 + 브랜치/작업명 + diff 통계 + readiness 텍스트.
- 중앙 타임라인: turn/agent action/tool call을 순차 기록, 필요 시 접기/펼치기.
- 우측 컨텍스트: 파일 변경 목록, diff 미리보기, PR 상태, 터미널 출력이 교차.
- CTA는 "Merge", "Create PR", "Run" 같이 다음 작업을 직접 유도하는 액션형 버튼.

## 6) Motion and Feedback

- 패널 전환, 접힘/펼침, hover/selected, 상태 전환은 짧고 기능적인 모션 사용.
- 시각적 피드백은 "현재 무엇이 가능한지"를 즉시 알려주는 상태 배지/토스트/아이콘 우선.

## 7) Accessibility and Operability

- 키보드 단축키와 포커스 이동을 핵심 UX 경로로 설계.
- 상태 텍스트를 색상 외 라벨로 중복 전달해 색각 의존도를 낮춘다.
- 고밀도 UI이므로 영역별 스캔 가능성(정렬, 여백 규칙, 명확한 구분선)이 중요하다.

## What This Means for OpenCode

- 핵심은 "예쁜 테마"가 아니라 "작업 오케스트레이션 모델"이다.
- OpenCode에도 이미 사이드바/타임라인/리뷰/터미널/todo 요소가 있어, 전면 재작성보다 구조 재배치와 시각 계층 재정의가 효과적이다.
- 기존 토큰 시스템(`packages/ui/src/styles/theme.css`, `packages/ui/src/theme/*`) 위에서 Conductor형 정보 구조를 입히는 방향이 가장 리스크가 낮다.

### Narrowed Translation for This Request

- 세션 행/카드에서 최소한 다음 상태가 즉시 식별되어야 한다.
  - `in_progress`: 실행 중(busy/retry), 승인 대기(permission/question), 최근 업데이트
  - `in_review`: 변경 파일 수, diff 규모(+/-), 검증 상태
  - `done`: merge-ready/archived 신호
- 새 작업 공간 생성은 "생성됨 -> 준비중(worktree pending) -> 준비완료(worktree ready) / 실패(worktree failed)"를 노출해야 한다.
- 이 상태 전이는 기존 이벤트(`worktree.ready`, `worktree.failed`)와 세션 상태를 재사용해 구현 가능하다.

## Appendix: Relevant OpenCode Baseline Files

- `packages/app/src/pages/layout.tsx`
- `packages/app/src/pages/session.tsx`
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/session-side-panel.tsx`
- `packages/app/src/pages/session/terminal-panel.tsx`
- `packages/app/src/context/layout.tsx`
- `packages/ui/src/styles/theme.css`
- `packages/ui/src/theme/desktop-theme.schema.json`
- `packages/ui/src/theme/resolve.ts`
