# Claude Code Provider 구현 계획 (Phase 1)

## 목표

Phase 1의 목표는 아래 세 가지다.

- `claude-code` 빌트인 provider 등록
- `claude-code/*` 모델 선택 시 CLI 경로 분기
- Claude CLI `stream-json` 텍스트 스트리밍을 `MessageV2` 파트로 반영

## 단계별 계획

### Phase 1 (현재)

1. 신규 파일 `packages/opencode/src/provider/claude-code.ts` 작성
2. `packages/opencode/src/provider/provider.ts`에 동적 등록 분기 추가
3. `packages/opencode/src/session/processor.ts`에 Claude Code 분기 추가
4. 변경 파일 LSP diagnostics 실행

### Phase 2 (향후)

1. tool call/결과 이벤트 해석
2. `MessageV2.ToolPart` 매핑 확장
3. tool 관련 오류/중단 처리 강화

### Phase 3 (향후)

1. 사용량/비용/종료 사유 매핑 고도화
2. SDK 경로 대비 기능 패리티 강화
3. 운영 안정화(로그/에러 분류/회귀 점검)

## 파일별 실행 상세

### 1) `packages/opencode/src/provider/claude-code.ts`

- `available()` 구현: `Bun.which("claude")` 사용
- `enabled(model)` 구현: `model.providerID === "claude-code"`
- `provider()` 구현: CLI 미설치면 `undefined`, 설치 시 합성 모델 3개 반환
- `process()` 구현:
  - 마지막 user text 추출
  - CLI args 구성
  - `Bun.spawn(..., { stdout: "pipe", stderr: "pipe", signal: abort })`
  - NDJSON 라인 파싱
  - partial 누적 텍스트를 delta로 계산하여 `Session.updatePartDelta`
  - 시작/종료 시 `step-start`, `step-finish` 기록
  - 결과로 `"continue" | "stop" | "compact"` 반환

### 2) `packages/opencode/src/provider/provider.ts`

삽입 위치:

- `state()` 내부, `CUSTOM_LOADERS` 루프 종료 직후
- 기존 `// load config` 주석 직전(약 979행 근방)

삽입 코드:

```ts
// Register claude-code built-in provider (if CLI available)
const claudeCode = await (await import("./claude-code")).ClaudeCode.provider()
if (claudeCode && isProviderAllowed("claude-code")) {
  providers["claude-code"] = claudeCode
}
```

### 3) `packages/opencode/src/session/processor.ts`

삽입 위치:

- `process()` 시작부, `log.info("process")` 직후

삽입 코드:

```ts
// Check if this model uses Claude Code CLI
const { ClaudeCode } = await import("@/provider/claude-code")
if (ClaudeCode.enabled(input.model)) {
  return ClaudeCode.process({
    sessionID: input.assistantMessage.sessionID,
    assistantMessage: input.assistantMessage,
    model: input.model,
    abort: input.abort,
    system: streamInput.system,
    messages: streamInput.messages,
    tools: streamInput.tools,
  })
}
```

## 검증 전략

- 수정 파일 전체에 대해 `lsp_diagnostics` 실행
- 변경 범위에서 타입 오류 0 확인
- 문서 3개 + 코드 3개 변경 완료 여부 점검

## 완료 기준

- 문서 3개(한글) 생성 완료
- 신규 provider 파일 추가 완료
- provider/processor 분기 추가 완료
- LSP diagnostics 에러 없음
