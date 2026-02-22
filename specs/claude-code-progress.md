# Claude Code Provider 진행 현황

## 체크리스트

- [x] 설계 문서 작성: `specs/claude-code-provider-design.md`
- [x] 구현 계획 문서 작성: `specs/claude-code-implementation-plan.md`
- [x] 진행 추적 문서 작성/갱신: `specs/claude-code-progress.md`
- [x] 신규 provider 구현: `packages/opencode/src/provider/claude-code.ts`
- [x] provider 등록 분기 추가: `packages/opencode/src/provider/provider.ts`
- [x] processor 분기 추가: `packages/opencode/src/session/processor.ts`
- [x] 변경 파일 LSP diagnostics 확인

## 작업 로그

- 1단계 완료: Claude Code CLI-first 설계 문서 작성
- 2단계 완료: 파일별 실행 계획 및 검증 전략 문서 작성
- 3단계 완료: 진행 현황 문서 초기화
- 4단계 완료: `claude-code.ts` 신규 파일 구현 (369 LOC)
- 5단계 완료: `provider.ts` 동적 등록 분기 삽입 (4 LOC, 979행)
- 6단계 완료: `processor.ts` ClaudeCode 분기 삽입 (11 LOC, 47행)
- 7단계 완료: LSP diagnostics 3개 파일 모두 에러 0 확인
- 검증 참고: Markdown 파일은 LSP 서버 미구성으로 diagnostics 미지원
- 검증 참고: `bun run typecheck` 실패 (`tsgo: command not found`)
- 검증 참고: `bun run build` 실패 (`ENOENT resolving preload "@opentui/solid/preload"`)
- 8단계 완료: `--verbose` 플래그 누락 버그 수정 (CLI v2.1.49 필수 요구사항)
- 9단계 완료: `bun dev .` TUI 실행 → 모델 목록에 Claude Code 3개 정상 표시 확인
- 10단계 완료: CLI 직접 호출 검증 (`stream-json` 출력 + "Hello!" 응답 수신)
- 11단계 완료: 제약사항/잠재 문제 문서 작성 (`specs/claude-code-constraints.md`)

## Phase 2 — 도구 호출, 사고(thinking), 멀티턴 지원

### 상태: ✅ 구현 완료, LSP 검증 통과

### 변경 사항 (`claude-code.ts` 전면 리팩터링)

- [x] `stream_event` 파싱 도입 — `content_block_start/delta/stop` 기반 저지연 스트리밍
- [x] 도구 호출 라이프사이클: `content_block_start`(pending) → `content_block_stop`(running) → `user` tool_result(completed/error)
- [x] `thinking_delta` 이벤트를 `ReasoningPart`로 스트리밍
- [x] `--resume` 멀티턴 지원: `system.init`에서 CLI session_id 캡처, `sessions` Map에 저장
- [x] 시스템 프롬프트 중복 방지: resume 시 `--append-system-prompt` 생략
- [x] 중단된 도구 정리: 프로세스 종료 시 pending/running 도구를 error로 최종화
- [x] `clearSession()` export 추가
- [x] Phase 1의 `textOf()`, `Line` 타입, `prev` 변수 제거 → `Block` 타입 + `stream_event` 델타로 대체

### 검증

- [x] LSP diagnostics: `claude-code.ts` — 에러 0
- [x] LSP diagnostics: `processor.ts` — 에러 0
- [x] LSP diagnostics: `provider.ts` — 에러 0
- [ ] 수동 E2E 테스트: 도구 호출 표시, thinking/reasoning 스트리밍, 멀티턴 resume

### 다음 단계

- ~~수동 E2E 테스트 (사용자 확인 필요)~~ → CLI 레벨 검증 완료
- ~~Phase 3 진행~~ → 아래 참조

## Phase 3 — 안정성 강화 및 플러그인 통합

### 상태: ✅ 구현 완료, LSP 검증 통과

### 변경 사항 (`claude-code.ts` 추가 수정)

- [x] CLI 프로세스 타임아웃: `AbortSignal.any([input.abort, AbortSignal.timeout(300_000)])` (5분)
  - 타임아웃 발생 시 사용자 abort와 구분하여 "claude cli timed out" 에러 메시지 표시
- [x] 세션 삭제 시 자동 정리: `Bus.subscribe(Session.Event.Deleted, ...)` → `sessions` Map에서 CLI session_id 제거
  - 메모리 누수 방지
- [x] `experimental.text.complete` 플러그인 훅 적용: 텍스트 블록 완료 시 Plugin.trigger 호출
  - 기존 processor 경로와 동일한 텍스트 후처리 파이프라인 적용

### 적용하지 않은 항목 및 사유

| 항목                                 | 사유                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `experimental.chat.system.transform` | 이미 upstream(`agent.ts`)에서 적용 — `process()` 진입 전에 system 배열에 반영됨              |
| Agent 권한 통합                      | CLI 자체 permission 시스템과 의도적으로 분리 — CLI 모드에서는 CLI의 권한 관리에 위임         |
| Retry/compaction                     | CLI가 내부적으로 컨텍스트 관리 (`--resume`로 세션 유지) — OpenCode 측 compaction은 의미 없음 |
| 시스템 프롬프트 stdin 전달           | macOS ARG_MAX=1MB로 실사용에서 문제 발생 가능성 매우 낮음 — 추후 필요 시 구현                |
| CLI 프로세스 풀링                    | 현재 동시 세션 사용 빈도 낮음 — 성능 문제 발생 시 구현                                       |

### 검증

- [x] LSP diagnostics: `claude-code.ts` — 에러 0
- [x] CLI 레벨 smoke test: text streaming, tool calls, thinking, --resume 모두 동작 확인

## Phase 4 — Web UI 통합

### 상태: ✅ 구현 완료, 검증 통과

### 이슈 1: Provider 연결 다이얼로그 API 키 요구

- **증상**: Web UI에서 claude-code provider 연결 시 API 키 입력 폼이 표시됨
- **원인**: `dialog-connect-provider.tsx`에서 이미 연결된 provider에 대한 예외 처리 없음
- **수정**: `dialog-connect-provider.tsx` — 이미 `connected` 목록에 있는 provider는 API 키 입력 없이 즉시 `complete()` 호출
- **커밋**: `0967d06a5`

### 이슈 2: 모델 선택기에 claude-code 모델 미표시

- **증상**: Provider 연결 성공 후에도 모델 선택 드롭다운에 Claude Code 모델이 나타나지 않음
- **원인**: `models.tsx`의 `visible()` 함수가 `release_date` 기반 필터링 적용
  - `release_date: "2025-01-01"` → 현재 날짜(2026-02)와 14개월 차이 → 6개월 초과 → `latestSet`에 미포함 → `return false` (숨김)
  - `visible()` 로직: 사용자 설정 없고, `latestSet`에 없고, 유효한 날짜가 있으면 → 숨김 처리
- **수정**: `claude-code.ts` — 3개 모델의 `release_date`를 `""` (빈 문자열)로 변경
  - `DateTime.fromISO("")` → invalid DateTime → `date?.isValid === false` → `return true` (표시)
  - Claude Code CLI는 실제 모델 선택을 CLI에 위임하므로 release_date 개념이 불필요
- **검증**:
  - [x] LSP diagnostics: `claude-code.ts` — 에러 0
  - [x] 테스트: 11/11 통과
  - [x] API 응답 확인: `release_date: ""` 반환
  - [x] 서버 재시작 후 정상 동작 확인 (포트 4196)
