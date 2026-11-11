# Catena 오케스트레이션 아키텍처 검토

> **상태: 제안.** [core_spec_v0.9.md](core_spec_v0.9.md)(이하 Core 명세)와 [runner_security_spec_v0.3.md](runner_security_spec_v0.3.md)(이하 Runner 문서)의 근거 문서다. 조사일은 2026-11-11이다.
> 이 문서는 무엇을 조사했고, 무엇을 확인했고, 무엇을 추정했으며, 그래서 무엇을 골랐는지 적는다. 규칙 자체는 Core 명세와 Runner 문서에 있다.

**상태 표기**

| 표기 | 뜻 |
|---|---|
| 확인(코드) | 아래 커밋의 소스에서 직접 읽었다 |
| 확인(문서) | 공식 문서, 공식 명세, 공식 저장소 문서, 공식 레지스트리에서 확인했다 |
| 추정 | 확인한 사실에서 추론했다. 시험하지 않았다 |
| 미확인 | 찾지 못했다 |

조사는 공식 저장소를 받아 **읽기만** 했다. 어떤 도구도 설치하거나 실행하지 않았다. 그래서 이 문서의 "확인"은 모두 문서와 코드 수준이며, 실제 동작을 시험으로 확인한 항목은 없다. 시험이 필요한 것은 10절의 Spike로 남겼다.

**읽은 소스**

| 저장소 | 커밋 | 비고 |
|---|---|---|
| gastownhall/gascity | `f143846427144cda772fa90986ffae58da0272c1` | Gas City main(2026-11-10), 최신 릴리스 v1.5.1 |
| gastownhall/gascity-packs | `7f86098c04ead8cb78706ddc9524cf4cab83b028` | 기본 pack |
| gastownhall/beads | `9d4ebf42f0496cdd0f0d7fdc6062c0981f374a70` | v1.3.4 이후 HEAD |
| gastownhall/gastown | `4b24a16e5195faa01ffc052db611a01530484854` | v1.2.1 이후 HEAD |
| herdrdev/herdr | `ee5bfb5041bb3e4a49d591c72308aae3c81ecdde` | v0.9.5 |
| langchain-ai/langgraphjs | `6dd190c558f9dc4012cdf6aaf142788ae7dbc444` | `@langchain/langgraph` 1.7.3 |
| langchain-ai/langgraph | `e5e37b5d70dbfd93c7006bd90a658c6179a95946` | Python 1.2.20 |
| google/adk-js | `3c836ebc056b9c6d7feacc20b96887e58105aa82` | `@google/adk` 2.4.0 |
| google/adk-python | `ef812bd6c40df54e35f38c4b3d2ac582e3b6e856` | 2.14.0 |
| microsoft/agent-framework | `beba9219ff2b613170fd57add02094244f4286ce` | Python core 1.25.0, .NET 1.28.0 |
| modelcontextprotocol/modelcontextprotocol | `632a0c9a65c9b4fbc889d8aface5c9cf5edef3b7` | MCP 명세 2026-07-28 |
| agentclientprotocol/agent-client-protocol | `f3ed0fca2fd6d85ef7ae77cfd074cc8605e490dc` | ACP v1 stable, v2 draft |
| agentclientprotocol/claude-agent-acp | `51f514d73c8bfd786979c84adb7a8517dbc22695` | Claude용 ACP 어댑터 v0.106.0 |
| agentclientprotocol/codex-acp | `ab7a968e982a95d8a765c1e6c6682a520d4f7638` | Codex용 ACP 어댑터 |
| google-gemini/gemini-cli | `e5d88fb2c036ce7e0c27131469cd963221b9d9e7` | ACP·A2A 관련 경로만 |
| anomalyco/opencode | `59ed43f0b8da891f03a7333d540a7b0c428049ea` | ACP 경로 |
| a2aproject/A2A | `9fff3e08ab33bb7674e7d98fc7c08ae8592bb4bd` | A2A 1.0.x |

| openai/codex | `ac54a05173d090b9fdfa181ea49b92f45aff2681` | Codex CLI HEAD(설치본 0.167.0의 태그 `rust-v0.167.0`과 비교) |
| anomalyco/opencode | `be6f5a367e1865580dfa334715baacb3081281e0` | OpenCode v2.2.7(설치본 v2.0.31 태그와 비교) |

Claude Code는 소스가 공개되지 않아 code.claude.com 문서(2026-11-11)와 설치본 2.1.322의 `--help`로 확인했다.

---

## 1. 결론 요약

1. **아키텍처는 Hybrid(C)의 얇은 형태로 정한다.** Catena가 공식 상태(WBS, Dependency DAG, TaskContract, Ready 판정, 예약과 Ticket, Run, 제출 기록, 증거, 인수, ExecutionEvent)와 Scheduler를 모두 소유한다. Agent 실행은 Runner 뒤의 기존 Coding Agent(Agent Runtime)에 맡긴다. 외부 Orchestration 엔진은 지금 쓰지 않는다.
2. **인터페이스는 CLI가 먼저이고, Orchestrator는 필요할 때만 띄운다.** CLI, Web UI, (확장의) MCP 서버는 모두 같은 Core 라이브러리의 명령 계층과 읽기 모델을 쓴다. 쓰기는 SQLite 트랜잭션으로 직렬화하므로 상주 서비스를 강제하지 않는다.
3. **결정적 근거는 하나다. Hard Invariant의 사전 차단은 프로토콜이나 프레임워크 계층에서 할 수 없고, Agent Runtime 내부의 도구 호출 전 hook과 OS 샌드박스에서만 할 수 있다.**
   - MCP 명세: 프로토콜 수준에서 보안 원칙을 강제할 수 없다고 스스로 적는다(확인(문서)).
   - ACP 명세: 권한 요청이 선택(MAY)이고 권고(advisory)다. Agent가 묻지 않고 행동할 수 있음을 남는 위험으로 적는다(확인(문서)).
   - A2A 명세: 원격 Agent의 내부 실행을 감추는 것(Opaque Execution)이 원칙이다(확인(문서)).
   - LangGraph, Google ADK, Microsoft Agent Framework: 외부 CLI가 자기 도구 루프를 돌리면 그 안의 도구 호출을 보지 못한다. MAF는 이를 문서에 적고 통제를 CLI hook에 맡긴다(확인(코드)).
   - 그래서 어느 엔진이나 프로토콜을 끼워도 Catena는 Runtime의 hook과 샌드박스 구성을 직접 쥐고 A-4로 시험해야 한다. 외부 엔진은 이 일을 줄여 주지 못하고, 상태 권위와 Scheduler만 하나 더 만든다.
4. **Gas City는 실행 계층으로 채택하지 않는다.** Task, DAG, Ready, 배정, 재시도를 모두 소유하는 경쟁 오케스트레이터이고, 기본 흐름에서 Agent가 작업을 직접 닫는다. 기본 실행은 권한 확인을 건너뛰고, scheduler를 끄는 공식 스위치를 찾지 못했다(3.3). 세션 API만 쓰는 제한 모드는 이론상 가능하므로 Spike로 남긴다(10절).
5. **재사용하는 것:** Coding Agent 자체와 그 hook·샌드박스, git worktree, SQLite, (확장) MCP 공식 SDK. 설계를 참고하는 것: Beads의 원자적 claim·JSON 계약·거절 문구, Gas City의 이벤트 작성자 구분·스크립트 완료 판정, ADK의 이벤트 기반 재개, MAF의 CLI 권한 배선.
6. **직접 만드는 것:** TaskContract·DAG·Ready·claim, Acceptance, Resource Scheduler, ExecutionEvent 저장과 fold, Runner 연결부와 A-4 시험, Task 안 Agent Graph 진행(노드 단위), CLI와 Web UI. 조사한 도구 중 이것들의 대응물을 가진 것은 없거나, 있더라도 Catena의 계약(Agent 보고 ≠ 인수, 고정된 검증 정의)과 반대로 동작한다.
7. **MVP 단계는 유지한다.** 기존 엔진을 들여와도 Engine MVP의 비용 대부분(A-4 시험, Ticket hook, 제출 기록, 증거, 인수)은 그대로 남는다(9절).

---

## 2. 판단 기준

Core 명세 제품 정의의 채택 기준을 그대로 쓴다.

1. AI 개발 과정을 더 쉽게 이해할 수 있는가? (Visibility 50%)
2. Task 중심 공정을 더 체계적으로 운영할 수 있는가? (Orchestration 25%)
3. 사용자 통제력을 개선하는가? (Control 25%)
4. 기존 기술로 해결되는 문제를 다시 구현하는 것은 아닌가?

여기에 바꿀 수 없는 조건 두 가지를 더한다.

- **Hard Invariant는 어느 가치와도 맞바꾸지 않는다.** 강제할 수 없는 실행 경로는 경고를 띄우고 허용하는 방식으로도 열지 않는다(Core 명세 0-5).
- **외부 도구의 작업·의존성 데이터는 Catena의 공식 상태를 바꾸지 못한다**(Core 명세 0-9).

---

## 3. 기술별 조사 결과

### 3.1 Beads

Agent용 issue tracker다. Dolt(버전 관리 SQL DB) 위에 의존성 그래프를 두고 `bd` CLI로 다룬다. MIT, Go, v1.3.4(2026-11-04), 활발히 개발 중이다(확인(문서)). 제품 경계를 issue·의존성·readiness·배정까지로 정하고, Agent 라우팅·모델 선택·재시도·스케줄링은 오케스트레이션 계층 몫이라고 명시한다(`beads@9d4ebf4:engdocs/PROJECT_CHARTER.md:29-41`, 확인(문서)).

| 항목 | 내용 | 상태 | 근거 |
|---|---|---|---|
| 의존 종류 | 차단형(`blocks`, `parent-child`, `conditional-blocks`, `waits-for`)과 비차단형(`discovered-from`, `related` 등). 순환은 쓰기 시점에 거부 | 확인(코드) | `internal/types/types.go:1473-1503`, `internal/storage/issueops/cycles.go:13` |
| Ready 판정 | 쓰기 때마다 갱신하는 `is_blocked` 컬럼을 읽는다 | 확인(코드) | `internal/storage/sqlbuild/ready.go` |
| Ready 정렬 | 기본 `hybrid`가 `time.Now()` 기준 48시간 창을 쓴다. 같은 데이터라도 재생 시점에 따라 순서가 달라진다 | 확인(코드) | `internal/storage/sqlbuild/ready.go:51-68` |
| `conditional-blocks` | 문서는 "A가 실패할 때만 B"라고 하지만, 계산은 `blocks`와 같다. 실패 판정 함수의 호출처가 시험 밖에 없다 | 확인(코드) | `internal/types/types.go:1787-1817` |
| 동시 claim | 한 트랜잭션 안에서 행 버전(`row_lock`)을 비교해 갱신한다. 같은 Agent의 재시도는 성공으로 처리하고, 진 쪽에는 승자와 현재 상태를 담은 오류를 준다. `bd ready --claim`은 Ready 계산과 claim을 같은 트랜잭션에서 한다 | 확인(코드) | `claim.go:263-319`, `internal/storage/embeddeddolt/ready_claimer.go:30-66` |
| 죽은 작업 회수 | claim에 lease(기본 5분)를 주고 heartbeat로 연장, `bd reclaim`이 만료분을 되돌린다 | 확인(코드) | `lease.go:21-28`, `cmd/bd/reclaim.go:22-30` |
| 쓰기 동시성 | 기본 모드는 파일 잠금으로 writer 하나. 여러 writer는 서버 모드 | 확인(문서) | `README.md:155-160` |
| daemon | 2026-03에 `bd daemon`을 완전히 없애고 순수 CLI로 바꿨다 | 확인(문서) | `CHANGELOG.md:10910,10989` |
| 완료·검증 | `bd close`가 곧 완료다. Agent의 자기 선언이며 검증 실행·인수 판정이 없다 | 확인(코드) | `internal/storage/issueops/close.go:42-73` |
| 이벤트 | 저널은 기본 꺼짐, clone 로컬, 보존 기간(7일/10만 행)이 지나면 지운다. 원본은 DB 상태다 | 확인(문서) | `docs/reference/events-journal.md:11-60` |
| JSON 계약 | `schema_version` 봉투, 필드 추가는 비파괴, 오류는 exit code로 분기하라고 명시, 거절 응답은 `{code, error, mutates}` | 확인(문서) | `docs/reference/json-schema.md:11-190` |
| 거절 문구 | claim 충돌 메시지에 해제 명령을 일부러 적지 않는다. Agent가 문구를 명령으로 읽고 남의 claim을 풀어 버린 사고 때문이다 | 확인(코드) | `claim.go:186-196` |
| MCP | `beads-mcp`는 `bd` CLI를 subprocess로 감싼 것. 공식 문서는 셸이 있으면 CLI를 권한다(토큰 비용) | 확인(코드·문서) | `integrations/beads-mcp/src/beads_mcp/bd_client.py:344` |
| 원문 보존 | `bd admin compact`가 오래된 issue를 AI 요약으로 바꾸고 원문을 버린다 | 확인(문서) | `docs/CLI_REFERENCE.md:5905-5945` |

**Catena에 대한 판단**
- **공식 상태 저장소로는 쓰지 않는다.** Agent가 `bd close`로 상태를 직접 바꾸는 것이 기본 사용법이라 0-9와 정면으로 부딪힌다. Acceptance가 없고, 이벤트가 원본이 아니며, 원문을 지운다.
- **설계를 배운다.** Ready 계산과 claim을 한 트랜잭션에, 멱등 claim과 타입 있는 거절, lease·heartbeat·회수, `schema_version` 봉투와 exit code 규칙, Agent가 읽는다는 전제의 거절 문구. Core 명세의 명령 계층(사용 형태와 실행 구조 절)과 6-1, 6-10, 6-11에 반영했다.
- **daemon을 없앤 이력**은 상주 서비스를 강제하지 않는 결정(7절)의 참고 사례다.
- 읽기 전용 가져오기 어댑터(Beads → Catena 계획 후보)는 가능하다. 단 `closed`를 Catena의 `인수됨`으로 옮기면 안 된다(추정).

### 3.2 Gas Town

Beads·tmux·Dolt 위의 다중 Agent 오케스트레이터(`gt`)다. MIT, v1.2.1(2026-06-06). 문서가 "Gas City로 승계 중"이라고 적고(`gastown@4b24a16:docs/agent-provider-integration.md:541`, 확인(문서)), 8월 이후 커밋은 의존성 갱신 위주다(추정: 유지보수 모드).

| 항목 | 내용 | 상태 |
|---|---|---|
| 역할 | Mayor, Deacon, Boot, Dogs(Town 수준), Witness, Refinery, Polecat, Crew(Rig 수준). 작업 단위는 Bead, Convoy, Molecule, Hook | 확인(문서) |
| 실행 | 대부분의 역할이 tmux 필수. Claude 기본 실행 인자가 `--dangerously-skip-permissions` | 확인(코드) |
| 상태 판단 | tmux 키 입력과 화면 읽기로 판단 | 확인(코드) |
| 이벤트 | 기록 실패를 버린다 | 확인(코드) |
| 검증 | Refinery LLM이 formula 지시문을 읽고 테스트를 돌린다. 결정적 gate 실행 코드는 시험 밖 호출처가 없다 | 확인(코드) |
| 자원 | rate limit에 걸리면 macOS keychain의 Claude 토큰을 다른 계정 것으로 바꿔 끼운다. 강제 예산 상한은 확인하지 못했다(사후 집계만) | 확인(코드), 상한은 추정 |

**판단:** 재사용하지 않는다. 기본값이 Hard Invariant와 Catena의 자격증명 규칙(Runner 문서 R-11)과 반대 방향이다. 개념만 참고한다: Agent의 정체·작업 공간·세션 3층 분리, 스케줄링 상태를 작업 항목과 따로 두는 구조, Stalled·Zombie·Stranded 같은 상태 이름.

### 3.3 Gas City (중점 검토)

**정체.** Gas Town의 구조를 범용 플랫폼으로 뽑아낸 후속작이다("Gas City is the platform that machinery was extracted into", `gc@f143846:docs/getting-started/coming-from-gastown.md:8`, 확인(문서)). 역할을 하드코딩하지 않고 pack 설정으로 옮겼다. 작업은 Beads에 저장하고 기본 저장소는 Dolt다(`README.md:48-49`). MIT, Go, v1.5.1(2026-10-24). 최근 30일 커밋 947개, API는 `/v0`이고 변경이 매우 잦다(확인(문서)).

**확인한 것**

| 영역 | 내용 | 상태 | 근거(`gc@f143846` 기준) |
|---|---|---|---|
| Task·DAG | 모든 작업 단위는 bead(`open → in_progress → closed`). `needs` 차단 엣지로 순서를 만든다. "중앙 scheduler 없이 순서가 생긴다" | 확인(코드·문서) | `internal/beads/beads.go:130`, `docs/getting-started/how-gas-city-works.md:74-80` |
| Ready | 의존 대상이 `closed`이고 `gc.work_outcome != blocked`면 충족. 대상이 닫히기만 하면 다음 단계가 Ready가 된다 | 확인(코드) | `internal/beads/beads.go:846-863,1112-1116` |
| 누가 닫나 | 기본 formula와 worker prompt에서 **Agent가 직접** `gc bd close`로 닫는다 | 확인(코드) | `internal/bootstrap/packs/core/formulas/mol-do-work.toml:99-130`, `packs@7f86098:gascity/template-fragments/gc-role-worker.template.md:53,65` |
| 검증 | v2 `[steps.check]`: step이 닫힌 뒤 스크립트가 판정("the step is done when your script says so"). check가 없는 step은 Agent가 닫는 순간 완료 | 확인(문서) | `docs/reference/specs/formula-spec-v2.md:716-728` |
| Multi-Agent | pool(같은 큐를 공유하는 Agent 묶음), drain(fan-out)과 `needs`(fan-in), review quorum, fix loop. 조건 분기는 컴파일 시점 필터 | 확인(문서) | `docs/guides/understanding-formulas.md:345-614`, `formula-spec-v2.md:302-319` |
| 지원 CLI | claude, codex, gemini, opencode, cursor, copilot 등 18종 | 확인(코드) | `internal/worker/builtin/profiles.go:247-940` |
| 세션 런타임 | tmux(기본), subprocess, exec, ACP, k8s, herdr, ssh | 확인(코드) | `internal/runtime/` |
| Claude 기본 실행 | 대화형 `claude`를 tmux에서 띄운다. **기본값 `permission_mode = "unrestricted"`(→ `--dangerously-skip-permissions`), `effort = "max"`** | 확인(코드) | `internal/worker/builtin/profiles.go:247-310` |
| 시작 대화창 | tmux 화면을 읽고 키를 보내 작업공간 신뢰, MCP 서버 신뢰(전체 수락), 권한 우회 경고, API key 확인을 자동 수락 | 확인(코드) | `internal/runtime/dialog.go:140-153` |
| 격리 | bead마다 git worktree. 문서: "a feature, not a sandbox" | 확인(문서) | `docs/reference/trust-boundaries.md:5-8` |
| 자원 | `max_active_sessions`, `max_wakes_per_tick`. rate limit을 만나면 스스로 nudge 간격을 늘리고 새 대화로 재시작. API 예산과 구독 한도를 나누는 scheduler는 찾지 못함 | 확인(문서), 예산은 미확인 | `docs/reference/config.md:111,372,375` |
| 이벤트 | `.gc/events.jsonl`, SSE `/events/stream`. **best-effort**: 잠금 시간 초과나 쓰기 실패 시 조용히 버리고 fsync하지 않는다. 이벤트 type별 작성자 구분(worker, controller, ledger) | 확인(코드) | `internal/events/events.go:789-822`, `internal/events/authorship.go:7-60` |
| 상태 권위 | controller와 bead store가 Task, 의존, Ready, 배정, 세션의 권위를 갖는다. 외부 권위를 받는 공식 모드는 찾지 못함 | 확인(문서), 권위 이전 모드는 미확인 | `docs/getting-started/how-gas-city-works.md:28-30` |
| 외부 연결 | HTTP+SSE API(OpenAPI 3.1): 세션 생성·메시지·중지·transcript·stream·`respond`. `work_query`, `sling_query`, `scale_check`는 셸 명령 템플릿이며 "external task systems" 연동용이라고 적혀 있다 | 확인(코드·문서) | `docs/reference/api.md:1-10`, `docs/reference/config.md:113,118-119` |
| 저장소 교체 | `exec:` beads provider로 바꿀 수 있지만, 기본 pack이 쓰는 `gc bd`는 bd 계열이 아닌 저장소를 거부한다 | 확인(코드) | `cmd/gc/cmd_bd.go:676-682` |
| scheduler 끄기 | 공식 스위치를 찾지 못함. reconcile, health patrol, `work_ladder`(nudge·재시작), `idle_timeout`은 항상 돈다 | 스위치는 미확인, 상시 동작은 확인(문서) | `engdocs/architecture/controller.md:10-24` |
| Ticket hook 주입 경로 | Gas City는 PreToolUse를 설치하지 않지만, city의 `.claude/settings.json`을 병합해 `--settings`로 넘긴다. Catena가 hook을 넣을 경로는 있다. 권한 우회 모드에서도 그 hook이 막는지는 Gas City 조사 범위 밖 | 경로는 확인(코드), 효력은 미확인 | `internal/hooks/hooks.go:649-673`, `internal/overlay/merge.go:86-96` |
| worker prompt | "A successful claim is authorization to execute immediately. Never ask a human whether to proceed" | 확인(코드) | `packs@7f86098:gascity/template-fragments/gc-role-worker.template.md:36-37` |

**Catena 실행 계층으로 쓸 수 있는가**

- **기본 모드: 쓸 수 없다(확인한 사실에서).** Ready와 완료가 Gas City 저장소에서 Agent 보고로 정해지고, 이것이 다음 작업을 Ready로 만든다. Catena가 승인하지 않은 일이 진행된다. 0-9와 7장(인수)에 정면으로 어긋난다.
- **통합 모드(Catena를 외부 작업 시스템으로 연결): 상태와 Scheduler가 둘로 남는다(추정).** `work_query`·`scale_check`·check 스크립트를 Catena에 연결해도 graph와 session bead, reconcile 루프는 Gas City가 소유한다. 저장소를 Catena로 바꾸면 기본 pack이 동작하지 않는다(확인(코드)).
- **세션 전용 제한 모드: 이론상 가능하다(추정).** Catena가 `POST /sessions`로 세션을 만들고 prompt·결과·증거를 모두 직접 다루면 Gas City의 Task 상태를 쓰지 않는다. 얻는 것은 tmux·ACP·k8s 세션 관리, 재개, 시작 대화창 처리, transcript stream 정도다. 지는 것은 Dolt·bd·tmux·supervisor 운영, `/v0` API의 잦은 변경, 권한 우회·대화창 자동 수락 같은 기본값을 되돌리는 일, best-effort 이벤트다. `claude -p` 자식 프로세스 방식(Core 명세 14-2)보다 얻는 것이 적다고 본다(추정).
- **권고:** 채택하지 않는다(Core 명세 14-13). 설계는 참고한다: 이벤트 작성자 구분(Catena의 `source`와 같은 방향), "Agent가 아니라 스크립트가 완료를 판정"하는 check, worktree 정리 안전장치, rate limit pacing. 다시 검토하려면 10절 SP-6을 통과해야 한다.

### 3.4 Herdr

Coding Agent용 터미널 멀티플렉서다. Apache-2.0(0.8.0에서 AGPL에서 변경), v0.9.5(2026-10-14), 1.0 이전, 사실상 1인 주도다(확인(문서)).

| 항목 | 내용 | 상태 |
|---|---|---|
| 정체 | 세션 호스트. Task·DAG·완료 검증 개념이 없다 | 확인(문서) |
| 제어 | CLI가 JSON을 돌려주고, 로컬 소켓에 줄 단위 JSON. 소켓 파일 권한은 소유자 전용(0600), 그 밖의 인증 없음 | 확인(문서·코드) |
| Agent 상태 | 화면 하단을 Agent별 정규식으로 대조해 추정. 이 규칙을 기본 설정에서 herdr.dev에서 자동으로 받아 적용 | 확인(코드·문서) |
| 이벤트 | 저장하지 않는다. 뒤처지면 `events_lost`로 끊긴다 | 확인(문서) |
| 위험 | 키 입력으로 승인 대화창을 누를 수 있다고 문서가 경고 | 확인(문서) |
| 실행 방식 | `agent start`는 대화형 Agent 전용(추정). `claude -p` 방식 Runner와 맞지 않는다 | 추정 |

**판단:** 공식 이벤트 출처나 통제 계층으로 쓰지 않는다. 사람이 대화형 세션을 보고 개입하는 선택적 Session Host 후보다(Core 명세 사용 형태와 실행 구조 절, 후속). 원격에서 받는 감지 규칙과 키 입력 기능 때문에, 쓰더라도 Runner 구성을 바꾸지 않는지 A-4로 다시 시험해야 한다(SP-9).

### 3.5 LangGraph, Google ADK, Microsoft Agent Framework

세 프레임워크를 **Task 안 Agent Graph의 실행 엔진**으로 쓸 수 있는지 봤다.

| 기준 | LangGraph (JS) | Google ADK (TS) | Microsoft Agent Framework |
|---|---|---|---|
| 정체 | 저수준 stateful graph 런타임(Pregel superstep) | Agent 프레임워크와 2.0 Workflow Runtime | Semantic Kernel·AutoGen의 후속 |
| 최신 버전 | 1.7.3 (Py 1.2.20) | 2.4.0 (Py 2.14.0). TS 2.0 GA 2026-08-21 | Py 1.25.0, .NET 1.28.0. GA 2026-04 |
| TypeScript | 1급 | GA. 단 `Workflow` 클래스는 `@experimental` | **없음** |
| Node 단독 실행 | 가능 | 가능 | 불가(Python 사이드카 필요) |
| 필수 의존 | 중간(`@langchain/core`, langsmith) | 무거움(필수 25개, GCP·OpenTelemetry) | Node와 무관 |
| 라이선스 | MIT (Agent Server 자체 호스팅은 상용) | Apache-2.0 | MIT |
| fan-out/fan-in, 분기, 반복 | `Send`, reducer, 조건부 엣지, `recursionLimit` | 라우트 배열, `JoinNode`, `ParallelWorker` | fan-out·fan-in 엣지, switch-case, `max_iterations` |
| nested graph | subgraph | Workflow 중첩 | sub-workflow |
| HITL | `interrupt()` | `RequestInput` | `request_info` |
| 상태 저장 | checkpoint(채널 스냅샷) | session event 목록(이벤트 소싱) | checkpoint(pickle 가능) |
| 재개 의미 | 노드를 처음부터 다시 실행 | at-least-once, 성공 노드 건너뜀 | superstep 경계로 복원 |
| 동시성 한도 | 실행(invoke) 한 번 안에서만 `maxConcurrency` | 그래프 노드만, worker 기본 8 | 상한 옵션 찾지 못함 |
| 외부 CLI 공식 래퍼 | 없음(커뮤니티뿐) | Python labs `AntigravityAgent`(experimental) | `ClaudeAgent`(Py, Beta), `GitHubCopilotAgent`(Py, Stable) |
| CLI 안의 도구 호출 | 못 본다 → CLI hook 필요 | 못 본다 → 하네스 policy에 위임 | 못 본다 → CLI hook에 위임(문서에 명시) |

모든 항목은 확인(코드·문서)이다. 근거: `langgraphjs@6dd190c`, `adk-js@3c836eb`, `adk-python@ef812bd`, `agent-framework@beba921`의 해당 소스와 공식 문서.

**공통으로 확인한 것**
- 세 프레임워크 모두 노드에 임의의 비동기 함수를 넣을 수 있어 `claude -p`를 띄우는 함수를 노드로 감쌀 수 있다(확인(코드)).
- 외부 CLI가 자기 도구 루프를 돌리면 프레임워크의 도구 가로채기(ADK `SecurityPlugin`, MAF function middleware, LangChain HITL)는 CLI 안의 Read/Write/Bash를 보지 못한다(확인(코드)). MAF는 이를 문서와 샘플에 적고 `can_use_tool`·`hooks`로 CLI에 위임한다.
- 세 프레임워크 모두 자체 상태 저장소와 동시성 스케줄러를 가진다(확인(코드)).

**판단(추정)**
- Catena에 들이면 Run 상태의 권위가 둘(프레임워크 checkpoint와 Catena 이벤트)이 되고, 동시성 제어가 Resource Scheduler와 겹친다. Hard Invariant 강제는 어느 쪽이든 Runner 몫으로 남는다.
- Engine MVP의 Agent Graph는 순차와 상한 있는 반복뿐이라 직접 구현이 더 단순하다. 확장 단계의 병렬·checkpoint에서 다시 비교한다(Core 명세 14-1). 비교 대상은 TS로 Node 안에서 도는 LangGraph JS 하나다(SP-7).
- ADK의 이벤트 기반 재개, MAF의 CLI 권한 배선(`can_use_tool`, hooks, 기본 거부, `max_budget_usd` 전달)은 Runner 설계에 참고한다.

### 3.6 Claude Code와 Claude Agent SDK

v0.8.3 Runner 문서 v0.2에서 이미 공식 문서로 확인한 내용(2026-11-11)은 Runner 문서 v0.3 R-7에 그대로 옮겼다. 이번 조사에서 더한 것은 아래다.

| 항목 | 내용 | 상태 | 근거 |
|---|---|---|---|
| 권한 평가 순서 | hooks → deny 규칙 → ask 규칙 → permission mode → allow 규칙 → `canUseTool`. 모든 호출에 걸리는 것은 `PreToolUse` hook이다. 자동 허용된 호출은 `canUseTool`에 오지 않는다 | 확인(문서) | https://code.claude.com/docs/en/agent-sdk/permissions |
| SDK 기반 제3자 제품의 구독 로그인 | "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." | 확인(문서) | https://code.claude.com/docs/en/agent-sdk/overview |
| ACP 어댑터 | `claude-agent-acp`는 Agent SDK를 감싸고, SDK가 `claude` 실행 파일을 띄운다. Claude Code가 ask로 판정한 호출만 ACP Client에 묻는다. 작업 디렉터리 안 읽기, 읽기 전용 Bash, allow 규칙에 맞는 호출은 묻지 않는다. 사용자 설정(`settingSources: ["user","project","local"]`)을 읽는다 | 확인(코드) | `claude-agent-acp@51f514d:src/v1/acp-agent.ts:9037,9119-9124,10179,10216` |

| 서브에이전트 | PreToolUse hook이 서브에이전트 안의 도구 호출에도 걸리고 입력에 `agent_id`가 붙는다. `SubagentStart`는 spawn을 막지 못한다. 깊이·동시 수 상한 환경 변수가 있다 | 확인(문서) | code.claude.com/docs/en/hooks, sub-agents |
| hook 실패 | `onFailure: "block"`이면 연결 실패, 2xx가 아닌 응답, 시간 초과, 잘못된 응답을 모두 차단. `onFailure`를 주지 않으면 fail-open | 확인(문서) | hooks |
| 격리 플래그 | `--bare`는 `--settings`로 넘긴 hook까지 실행하지 않는다. `-p`의 기본 동작은 CLAUDE.md, skills, 프로젝트 hook, `.mcp.json`을 신뢰 확인 없이 읽는 것 | 확인(문서) | headless |
| 샌드박스 범위 | Bash와 그 자식에만 걸린다. 파일 도구·MCP·hook은 밖에서 돈다. 기본 읽기 범위는 컴퓨터 전체. CLI의 `failIfUnavailable` 기본값은 false | 확인(문서) | sandboxing |
| 재개·effort·구조화 출력 | `--session-id`, `--resume`, `--fork-session`, `--effort`, `--json-schema`(→ `structured_output`) | 확인(문서) | cli-reference, headless, model-config |
| 사용량·한도 | result의 `total_cost_usd`(추정치), `usage`, `modelUsage`, `permission_denials`. 구독 한도 신호 `rate_limit_event`(`allowed / allowed_warning / rejected`, `resetsAt`) | 확인(문서) | agent-sdk/typescript |
| SDK와 CLI | Agent SDK는 Claude Code 바이너리를 자식 프로세스로 띄우는 라이브러리. 실행 엔진은 `claude -p`와 같다 | 확인(문서) | agent-sdk/overview |
| 구독 로그인 | "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications". 같은 절은 최종 사용자가 수정하지 않은 바이너리에 자기 구독으로 로그인하는 것은 막지 않는다고 쓴다 | 확인(문서) | legal-and-compliance |

설치본은 2.1.322이고, 모든 항목은 문서 수준이다. 시험하지 않았다.

**판단:** Claude Code CLI는 문서상 Hard Invariant 여섯 항목을 모두 사전 차단할 수단이 있다. 예외는 Bash로 worktree 안 write_scope 밖에 쓰는 경우이며, 이것은 v0.8.3처럼 결과 거부로 다룬다. 그래서 Engine MVP의 Runtime 결정(Core 명세 14-2)을 유지한다. Agent SDK는 같은 바이너리를 띄우므로 SDK를 넣어 얻는 차단 능력은 없다. ACP 어댑터는 SDK를 감싸고 ask 판정만 넘기므로 쓰지 않는다. 사용자 구독으로 Catena가 `claude`를 띄우는 구조가 정책에 맞는다는 것은 해석이며, Catena를 남에게 제공하기 전에는 API 키로 바꾸거나 Anthropic에 확인한다(Runner 문서 R-11).

### 3.7 다른 Coding Agent CLI

두 번째 Runtime 후보로 Codex CLI, OpenCode, Gemini CLI를 봤다. 판정 근거와 요건별 표는 Runner 문서 R-8에 있다. 여기에는 결정에 영향을 준 사실만 적는다.

| Runtime | 버전·라이선스 | 결정에 영향을 준 사실 | 상태 | 근거 |
|---|---|---|---|---|
| Codex CLI | 0.167.1 안정판(설치본 0.167.0), Apache-2.0 | PreToolUse hook은 있지만 hook 프로세스 실패(시간 초과, 실행 실패, 비정상 종료, 잘못된 JSON)를 통과로 처리한다 | 확인(코드) | `openai/codex@ac54a05:codex-rs/hooks/src/events/pre_tool_use.rs:211-218,285-298` |
| | | OS 샌드박스(Seatbelt, bubblewrap+seccomp)가 shell과 `apply_patch`에 모두 걸리고, permission profile(Beta)로 worktree 안 경로별 쓰기를 정할 수 있다 | 확인(코드·문서) | `codex-rs/core/src/tools/runtimes/apply_patch.rs:90-118,172-200`, `codex-rs/sandboxing/src/seatbelt.rs:472-625`, `codex-rs/protocol/src/permissions.rs:802-857`, learn.chatgpt.com/docs/sandboxing |
| | | 환경 변수 기본값이 부모 환경 전체 상속이라 API 키까지 넘어간다 | 확인(코드) | `codex-rs/protocol/src/shell_environment.rs:14-21,104-175`, `codex-rs/config/src/shell_environment_policy.rs:135-136` |
| | | `codex mcp-server`는 없어졌고 app-server가 대체한다 | 확인(문서·help) | learn.chatgpt.com/docs/mcp-server |
| | | 공식 인증 문서: "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs." | 확인(문서) | learn.chatgpt.com/docs/auth |
| OpenCode | v2.2.7(설치본 v2.0.31), MIT. 저장소는 `anomalyco/opencode`(옛 `sst/opencode`) | 서버 플러그인의 `execute.before` hook이 모든 도구 실행 앞에서 돌고 reject하면 실행하지 않는다. 단 플러그인 로드 실패는 fail-open이고 hook에 시간 제한이 없다 | 확인(코드) | `anomalyco/opencode@be6f5a3:packages/core/src/tool.ts:125-133`, `packages/plugin/src/promise/adapter.ts:686-692`, `packages/core/src/plugin/supervisor.ts:57-59` |
| | | OS 샌드박스가 없다. 문서가 권한 시스템은 보안 격리가 아니라고 밝힌다 | 확인(문서) | `services/site/src/docs/content/permissions.mdx` |
| | | v2.2.3 이후 "Claude Agent" provider가 사용자의 Claude Code를 Agent SDK로 실행한다. 제3자 도구가 이 방식으로 사용자 구독을 쓰는 것이 허용되는지는 공식 판단을 찾지 못했다 | 확인(문서·코드), 허용 여부 미확인 | `…/docs/content/claude-agent.mdx` |

| Gemini CLI | 0.70.0-nightly, Apache-2.0 | `BeforeTool` hook은 외부 명령 하나뿐이고, 시간 초과나 오류가 나면 허용으로 집계된다(fail-open). 2026-05에 후속 제품(Antigravity CLI)으로 옮긴다는 발표가 있었고 개인 구독 경로는 2026-06-18에 끝났다 | 확인(코드·문서) | `google-gemini/gemini-cli@e5d88fb:packages/core/src/hooks/hookRunner.ts:288-295`, `hookAggregator.ts:190-192`, developers.googleblog.com 공지 |

**판단:** 지금 세 Runtime 모두 R-3의 Hard Invariant 요건을 채우지 못한다. Codex와 Gemini CLI는 요건 1(질의 실패 시 차단), OpenCode는 요건 3(OS 샌드박스)이 빠진다. 그래서 Core 명세는 다른 Runtime을 확장 단계로 두고, 붙이기 전에 R-6을 통과하도록 했다(A-1). "공급자 중립"은 Core와 Runner 인터페이스의 성질이며, 아무 Runtime이나 바로 쓸 수 있다는 뜻이 아니다.

### 3.8 조사 항목 대조표

요청한 확인 항목을 기술별로 한 표에 모았다. `●` 있음(확인), `◐` 부분적·조건부, `○` 없음(확인), `?` 미확인. 칸의 짧은 말은 Catena 관점의 요점이다. 근거는 3.1~3.7절에 있다.

| 항목 | Beads | Gas Town | Gas City | Herdr | LangGraph | ADK | MAF | Claude Code |
|---|---|---|---|---|---|---|---|---|
| Task·DAG 관리 | ● issue 그래프 | ● Beads 사용 | ● bead + `needs` | ○ | ○ (Task 개념 없음) | ○ | ○ | ○ |
| 상태 추적 | ● status | ● | ● 3상태 | ◐ 화면 추정 | ◐ 그래프 실행 상태 | ◐ session | ◐ checkpoint | ◐ 세션 |
| Ready 판정 | ● `is_blocked` | ● | ● 의존 닫힘 | ○ | ○ | ○ | ○ | ○ |
| 동적 작업 생성·분할 | ● `discovered-from`, graph 생성 | ● | ● drain, formula | ○ | ◐ `Send` | ◐ 동적 노드 | ◐ | ◐ 내부 subagent |
| 완료·검증 | ◐ close = 완료(검증 없음) | ◐ LLM이 테스트 실행 | ◐ check 스크립트(선택), 기본은 Agent close | ○ | ○ | ○ | ○ | ○ |
| Agent spawn·수명 | ○ | ● tmux | ● controller | ◐ pane | ◐ 노드 | ◐ 노드 | ● agent | ◐ subagent |
| Supervisor / Manager–Worker | ○ | ● Mayor 등 | ● pack 설정 | ○ | ● 패턴 | ● | ● Magentic 등 | ◐ subagent |
| 계층 위임·Handoff | ○ (관례) | ● | ● mail, handoff | ○ | ● `Command` | ● | ● Handoff | ◐ |
| Fan-out / Fan-in | ◐ `waits-for` 게이트 | ● | ● drain + needs | ○ | ● | ● | ● | ◐ |
| 조건 분기 | ◐ (실행 중 분기 사실상 없음) | ◐ | ◐ 컴파일 시점 | ○ | ● | ● | ● | ○ |
| Evaluator–Optimizer | ○ | ● Refinery | ● review loop | ○ | ● | ● | ● | ○ |
| 반복·재시도 | ○ | ● | ● (부작용 반복 경고) | ○ | ● 노드별 | ● | ◐ | ◐ |
| 여러 AI 공급자 | 해당 없음 | ● | ● CLI 18종 | ● | ● | ◐ Gemini 중심 | ● | ○ Anthropic |
| 모델·effort 설정 | 해당 없음 | ● | ● 기본 effort max | ○ | ● | ● | ● | ● |
| 동시 실행 제약 | ○ | ◐ 기본 무제한(추정) | ● 세션 수 상한 | ○ | ◐ 실행 단위 | ◐ | ? | ○ |
| 예산·구독 한도 구분 | ○ | ○ (토큰 교체) | ○ | ○ | ○ | ○ | ◐ `max_budget_usd` 전달 | ◐ `--max-budget-usd` |
| Checkpoint·중단·재개 | ◐ 데이터만 | ◐ | ● adopt, resume | ○ | ● (노드 재실행) | ● at-least-once | ● superstep | ● 세션 재개 |
| 작업 격리 | ○ | ◐ worktree | ◐ worktree("not a sandbox") | ○ | ○ | ○ | ○ | ● OS 샌드박스 |
| 실행 이벤트·결과 수집 | ◐ 저널 기본 꺼짐 | ◐ 실패 시 버림 | ◐ best-effort | ◐ 저장 안 함 | ● stream | ● event | ● | ● stream-json |
| 도구 호출 전 차단 | ○ | ○ (권한 우회 기본) | ○ (주입 경로만) | ○ | ○ (CLI 안 못 봄) | ○ | ○ (CLI에 위임) | ● PreToolUse, fail-closed 설정 |
| 공식 CLI·API | ● `bd` | ● `gt` | ● `gc`, HTTP/SSE | ● CLI, 소켓 | ● 라이브러리 | ● 라이브러리 | ● 라이브러리 | ● CLI |
| 라이선스 | MIT | MIT | MIT | Apache-2.0 | MIT | Apache-2.0 | MIT | 상용 약관 |
| 유지보수 | 활발 | 유지보수 모드(추정) | 매우 활발, `/v0` | 1인, 1.0 이전 | 활발 | 활발 | 활발 | 활발 |
| Catena에서의 자리 | 설계 참고 | 개념 참고 | 설계 참고, 실행 계층 Spike만 | 선택적 Session Host(후속) | 확장 단계 비교 후보 | 패턴 참고 | 패턴 참고 | Engine MVP Agent Runtime |

---

## 4. 연동 프로토콜: MCP, ACP, A2A

### 4.1 사실

| 항목 | MCP | ACP (Agent Client Protocol) | A2A |
|---|---|---|---|
| 용도 | LLM 앱이 외부 도구·데이터를 쓰게 함. 도구 호출은 모델이 결정 | 에디터 같은 Client가 Coding Agent를 subprocess로 띄우고 stdio JSON-RPC로 대화 | 독립된 Agent 사이의 작업 위임 |
| 최신 버전 | 2026-07-28. `initialize`와 세션이 없어져 stateless. tasks는 공식 확장 `io.modelcontextprotocol/tasks`(Stable) | v1 stable, v2 draft(fs·terminal 대행 제거 예정) | 1.0.0(패치 1.0.1) |
| 거버넌스·라이선스 | Linux Foundation 산하 AAIF, MIT→Apache-2.0 전환 중 | Zed·JetBrains 공동, 재단 이전 중, Apache-2.0 | Linux Foundation, 9개사 TSC, Apache-2.0 |
| 강제력 | "MCP itself cannot enforce these security principles at the protocol level" | 권한 요청은 MAY이고 advisory. "an Agent can act without asking"을 남는 위험으로 명시 | Opaque Execution 원칙. 원격 Agent의 내부 도구를 보거나 막을 수 없음 |
| 지원 범위 | 주요 Coding Agent 대부분이 클라이언트(추정). tasks 확장은 coding CLI 중 Claude Code만 지원 표에 있음 | 50개 넘는 Agent. Claude·Codex는 어댑터, Gemini CLI·OpenCode는 네이티브 | 로컬 coding CLI 중에는 Gemini CLI의 실험 패키지뿐 |
| 이벤트 | Agent가 부른 호출만 보임 | `tool_call`, `tool_call_update`(diff 포함), `plan`, `usage_update`, `stopReason` 등 풍부 | Task 상태와 Artifact 수준 |
| 근거 | `modelcontextprotocol@632a0c9:docs/specification/2026-07-28/index.mdx:117`, `…/changelog.mdx`, `seps/2663-tasks-extension.md:3` | `agent-client-protocol@f3ed0fc:docs/protocol/v1/tool-calls.mdx:138`, `…/v1/security.mdx:10,12,74`, `…/v2/migration.mdx:14,57-58` | `A2A@9fff3e0:docs/specification.md:33-39`, `specification/a2a.proto:187-208` |

모두 확인(문서)이다. 지원 범위의 "대부분"만 추정이다.

**ACP 어댑터에서 확인한 것(확인(코드))**
- Claude 어댑터: 3.6절. Bash와 파일 편집은 Claude Code 프로세스 안에서 실행되고 ACP Client에는 출력만 보인다. ACP의 `fs/*`, `terminal/*` 대행을 쓰지 않는다.
- Codex 어댑터(`codex-acp@ab7a968`): Codex App Server를 띄우고 번역한다. 기본 모드는 "Auto review"로 위험해 보이는 것만 묻는다(`src/AgentMode.ts:49-105`).
- Gemini CLI: Client가 fs 대행을 받아도 작업 루트 밖 경로는 대행하지 않고 자기 파일 시스템을 쓴다(`gemini-cli@e5d88fb:packages/cli/src/acp/acpFileSystemService.ts:26-33,51-79`).
- OpenCode: 내부 `permission.asked`가 올 때만 묻는다(`opencode@59ed43f:packages/cli/src/acp/permission.ts:40-74`). 기본 권한 설정은 미확인.

IBM/BeeAI의 Agent Communication Protocol은 A2A에 합류했고 저장소는 2025-08에 보관 처리됐다(확인(문서)). 이 문서의 ACP는 Agent Client Protocol만 뜻한다.

### 4.2 Catena에서의 역할

| 기준 | CLI 직접 호출 | MCP | ACP | A2A |
|---|---|---|---|---|
| Catena 쪽 역할 | Agent가 `catena`를 부름(Agent-invoked) / Catena가 Runtime CLI를 띄움(Catena-driven) | Catena = MCP 서버(Agent-invoked) | Catena = ACP Client(Catena-driven) | Catena = A2A 서버 또는 클라이언트 |
| 공급자 종속성 | Runtime마다 붙여야 함 | 낮음 | 중간. Claude는 Agent SDK 의존과 인증 제약을 함께 가져옴 | 낮음 |
| 기존 Agent 호환성 | 모든 CLI(개별 작업) | 넓음 | 넓음 | 좁음 |
| 상태 영속성 책임 | Catena | Catena(stateless 프로토콜, 핸들 발급) | 대화는 Agent, 기록은 Catena가 따로 | 원격 서버 |
| 가시성 | Runtime 출력에 따라 다름(stream-json은 풍부) | 낮음 | 높음 | 낮음 |
| 중단·재개 | 프로세스 종료, Runtime별 재개 | 협조적 취소 | `session/cancel`, `load`, `resume` | `CancelTask`, 재구독 |
| 사전 차단 | **가능**(Runtime hook + 샌드박스를 Catena가 구성) | 불가 | 프로토콜만으로는 불가 | 불가 |
| 구현 복잡도 | Runtime 하나에는 낮음 | 낮음~중간 | 중간 | 높음 |
| Catena에서의 자리 | **Engine MVP Runner, Agent-invoked 기본 경로** | 확장: Agent-invoked 보조 경로(정보 통로) | 확장: 두 번째 Runtime부터의 후보(SP-3) | 보류: 읽기 전용 외부 창구 후보(SP-10) |

판단: MCP는 Agent가 Catena에 묻고 요청하는 통로로 쓸모가 있지만 통제 수단은 아니다. ACP는 여러 공급자의 이벤트를 한 형식으로 받는 데 쓸모가 크지만(Visibility), 사전 차단은 결국 Runtime 쪽 hook과 샌드박스에 기대야 하고, Claude 쪽은 Agent SDK를 다시 들이게 된다. A2A는 원격 Agent의 내부를 볼 수 없으므로 Catena의 허용 실행 경로가 될 수 없다.

---

## 5. 인터페이스 아키텍처 비교

평가: ◎ 매우 좋음, ○ 좋음, △ 보통·조건부, × 나쁨. 근거가 추정인 칸은 설명에 적는다.

| 기준 | 1. CLI 단독 | 2. CLI + MCP | 3. CLI + 상주 Orchestrator | 4. CLI + MCP + 선택적 Orchestrator | 5. 기존 엔진을 백엔드로 | 6. ACP·A2A 통합 |
|---|---|---|---|---|---|---|
| 공급자 종속성 | ◎ 없음 | ◎ | ◎ | ◎ | △ 엔진의 Runtime 지원에 묶임 | ○ ACP는 중립, Claude는 SDK 경유 |
| 기존 Coding Agent 호환성 | ○ 셸이 있으면 누구나 | ◎ MCP 클라이언트까지 | ○ | ◎ | ○ 엔진이 지원하는 CLI | ◎ ACP 50여 종 |
| 작업 상태 영속성 | ○ SQLite | ○ | ○ | ○ | × 상태 저장소가 둘 | △ 대화는 Agent, 기록은 Catena |
| 다중 Agent 동시 실행 | △ Run마다 전경 프로세스 | △ | ◎ | ○ 배경 모드에서 ◎ | ○ 엔진 기능 | ○ |
| 위임과 통신 | △ CLI 요청 | ○ tool로 요청 | ○ | ○ | ○ 엔진 방식(Catena 계약 밖) | ○ A2A는 원격 위임 |
| Task·Agent Graph 가시성 | ○ 같은 읽기 모델 | ○ | ○ | ○ | △ 엔진 이벤트를 정규화해야 하고 best-effort인 경우가 있음 | ◎ ACP 이벤트 풍부 |
| Resource Scheduler 연동 | ◎ Catena 하나 | ◎ | ◎ | ◎ | × Scheduler 두 개 | ○ |
| 중단·재개·복구 | △ 터미널과 수명이 같음 | △ | ◎ | ○ 감독 임대로 복구 | △ 두 시스템이 같은 장애에 반응 | ○ |
| 보안·정책 강제 | ◎ Runner를 Catena가 구성 | ◎ (MCP는 통제 수단 아님) | ◎ | ◎ | × 기본값이 반대, 주입 경로만 있음 | △ 프로토콜만으로는 불가 |
| 구현 복잡도·유지보수 | ◎ | ○ | △ daemon 수명·버전 관리 | ○ | × 외부 운영 부담과 잦은 API 변경 | △ |
| 초기 MVP 구현 가능성 | ◎ | ○ | △ | ◎ 단계별로 붙임 | × | △ |
| 향후 확장 가능성 | △ 배경 실행 없음 | △ | ○ | ◎ | △ 엔진 교체가 어려움 | ○ |

- 1과 2는 Catena-driven 실행을 터미널 수명에 묶는다. Agent-invoked만 쓰는 도구(Beads)에는 충분하지만, Catena는 실행을 감독해야 한다.
- 3은 쓰기를 프로세스 하나로 모으는 장점이 있지만, 읽기와 질의에까지 daemon을 강제한다. Beads가 2026-03에 daemon을 없앤 것이 이 유지 부담의 예다(확인(문서)). SQLite 트랜잭션이 프로세스 사이 직렬화를 이미 보장하므로 daemon이 쓰기 일관성에 꼭 필요하지 않다.
- 5와 6은 방식이 아니라 Runner 뒤의 선택지로 다룬다. 5는 3.3절 이유로 지금 쓰지 않는다. 6의 ACP는 Runner 연결 방식 후보(Core 명세 14-14), A2A는 보류다.

**선정: 4. CLI + MCP + 선택적 Orchestrator.** 다만 단계별로 붙인다: Product는 CLI 질의만, Engine은 CLI 명령과 전경 Orchestrator, Integrated는 배경 Orchestrator(`serve`), 확장은 MCP와 배정 루프. CLI, MCP, Web UI는 별도 공정관리 엔진을 갖지 않는다. 모두 같은 Core 라이브러리의 명령 계층(TaskContract, Dependency DAG, Policy, Resource, ExecutionEvent, Acceptance 규칙)을 거친다(Core 명세 0-10).

---

## 6. 자체 구현, 기존 엔진 재사용, Hybrid 비교

| 기준 | A. 자체 Orchestration Engine | B. 기존 엔진 활용(예: Gas City) | C. Hybrid (선정) |
|---|---|---|---|
| 정의 | Catena가 Agent 실행 계층(세션, 감독, Graph 진행, 재시도)을 모두 만들고 Runtime 하나에 고정 | 기존 엔진이 Task 배정과 Agent 실행을 맡고 Catena는 그 위에서 보거나 지시 | Catena가 공식 상태·판정·Scheduler·Graph 진행을 소유. Agent 실행과 세션은 교체 가능한 Runner(Adapter) 뒤의 Runtime이 맡음 |
| Catena가 소유하는 공식 상태 | 전부 | 일부. 엔진의 작업 상태와 이중화 | 전부(WBS, DAG, 계약, Ready, 예약·Ticket, Run, 제출 기록, 증거, 인수, 이벤트) |
| 기존 기술에 맡기는 것 | 거의 없음 | Task 배정, 세션, 재시도, 자원 조절 | Agent의 추론과 도구 실행(Runtime), OS 샌드박스와 도구 hook(Runtime), 버전 관리(git), 저장(SQLite) |
| 상태 충돌 | 없음 | 큼. 엔진의 Ready·완료가 Catena 승인 없이 진행(3.3) | 없음. Runtime은 공식 상태를 갖지 않고, 출력은 정규화 규칙으로만 들어온다 |
| Scheduler 중복 | 없음 | 있음(pool, reconcile, rate limit 재시작) | 없음. Runtime은 Ticket 하나만 실행 |
| 장애 책임 | Catena | 불분명. 두 시스템이 같은 장애에 반응 | Catena가 Run 상태를 소유하고 감독 임대로 정리(6-9, 6-10). Runtime 장애는 Run 실패로 기록 |
| 이벤트 정규화 | 자체 형식 | 엔진 이벤트(best-effort일 수 있음)를 공식 기록으로 쓸 위험 | Runner가 Runtime 출력을 정규화 규칙(Core 명세 ExecutionEvent 절)으로 변환. 원본은 transcript로 보존 |
| 실제 구현 복잡도 | Runtime이 하나면 C와 비슷. 여러 공급자를 붙이면 커짐 | 연동 자체는 중간, 보안 기본값을 되돌리고 상태를 맞추는 비용이 큼 | Runner 연결부 + A-4 시험이 Runtime마다 필요. 그 밖은 A와 같음 |
| 다른 엔진으로 교체 | 어려움(Runtime 고정) | 어려움(엔진 개념이 계약에 스며듦) | Runner 단위로 교체·추가. 외부 엔진도 조건을 만족하면 Runner 한 종류로 붙일 수 있음 |

**선정 이유:** C는 A가 소유하는 것을 그대로 소유하면서, Agent를 만드는 일(추론, 도구 실행, 샌드박스)은 기존 Coding Agent에 맡긴다. B가 주는 이점(세션 관리, 여러 CLI 지원)은 Runner 하나를 더 붙이는 비용과 비교해 크지 않고, 상태·Scheduler 이중화와 보안 기본값 문제를 함께 가져온다. **외부 엔진의 Task나 의존 데이터가 Catena의 공식 상태를 바꿀 길은 C에 없다.** 외부 엔진은 Runner 한 종류가 될 수 있을 뿐이며, 그때도 Catena가 허가한 단위만 실행한다(Core 명세 사용 형태와 실행 구조 절).

---

## 7. CLI와 Orchestrator의 관계

| 방식 | 내용 | 판단 |
|---|---|---|
| CLI에 모든 것 | 모든 명령이 저장소를 직접 열고, Run은 명령을 실행한 터미널에서 감독 | 동시성은 SQLite로 해결되지만, 터미널을 닫으면 Run이 끝난다 |
| 상주 Orchestrator 강제 | 모든 명령이 daemon에 요청, daemon만 저장소에 씀 | 쓰기 일관성은 쉽지만, 질의까지 daemon 수명·버전에 묶인다 |
| **선택적 Orchestrator (선정)** | 질의와 짧은 명령은 CLI가 저장소를 직접 연다. Run 감독은 Orchestrator 코드가 맡고, 전경(`run`)이나 배경(`serve`)으로 띄운다 | 상주를 강제하지 않으면서 배경 실행이 가능하다. 구조를 바꾸지 않고 Engine에서 Integrated로 넘어간다 |

**동시 실행 상황별 근거**

| 상황 | Core 명세의 규칙 | 근거 |
|---|---|---|
| 중복 claim·착수 | Task마다 열린 Run이나 유효한 claim 하나, 트랜잭션 안 유일 제약 | Beads의 ready+claim 단일 트랜잭션(확인(코드)) |
| 중복 Spawn | 감독 임대를 가진 프로세스만 Runner를 띄움(6-10) | Beads의 lease·heartbeat·reclaim(확인(코드)) |
| 예산 예약 원자성 | 예약·Ticket·Run 생성이 한 트랜잭션(6-1) | v0.8의 기존 규칙 |
| Task 상태 충돌 | `expected_version` 비교 | Beads의 `row_lock` CAS(확인(코드)), 1.4의 `expectedRevision` 계획(확인(문서)) |
| 실행 중 CLI 종료 | 정상 종료면 정리, 강제 종료면 Ticket 창구가 사라져 도구 호출이 막힘(fail-closed), 임대 만료 후 정리 | Runner 문서 R-6의 시험 15·16 |
| 배경 실행 | `serve` | — |
| 장애 후 복구 | 만료 임대를 다음 Catena 프로세스가 트랜잭션으로 넘겨받아 6-9 수행 | — |
| 단일 Writer | SQLite `BEGIN IMMEDIATE`로 쓰기 직렬화, `seq`는 트랜잭션 안에서 매김 | SQLite WAL의 다중 프로세스 동작(널리 알려진 동작, 이번에 다시 확인하지 않음) |

Engine MVP에서 다중 실행 상태를 관리하기 시작해도 전면 재설계가 필요 없도록 정한 최소 경계는 셋이다. ① 쓰기는 언제나 Core 명령과 트랜잭션을 거친다. ② Run 감독은 임대로 소유자를 하나로 정한다. ③ Ticket 검사는 감독 프로세스의 창구에서 하되 Ticket 상태는 매번 저장소에서 읽는다(A-7). 이 셋이 있으면 전경 감독을 배경 감독으로 바꾸는 것은 띄우는 방식만 바꾸는 일이다.

---

## 8. 재사용할 것과 직접 만들 것

| 기능 | 결정 | 무엇을 | 이유 |
|---|---|---|---|
| Agent의 추론과 도구 실행 | 재사용 | Claude Code CLI(Engine), 확장에서 다른 Coding Agent | Catena는 Agent가 아니다 |
| 도구 호출 전 차단, OS 샌드박스 | 재사용 | Runtime의 hook과 샌드박스. Catena는 구성과 A-4 시험을 소유 | 사전 차단이 가능한 유일한 층(1절 3) |
| 버전 관리, 작업공간 분리 | 재사용 | git, git worktree | 기존 결정(A-5) |
| 저장과 동시성 | 재사용 | SQLite(WAL, 트랜잭션) | 다중 프로세스 직렬화가 이미 있음 |
| MCP 서버 | 재사용 | MCP 공식 SDK(확장 단계에서 정함) | 프로토콜 구현을 다시 만들지 않음 |
| 여러 Runtime의 공통 연결 | 미정 | ACP Client 후보(SP-3) / Runtime별 직접 연결 | 이벤트 이점과 차단 한계를 시험으로 비교(14-14) |
| Task 안 Graph 실행 엔진 | 미정(기본은 직접) | 직접 구현 / LangGraph JS(SP-7) | 병렬·checkpoint가 필요한 확장 단계에서 결정(14-1) |
| TaskContract, Dependency DAG, Ready, claim | 직접 | Core 라이브러리 | 대응물이 없거나 계약과 반대로 동작(Beads·Gas City의 close = 완료). 설계는 Beads를 참고 |
| Acceptance(증거, 고정 검증 정의, 같은 제출 기록 인수) | 직접 | 7장 | 조사한 도구 모두에 없음 |
| Resource Scheduler(예산·구독 구분, Spawn 상한, 동시성) | 직접 | 5장 | 예산·구독을 나누는 도구를 찾지 못함 |
| ExecutionEvent 저장과 fold, 검사 규칙 | 직접(이미 시안 있음) | `tools/readmodel.ts` | Catena 계약 그 자체 |
| Runner 연결부와 출력 정규화, A-4 시험 | 직접 | Runner 문서 | Runtime마다 다른 hook·출력을 Catena 계약으로 바꾸는 층 |
| CLI와 Web UI | 직접(이미 시안 있음) | `prototype/`, `tools/fold.ts` | Visibility가 제품의 중심 |
| Session Host | 선택(후속) | tmux, Herdr 등 | Visibility는 Catena 화면이 담당 |

---

## 9. MVP 단계를 줄일 수 있는가

| 단계 | 기존 엔진으로 줄일 수 있는 것 | 판단 |
|---|---|---|
| Product | 없음. 실행 엔진이 없는 단계 | 그대로. CLI 질의(C-12)만 더함 |
| Engine | 세션·프로세스 감독을 Gas City 세션 API나 MAF `ClaudeAgent`로 대신하는 안 | 줄지 않는다. Engine MVP 비용의 대부분은 A-4 시험, Ticket hook, 제출 기록, 증거, 인수이고 이것은 Catena 몫으로 남는다. 대신 Dolt·tmux·supervisor(Gas City)나 Python 사이드카·Agent SDK(MAF)가 더해진다(추정) |
| Integrated | 없음 | 그대로. 배경 Orchestrator(`serve`)는 Engine의 코드를 배경으로 띄울 뿐 |
| 확장 | 여러 Runtime 연결(ACP), 병렬·checkpoint(LangGraph JS) | 여기서는 재사용이 비용을 줄일 수 있다. 다만 둘 다 상태 권위와 차단 한계를 시험으로 확인한 뒤 정한다(SP-3, SP-7) |

결론: 단계 구성은 바꾸지 않는다. 재사용으로 줄이는 것은 "Agent를 만드는 일"이며, 이것은 처음부터 Coding Agent를 쓰기로 해서 이미 줄어 있다. 안전성 시험(A-4)과 Catena 고유 계약의 검증은 어느 경우에도 생략하지 않는다.

---

## 10. 불확실 항목과 Spike

Spike는 결정을 바꿀 수 있는 질문만 남겼다. 모두 격리된 환경에서 버전을 고정해 실행하고, 자격증명은 사용자가 직접 로그인한 CLI나 사용자가 설정한 API 키를 쓴다. Catena 코드와 작업자는 자격증명을 읽거나 입력하지 않는다.

| ID | 질문 | 통과 기준 | 시점 | 결과가 바꾸는 결정 |
|---|---|---|---|---|
| SP-1 | 여러 Catena 프로세스가 동시에 명령을 실행해도 규칙이 지켜지는가 | 같은 Task에 착수 요청 50쌍을 동시에 보내도 Run·예약·Agent 프로세스가 하나씩만 생긴다. 감독 프로세스를 강제 종료하면 다음 도구 호출이 막히고, 임대 만료 뒤 한 프로세스만 정리한다. 이벤트 `seq`에 빈틈과 중복이 없다 | Engine(구현 시험) | 0-6, 6-10. 실패하면 상주 Orchestrator를 강제하는 방식으로 되돌린다 |
| SP-2 | 통제된 Agent가 Catena 저장소와 창구에 닿지 못하는가 | Runner 샌드박스 안에서 저장소 파일 읽기·쓰기, 창구 접속, `catena` 명령 실행이 모두 실패한다 | Engine(A-4에 포함) | 9-10, R-3 |
| SP-3 | ACP Client로 여러 Runtime을 붙일 수 있는가 | (a) 네 어댑터의 `session/update`가 ExecutionEvent로 빠짐없이 바뀐다. (b) 각 어댑터에서 worktree 밖 읽기·쓰기, 외부 접속, `.env` 읽기 시도의 부작용이 0건이다. 묻지 않고 실행된 도구가 하나라도 있으면 그 어댑터는 불합격. (c) Claude 어댑터에 설정으로 넣은 PreToolUse command hook이 모든 호출에 걸리고, 게이트가 죽으면 모두 막힌다 | 확장(두 번째 Runtime 전) | 14-14 |
| SP-4 | 두 번째 Runtime을 쓸 수 있게 만드는 구성이 있는가 | (a) Codex: hook 실패(시간 초과, 실행 파일 없음, 비정상 종료, 잘못된 JSON) 때 도구가 실행되는지 재현하고, app-server의 승인 요청·dynamic tool만 쓰는 구성이 무응답·연결 끊김에서 실행하지 않는지 본다. (b) OpenCode: shell을 끈 프로필로 실제 과제를 할 수 있는지, 또는 OpenCode 서버 전체를 OS 샌드박스로 감싼 구성이 R-3 3·6·9를 채우는지 본다. 어느 쪽이든 Runner 문서 R-6을 모두 통과해야 쓴다 | 확장 | A-1, Runner 문서 R-8 |
| SP-5 | MCP 서버가 Agent-invoked 경로로 쓸 만한가 | Claude Code, Codex, Gemini CLI, OpenCode가 같은 서버의 질의·요청 tool을 부른다. 같은 요청을 두 번 보내도 결과가 같다. Claim 없이 파일을 고치도록 유도했을 때 MCP가 막지 **못함**을 확인하고, 외부 작업 규칙(6-11)이 그 결과를 통제 밖으로 표시하는지 본다 | 확장 | C-6 |
| SP-6 | Gas City를 세션 전용 백엔드로 쓸 수 있는가 | ① pack·formula 없이 세션 API만으로 Catena prompt를 실행하고 결과를 회수한다. ② Catena가 넣은 PreToolUse hook이 Gas City의 모든 권한 모드에서 Ticket 없는 호출을 100% 막고, 창구 장애 시 막힌다. ③ 대화창 자동 수락(MCP 신뢰, 권한 우회 경고, API key 확인)을 끌 수 있다. ④ 50회 실행 중 Catena가 요청하지 않은 세션 시작·재시작·nudge가 0건이다. ⑤ supervisor를 강제 종료해도 Catena 기록만으로 ExecutionEvent가 완전하다 | 필요해질 때만(확장 이후) | 14-13 |
| SP-7 | LangGraph JS를 Task 안 Graph 엔진으로 쓸 수 있는가 | ① CLI 노드 재개 시 완료된 노드는 다시 실행하지 않고 진행 중 노드는 같은 세션으로 이어진다. ② Catena 저장소 위 checkpointer가 적합성 시험을 통과하고 기존 기록을 고치지 않는다. ③ fan-out 20개, Catena 슬롯 3개에서 동시 실행 3 이하, 교착 없음. ④ 설치 크기·패키지 수가 Catena가 먼저 정한 상한 안 | 확장(병렬 착수 전) | 14-1 |
| SP-8 | 외부 Agent가 사람 승인을 흉내 낼 수 있는가 | 외부 Agent(통제 없음)가 대화형 CLI·Web UI 승인을 시도하는 시나리오를 만들고, 막을 수 있는 것과 없는 것을 기록한다 | 6-11 착수 전 | 14-15, 9-10 |
| SP-9 | Session Host(tmux, Herdr)를 끼워도 Runner 구성이 유지되는가 | 환경 변수, 작업 디렉터리, 프로세스 그룹, 샌드박스가 직접 실행과 같다. Session Host가 Agent에 키 입력을 보낼 수 없거나, 보낸 입력이 모두 기록된다. A-4 재통과 | 후속 | 사용 형태와 실행 구조 절 |
| SP-10 | A2A 읽기 전용 창구 | A2A 클라이언트가 Catena Task 상태를 받고, Catena 상태와 A2A 상태의 대응 손실이 문서화된다 | 보류 | 없음(외부 연동) |

**확인하지 못해 결정에서 제외한 것**
- Gas City에 넣은 PreToolUse hook이 권한 우회 모드에서도 막는지(SP-6 ②).
- 각 Coding Agent가 MCP 2026-07-28(stateless)로 말하는지, 이전 방식으로 말하는지.
- OpenCode의 기본 권한 설정.
- Beads에서 서로 다른 clone이 같은 issue를 동시에 claim한 뒤 동기화할 때의 동작.
- Herdr가 원격에서 받는 감지 규칙의 무결성 검증 여부.

---

## 11. 아키텍처 결정 기록(ADR)

| ADR | 결정 | 상태 | 반영 위치 |
|---|---|---|---|
| ADR-1 | Catena는 독립 CLI 프로그램이다. 특정 공급자·SDK·터미널의 플러그인으로 만들지 않는다 | 결정 | Core 명세 제품 정의 |
| ADR-2 | Hybrid: 공식 상태와 Scheduler는 Catena, Agent 실행은 Runner 뒤 Runtime | 결정 | Core 명세 사용 형태와 실행 구조, 0-9 |
| ADR-3 | 모든 인터페이스는 Core 라이브러리의 같은 명령 계층과 읽기 모델을 쓴다 | 결정 | Core 명세 0-10, 14-12 |
| ADR-4 | 상주 서비스를 강제하지 않는다. 쓰기는 SQLite 트랜잭션으로 직렬화하고, Run 감독은 임대로 소유자를 정한다 | 결정(SP-1로 확인) | Core 명세 0-6, 6-10, 14-3 |
| ADR-5 | Agent-invoked와 Catena-driven을 함께 지원한다. Catena가 시작하지 않은 실행은 통제된 실행이 아니며 Ticket을 받지 않는다 | 결정 | Core 명세 0-11, 6-11 |
| ADR-6 | Runner는 Capability를 `시험 통과 / 문서상 지원 / 관측만 / 불가 / 미확인`으로 기록하고, Hard Invariant는 `시험 통과`만 인정한다 | 결정 | Core 명세 A-8, Runner 문서 R-5 |
| ADR-7 | Engine MVP의 Runtime은 Claude Code CLI 직접 실행. Agent SDK와 ACP 어댑터는 쓰지 않는다 | 결정(v0.8.3 유지) | Core 명세 14-2 |
| ADR-8 | 외부 Orchestration 엔진(Gas City 등)은 지금 쓰지 않는다 | 결정(SP-6로 재검토 가능) | Core 명세 14-13 |
| ADR-9 | 두 번째 Runtime의 연결 방식(직접 / ACP) | 미결정 | Core 명세 14-14 |
| ADR-10 | Task 안 Graph 실행 엔진(직접 / LangGraph JS) | 미결정(기본은 직접) | Core 명세 14-1 |
| ADR-11 | MCP 서버는 확장 단계의 얇은 층이며 승인·정책 변경 tool을 두지 않는다 | 결정 | Core 명세 C-6, 9-10 |
| ADR-12 | A2A는 보류 | 결정 | Core 명세 14-12 |
| ADR-13 | 외부 Agent가 있을 때 승인 채널을 지키는 방법 | 미결정 | Core 명세 14-15 |

---

## 12. 마지막 검토

| 질문 | 답 | 근거 위치 |
|---|---|---|
| 특정 공급자나 SDK가 Core의 필수 의존성인가? | 아니다. Core는 Runtime을 모르고 ExecutionEvent와 Ticket 검사만 본다. Claude Code는 Engine MVP의 첫 Runtime일 뿐이며 Agent SDK는 쓰지 않는다 | Core 명세 사용 형태와 실행 구조, A-1, 14-2 |
| Herdr 같은 Terminal Host에 종속되는가? | 아니다. Session Host는 후속의 선택 기능이고, 끼우면 A-4를 다시 통과해야 한다 | 사용 형태와 실행 구조, A-4 |
| CLI·MCP·UI가 같은 공식 상태를 공유하는가? | 그렇다. 같은 Core 라이브러리, 같은 저장소, 같은 명령, 같은 읽기 모델. Product MVP 인수 기준 11과 Integrated 기준 6이 일치를 시험한다 | 0-10, 13장 |
| Task와 Agent의 관리·실행 계층이 섞이는가? | 섞이지 않는다. 위임(2-3)과 Runtime 내부 subagent를 구분하고, Management·Resource·Execution의 결정을 표로 나눴다 | 사용 형태와 실행 구조의 책임 분리, 2-3 |
| 외부 Orchestrator와 Catena Scheduler가 겹치는가? | 겹치지 않는다. Scheduler는 Catena에 하나이고, 외부 실행 백엔드는 Ticket 하나만 실행한다. 지금은 외부 엔진을 쓰지 않는다 | 5장 경계, 14-13 |
| Resource Scheduler가 Dependency DAG를 바꾸는가? | 바꾸지 않는다. 배정 루프(5-4)도 순서와 자원만 정한다 | 5장 경계, 5-4 |
| Hard Invariant를 강제할 수 없는 실행 경로가 열려 있는가? | 열려 있지 않다. Catena가 시작하는 모든 실행은 A-4를 통과한 Runner를 거친다. 외부 작업(6-11)은 Catena가 시작하지 않은 작업을 결과 쪽 관문으로만 받는 길이며, 통제된 실행으로 표시하지 않고 기본으로 꺼져 있다. 경고만 띄우고 실행하는 길은 없다 | 0-5, 0-11, 9-8 |
| Product MVP가 Visibility를 먼저 검증하는가? | 그렇다. 실행 엔진 없이 화면과 CLI 질의로 Q1~Q6, Q8을 시험한다 | 13장 Product MVP |
| 새 Core나 Framework를 불필요하게 더했는가? | 더하지 않았다. 새 Core는 없다. 더한 것은 원칙 3개(0-9~0-11), feature 5개(6-10, 6-11, 9-10, A-8, C-12), 결정 2개(14-11, 14-12), 미결정 3개(14-13~14-15)다. 외부 프레임워크는 하나도 들이지 않았다 | 부록 변경 대조 |

용어, feature 번호, 내부 참조의 일관성 검사 결과는 Core 명세 부록에 있다.

---

## 13. 참고 자료

**공식 문서와 명세**
- Gas City: https://docs.gascity.com, https://github.com/gastownhall/gascity/releases, OpenAPI `docs/reference/schema/openapi.json`
- Beads: https://github.com/gastownhall/beads, https://beads.gascity.com/
- Gas Town: https://github.com/gastownhall/gastown
- Herdr: https://github.com/herdrdev/herdr
- LangGraph: https://github.com/langchain-ai/langgraphjs, https://github.com/langchain-ai/langgraph
- Google ADK: https://github.com/google/adk-js, https://github.com/google/adk-python
- Microsoft Agent Framework: https://github.com/microsoft/agent-framework
- Claude Code: https://code.claude.com/docs/en/cli-reference, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/legal-and-compliance, https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/agent-sdk/permissions
- MCP: https://modelcontextprotocol.io/specification/latest
- ACP: https://agentclientprotocol.com, https://github.com/agentclientprotocol/agent-client-protocol
- A2A: https://a2a-protocol.org/latest/specification/

**2차 출처**(정체 확인용 보조, 결정 근거로 쓰지 않음)
- Gas City 발표: https://steve-yegge.medium.com/welcome-to-gas-city-57f564bb3607(원문 직접 열람 안 함), https://yegge-ai.pages.dev/listings/welcome-to-gas-city
