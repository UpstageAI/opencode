# Claude Code Provider 제약사항 및 잠재적 문제

## 1. 현재 제약사항 (Phase 3 이후)

### ~~1.1 텍스트 전용 스트리밍~~ → Phase 2에서 해소

Phase 2에서 `stream_event` 파싱 도입. tool_use(pending→running→completed), thinking(ReasoningPart) 블록 모두 OpenCode UI에 실시간 표시.

### ~~1.2 단일 턴 실행~~ → Phase 2에서 해소

`--resume <session-id>` 지원으로 CLI 세션 ID를 `sessions` Map에서 추적. 동일 OpenCode 세션 내 후속 메시지는 CLI 세션을 이어감.

### 1.3 이미지/파일 입력 미지원

모델 capabilities에 `image: true`, `pdf: true`로 선언했지만, 실제로는 `prompt()` 함수가 텍스트만 추출한다.

```typescript
if (part.type !== "text") return ""
```

사용자가 이미지를 첨부해도 CLI에 전달되지 않음.

### 1.4 retry/compaction 미지원 (의도적)

CLI가 내부적으로 컨텍스트 관리를 수행하고 `--resume`으로 세션을 유지하므로, OpenCode 측 retry/compaction은 의도적으로 미적용.

- CLI 프로세스 실패 시 재시도 없음 — 사용자가 재전송
- CLI 내부 컨텍스트 관리에 위임 (Claude Code 자체의 context window 관리)

## 2. CLI 호환성 문제

### 2.1 `--verbose` 필수 요구사항

Claude CLI v2.1.49에서는 `-p` + `--output-format stream-json` 조합 사용 시 `--verbose` 플래그가 반드시 필요하다.

```
Error: When using --print, --output-format=stream-json requires --verbose
```

이 요구사항은 CLI 버전별로 다를 수 있으며, 향후 제거되거나 변경될 수 있다.

### 2.2 `--verbose` 모드의 추가 이벤트

`--verbose`를 사용하면 기존 `assistant`/`result` 이벤트 외에 `stream_event` 타입이 추가된다:

```jsonl
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "Hello"
    }
  }
}
```

현재 코드는 `stream_event`를 무시하고 `assistant` 타입만 파싱한다. 동작에 문제는 없지만, `stream_event`의 delta가 `assistant` 이벤트보다 먼저 도착할 수 있어 스트리밍 지연이 발생할 수 있다.

### 2.3 CLI 버전 호환성

- `stream-json` 출력 형식은 Claude CLI의 비공개 인터페이스에 해당
- Anthropic이 CLI 업데이트 시 NDJSON 스키마를 변경할 수 있음
- 예: `partial` 필드 제거, content 구조 변경, 새 이벤트 타입 추가
- 방어: 알 수 없는 이벤트는 `log.warn`으로 기록 후 무시하지만, 핵심 이벤트 구조가 바뀌면 파싱 실패

### 2.4 CLI 인증 의존

Claude CLI는 자체 인증 시스템(`~/.claude/`)을 사용한다. OpenCode의 Auth 모듈과는 독립적이다.

- OpenCode에서 Anthropic API 키를 설정해도 `claude-code` 프로바이더에는 영향 없음
- CLI 인증이 만료되면 OpenCode에서는 "non-zero exit code" 에러만 표시
- 인증 상태를 사전 확인하는 로직 없음

## 3. 프로세스 관리 문제

### 3.1 시스템 프롬프트 전달 방식

```typescript
for (const item of input.system) {
  if (!item.trim()) continue
  args.push("--append-system-prompt", item)
}
```

시스템 프롬프트가 CLI 인자로 전달된다. 인자 길이 제한(`ARG_MAX`)에 걸릴 수 있다.

- macOS: `ARG_MAX` = 1,048,576 bytes (약 1MB)
- Linux: 기본 2MB
- OpenCode의 시스템 프롬프트 + 에이전트 프롬프트가 길 경우 문제 가능
- 대안: stdin을 통한 전달 또는 임시 파일 사용 (미구현)

### ~~3.2 프로세스 좀비 가능성~~ → Phase 3에서 완화

```typescript
const signal = AbortSignal.any([input.abort, AbortSignal.timeout(TIMEOUT)])
```

5분 타임아웃 추가. CLI가 멈춰도 OpenCode가 무한 대기하지 않음. 단, CLI 내부 자식 프로세스(MCP 서버 등)의 정리는 CLI에 위임.

### 3.3 동시 실행

여러 세션에서 동시에 `claude-code` 모델을 사용하면 각각 별도의 CLI 프로세스가 생성된다.

- CLI 인스턴스별로 독립된 세션 → 메모리/CPU 사용량 증가
- Claude CLI의 동시 세션 제한이 있을 수 있음 (rate limiting)
- OpenCode 측에서는 동시 실행 수 제한 로직 없음

## 4. 데이터 정합성 문제

### 4.1 비용 계산

```typescript
cost = Number(line.cost_usd ?? cost)
```

CLI의 `result` 이벤트에서 `cost_usd`를 직접 사용한다. 이 값은:

- CLI 인스턴스 전체 비용 (훅, 시스템 프롬프트 포함)이므로 OpenCode가 보여주는 비용과 다른 기준일 수 있음
- MODELS에 정의된 `cost.input`/`cost.output` 단가와 일치하지 않을 수 있음
- OpenCode UI에서 표시하는 비용이 실제 청구 금액과 차이날 수 있음

### 4.2 토큰 카운트

```typescript
function tokens(usage: Usage | undefined) {
  // ...
  reasoning: 0,
}
```

- `reasoning` 토큰은 항상 0으로 보고됨 — CLI가 thinking 토큰을 별도로 보고하지 않기 때문
- CLI의 usage는 OpenCode MODELS에 정의된 가격 모델과 다른 기준일 수 있음
- extended thinking이 활성화된 경우 실제 토큰 사용량과 보고량이 불일치

### 4.3 finish reason 매핑

```typescript
input.assistantMessage.finish = finish === "continue" ? "stop" : "error"
```

CLI의 `result.subtype`이 `success`일 때 `"stop"`으로, 아닐 때 `"error"`로 매핑한다. 기존 AI SDK 경로의 finish reason(`stop`, `tool-calls`, `length`, `unknown` 등)과 매핑이 불완전하다.

- `tool-calls` finish reason이 발생하지 않음 → 멀티스텝 루프가 동작하지 않음
- `length` (출력 토큰 초과)도 감지하지 않음
- prompt.ts의 `modelFinished` 체크에서 예상과 다른 동작 가능

## 5. OpenCode 통합 호환성

### 5.1 에이전트 시스템과의 상호작용

OpenCode의 에이전트(build, plan 등)는 각각 다른 도구 세트와 권한을 가진다. `claude-code` 모델 사용 시:

- 에이전트의 `permission` 설정이 CLI에 영향을 주지 않음
- Claude CLI 자체의 permission 시스템(`--permission-mode`)이 별도로 동작
- `plan` 에이전트(읽기 전용)로 `claude-code`를 사용해도 CLI가 파일을 수정할 수 있음

### 5.2 플러그인 시스템 (부분 해소)

Phase 3에서 적용된 훅:

- `experimental.text.complete` — ✅ 텍스트 블록 완료 시 후처리 플러그인 적용
- `chat.system.transform` — ✅ upstream(`agent.ts`)에서 이미 적용됨 (process() 진입 전)

CLI 경로에서 의미 없는 훅 (미적용):

- `chat.params` — SDK 전용 파라미터 (temperature 등), CLI에서는 `--model` 플래그로 대체
- `chat.headers` — SDK 전용 HTTP 헤더, CLI 경로에서 의미 없음

### 5.3 구조화된 출력

prompt.ts에서 `json_schema` 형식이 요청되면 `StructuredOutput` 도구가 주입되지만, CLI 경로에서는 이를 처리하지 않으므로 구조화된 출력 요청이 실패한다.

### 5.4 서브태스크/에이전트 위임

`@general` 서브에이전트 호출 등 OpenCode 내부의 에이전트 위임 시스템은 AI SDK의 tool call 메커니즘에 의존한다. CLI 경로에서는 이 메커니즘이 우회되므로 서브태스크가 동작하지 않는다.

### 5.5 컴팩션 동작

```typescript
if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
  needsCompaction = true
}
```

기존 경로에서는 매 step-finish마다 컨텍스트 오버플로우를 검사하지만, ClaudeCode 경로에서는 이 검사가 없다. 대화가 길어져도 자동 컴팩션이 트리거되지 않는다.

## 6. 보안 고려사항

### 6.1 CLI 경로 주입

`Bun.which("claude")`가 반환하는 경로는 사용자의 `PATH` 환경변수에 의존한다.

- 악의적인 `claude` 바이너리가 PATH에 먼저 있으면 실행될 수 있음
- Bun.spawn에 절대 경로 대신 바이너리 이름만 전달하므로 PATH 순서에 의존

### 6.2 시스템 프롬프트 노출

`--append-system-prompt`로 전달된 내용은 CLI의 프로세스 인자에 포함되어 `ps aux` 등으로 확인 가능하다.

- 민감한 지시사항이 시스템 프롬프트에 포함된 경우 노출 위험
- 대안: stdin이나 임시 파일을 통한 전달 필요

### 6.3 --dangerously-skip-permissions 미사용

현재는 별도의 권한 모드를 설정하지 않으므로 CLI의 기본 권한 시스템이 적용된다. 향후 자동화를 위해 이 플래그를 추가할 경우 보안 위험이 증가한다.

## 7. 성능 고려사항

### 7.1 프로세스 오버헤드

매 요청마다 새 CLI 프로세스를 spawn한다:

- CLI 초기화 (Node.js 런타임 로드, 플러그인/훅 실행) 오버헤드
- 검증 테스트에서 첫 요청은 3-4초 소요 (훅 실행 + 캐시 생성)
- SDK 직접 호출 대비 레이턴시 증가

### ~~7.2 스트리밍 지연~~ → Phase 2에서 해소

Phase 2에서 `stream_event`의 `content_block_delta`를 직접 파싱하여 저지연 스트리밍 구현. `assistant` 누적 이벤트는 usage 추적 용도로만 사용.

### 7.3 메모리

CLI 프로세스의 stdout을 버퍼에 누적(`buf`)하며 파싱한다. 매우 긴 응답의 경우 `buf` 문자열이 커질 수 있으나, 라인 단위 분할로 실질적 위험은 낮다.

## 8. 향후 개선 필요 사항

| 항목                          | 우선순위 | Phase | 상태                     |
| ----------------------------- | -------- | ----- | ------------------------ |
| tool_use 이벤트 매핑          | 높음     | 2     | ✅ 완료                  |
| 멀티턴 세션 유지 (`--resume`) | 높음     | 2     | ✅ 완료                  |
| thinking/reasoning 스트리밍   | 높음     | 2     | ✅ 완료                  |
| CLI 프로세스 타임아웃         | 중간     | 3     | ✅ 완료 (5분)            |
| 세션 삭제 시 정리             | 중간     | 3     | ✅ 완료 (Bus 구독)       |
| `experimental.text.complete`  | 중간     | 3     | ✅ 완료                  |
| 이미지/파일 입력 지원         | 중간     | -     | 미구현                   |
| 에이전트 권한 통합            | 낮음     | -     | 의도적 미적용 (CLI 위임) |
| 시스템 프롬프트 stdin 전달    | 낮음     | -     | 미구현 (ARG_MAX 충분)    |
| CLI 프로세스 풀링             | 낮음     | -     | 미구현                   |
| 자동 재시도 (retry)           | 낮음     | -     | 미구현 (CLI 내부 처리)   |
| 컨텍스트 오버플로우/컴팩션    | 낮음     | -     | 미구현 (CLI 내부 처리)   |

## 9. Phase 2/3 이후 해소된 제약사항

### 9.1 텍스트 전용 스트리밍 → 해소

Phase 2에서 `stream_event` 파싱 도입. tool_use, thinking 블록 모두 OpenCode UI에 실시간 표시.

### 9.2 단일 턴 실행 → 해소

`--resume` 지원으로 CLI 세션 ID를 추적하여 멀티턴 대화 유지.

### 9.3 스트리밍 지연 → 해소

Phase 1에서는 `assistant` 누적 이벤트만 파싱했으나, Phase 2에서 `stream_event` 델타를 직접 사용하여 지연 최소화.

### 9.4 프로세스 좀비 가능성 → 완화

5분 타임아웃 추가 (`AbortSignal.timeout(300_000)`). CLI가 멈춰도 OpenCode가 무한 대기하지 않음.

### 9.5 플러그인 시스템 → 부분 해소

`experimental.text.complete` 훅 적용. `chat.system.transform`은 upstream에서 이미 적용됨. `chat.params`/`chat.headers`는 CLI 경로에서 의미 없음 (SDK 파라미터).

### 9.6 세션 메모리 누수 → 해소

`Bus.subscribe(Session.Event.Deleted, ...)` 구독으로 세션 삭제 시 `sessions` Map 자동 정리.
