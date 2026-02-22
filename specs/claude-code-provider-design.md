# Claude Code CLI Provider 설계 (Phase 1)

## 1) 목적과 범위

본 문서는 OpenCode에 Claude Code CLI 기반 프로바이더를 통합하는 1단계 설계를 정의한다. 핵심은 기존 `LLM.stream()` 경로를 깨지 않고, 특정 모델(`claude-code/*`)에 대해서만 별도 실행 경로를 추가하는 것이다.

Phase 1 범위:

- `packages/opencode/src/provider/claude-code.ts` 신규 추가
- `packages/opencode/src/provider/provider.ts` 내 빌트인 프로바이더 등록 분기 추가
- `packages/opencode/src/session/processor.ts` 내 Claude Code 전용 분기 추가
- 텍스트 스트리밍 처리(도구 호출 실행 제어는 Phase 2)

## 2) 현재 OpenCode Provider/Processor 구조 요약

- `Provider.state()`는 models.dev, config, env, auth, custom loader를 합쳐 최종 provider map을 만든다.
- `SessionProcessor.process()`는 기본적으로 `LLM.stream(streamInput)`을 호출하고 `fullStream` 이벤트를 `MessageV2.Part`로 저장한다.
- `MessageV2`는 `text`, `reasoning`, `tool`, `step-start`, `step-finish` 등 파트 타입을 제공한다.

즉, 통합 포인트는 두 곳이다.

1. `provider.ts`: `claude-code` 모델을 목록에 노출
2. `processor.ts`: `claude-code` 모델 선택 시 LLM SDK 경로 대신 CLI 경로 사용

## 3) 왜 SDK가 아닌 CLI인가

CLI 우선 접근 이유:

- Anthropic SDK 의존성을 추가하지 않아도 된다.
- 사용자 환경에 이미 설치된 `claude` CLI를 그대로 활용한다.
- `claude -p --output-format stream-json --include-partial-messages`로 스트리밍 이벤트를 즉시 수신할 수 있다.
- 롤백이 쉽다(분기 제거 + 신규 파일 삭제만으로 복구 가능).

제약:

- CLI 출력 포맷 변경에 대한 방어 로직이 필요하다.
- partial 메시지는 누적 텍스트이므로 델타 계산을 직접 해야 한다.

## 4) 빌트인 `claude-code` 프로바이더 설계

신규 provider id: `claude-code`

등록 모델(합성 모델, models.dev 비의존):

- `claude-code/sonnet`
- `claude-code/opus`
- `claude-code/haiku`

특징:

- `provider()`는 `Bun.which("claude")`가 없으면 `undefined`를 반환한다.
- 따라서 CLI 미설치 환경에서는 provider 자체가 노출되지 않는다.
- `enabled(model)`은 `model.providerID === "claude-code"`로 단순 판정한다.

## 5) 스트림 변환 설계 (NDJSON -> MessageV2)

입력 스트림:

- `claude -p --output-format stream-json --include-partial-messages ...`의 stdout NDJSON

핵심 이벤트 매핑:

- `type: "assistant"` + `message.content[].type: "text"`
  - 최초 텍스트: `Session.updatePart(text part)`
  - partial (`partial: true`): 누적 텍스트 길이 기준 델타 계산 후 `Session.updatePartDelta`
- `type: "result"`, `subtype: "success"`
  - `Session.updatePart(step-finish)` 생성
  - `cost_usd`를 비용으로 반영, 토큰은 안전 기본값(0) + result/message usage 기반 보강

partial 델타 계산 규칙:

- partial은 매번 전체 텍스트(누적)를 내보낸다.
- 이전 누적 문자열 `prev`와 현재 문자열 `next`를 비교해 `next.slice(prev.length)`를 delta로 사용한다.
- 길이가 역행하거나 prefix가 깨지면(예: 포맷 변동) `prev`를 재기준으로 리셋하고 전체를 새 delta로 간주한다.

## 6) 프로세스 관리 설계

- 실행: `Bun.spawn(args, { stdout: "pipe", stderr: "pipe", signal: abort })`
- 종료:
  - 정상: exit code 0 + `result success`
  - 실패: exit code != 0 또는 파싱 실패 누적 시 에러 처리
- 중단:
  - `abort` 발생 시 spawn signal 연동으로 즉시 취소
- 표준 오류:
  - stderr를 수집해 실패 메시지에 포함

Phase 1에서는 최소 보장:

- 시작 시 `step-start` 파트 생성
- 종료 시 `step-finish` 파트 생성
- `assistantMessage.finish`/`time.completed`/`cost`/`tokens` 업데이트

## 7) 리스크 및 롤백 전략

리스크:

- CLI 포맷 변경으로 NDJSON 파싱 실패
- partial 누적 문자열 규칙 변경
- 환경별 CLI 실행 차이(PATH, 권한)

대응:

- JSON 파싱 실패 라인은 무시하고 로그 남김(치명적 누적 시 실패 처리)
- `result` 이벤트 미수신 시 process exit 결과로 안전 종료
- provider 자동 등록 조건을 `Bun.which("claude")`로 고정

롤백:

1. `processor.ts`의 Claude Code 분기 제거
2. `provider.ts`의 등록 분기 제거
3. `claude-code.ts` 삭제

이 롤백은 다른 provider 경로에 영향을 주지 않는다.

## 8) 3단계 로드맵 개요

- Phase 1 (현재): 텍스트 스트리밍 + provider 등록 + processor 분기
- Phase 2 (차기): tool call 이벤트 해석 및 OpenCode 파트 매핑 확장
- Phase 3 (차기): 세부 사용량/에러 호환성 및 기능 동등성(패리티) 강화
