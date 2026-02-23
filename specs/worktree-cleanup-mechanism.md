# Worktree 정리 메커니즘

이 문서는 OpenCode가 로컬 데이터 경로 아래에서 git worktree를 생성/정리하는 방식과, 디스크 사용량이 시간이 지나며 증가할 수 있는 이유를 설명합니다.

## 1) Worktree 저장 위치

- 기본 데이터 경로는 `packages/opencode/src/global/index.ts`의 `Global.Path.data`입니다.
  - Linux 기준 일반적으로 `~/.local/share/opencode` (`$XDG_DATA_HOME/opencode`)를 사용합니다.
- worktree 루트 디렉터리는 `Worktree.create`에서 다음 경로로 생성됩니다.
  - `path.join(Global.Path.data, "worktree", Instance.project.id)`
  - 소스: `packages/opencode/src/worktree/index.ts`

디렉터리 구조 예시는 다음과 같습니다.

```text
~/.local/share/opencode/
  worktree/
    <project-id>/
      proud-knight/
      calm-river/
      ...
```

## 2) 수명주기 개요

### Create

진입점:

- API: `packages/opencode/src/server/routes/experimental.ts`의 `POST /experimental/worktree`
- 구현: `packages/opencode/src/worktree/index.ts`의 `Worktree.create`

주요 단계:

1. 프로젝트가 git인지 확인합니다.
2. worktree 루트 디렉터리를 보장합니다(`mkdir -p`와 동일한 동작).
3. 고유한 worktree 이름과 브랜치(`opencode/<name>`)를 생성합니다.
4. `git worktree add --no-checkout -b <branch> <directory>`를 실행합니다.
5. 프로젝트 sandbox 메타데이터에 디렉터리를 등록합니다(`Project.addSandbox`).
6. checkout을 채우고(`git reset --hard`), 인스턴스를 bootstrap한 뒤 startup script를 실행합니다.

### List

- API: `GET /experimental/worktree`
- `Project.sandboxes`를 기준으로 현재 프로젝트의 sandbox 디렉터리 목록을 반환합니다.

### Reset (내용 정리, 디렉터리는 유지)

- API: `POST /experimental/worktree/reset`
- 구현: `Worktree.reset`

`reset`은 worktree 디렉터리를 **삭제하지 않습니다**. 대신 다음을 수행합니다.

- 기본 브랜치 대상 기준으로 hard reset
- 추적되지 않는/무시된 파일 정리 (`git clean -ffdx`)
- submodule 업데이트 및 정리
- 최종 clean 상태 검증

### Remove (디렉터리 + 브랜치 삭제)

- API: `DELETE /experimental/worktree`
- 구현: `Worktree.remove`

제거 흐름:

1. `git worktree list --porcelain`으로 대상 worktree를 찾습니다.
2. `git worktree remove --force <path>`를 시도합니다.
3. 파일시스템에서 디렉터리를 삭제합니다(`fs.rm(..., recursive)`), orphan 경로 fallback도 포함합니다.
4. `git branch -D <branch>`로 브랜치를 삭제합니다.
5. 라우트 레이어에서 sandbox 메타데이터를 제거합니다(`Project.removeSandbox`).

## 3) 정리 동작: 자동 vs 수동

### 수동 정리 (존재함)

- 특정 worktree를 `worktree.remove`로 삭제하면 해당 worktree의 디스크 사용량이 회수됩니다.
- uninstall 시 `--keep-data`를 주지 않으면 `Global.Path.data` 아래 전체 데이터를 삭제할 수 있습니다.
  - 소스: `packages/opencode/src/cli/cmd/uninstall.ts`

### 자동 정리 (존재하는 것)

- 디렉터리가 사라진 stale 메타데이터는 필터링됩니다.
  - `result.sandboxes = result.sandboxes.filter((x) => existsSync(x))`
  - 소스: `packages/opencode/src/project/project.ts`
- `Worktree.remove`는 detach/remove가 부분 실패해도 가능한 경우 파일시스템 경로 정리를 계속 수행하도록 방어 로직이 있습니다.
  - 테스트: `packages/opencode/test/project/worktree-remove.test.ts`

### 자동 정리 (존재하지 않는 것)

- `.../opencode/worktree/...`에 대한 시간 기반 TTL sweeper는 없습니다.
- startup/bootstrap 시 주기적으로 worktree 디렉터리를 청소하는 janitor는 등록되지 않습니다.
  - `InstanceBootstrap`은 snapshot/truncation 시스템을 초기화하지만 worktree prune은 하지 않습니다.
  - 소스: `packages/opencode/src/project/bootstrap.ts`
- 인스턴스 dispose는 메모리/런타임 상태를 정리할 뿐 worktree 디렉터리를 삭제하지 않습니다.
  - 소스: `packages/opencode/src/project/instance.ts`

## 4) `~/.local/share/opencode/worktree`는 계속 늘어나는가?

짧은 답: **네, 계속 늘어날 수 있습니다.**

이유:

- `create`가 `.../worktree/<project-id>/...` 아래에 디렉터리를 추가합니다.
- `reset`은 내용을 정리하지만 디렉터리와 브랜치를 유지합니다.
- 오래된 worktree를 자동으로 지우는 백그라운드 TTL 정리기가 없습니다.

줄어드는 경우:

- 특정 worktree를 `worktree.remove`로 삭제할 때
- uninstall로 글로벌 데이터 자체를 삭제할 때(`--keep-data` 미사용)

## 5) 운영 가이드

- 디스크 사용량이 증가하면 프로젝트 worktree 목록을 확인하고 미사용 항목을 제거하세요.
- `reset`은 "sandbox 재초기화"이고, "sandbox 삭제"가 아닙니다.
- CI나 공유 환경에서는 자동 보존 정책을 기대하지 말고, 주기적 명시 삭제 워크플로를 운영에 포함하세요.
