# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 상태

Catena는 AI 개발 과정을 사람이 이해할 수 있는 공정(작업 단계별 상태, WBS, 의존 관계, Agent Graph)으로 보여 주는 AI 개발 공정관리 시스템이다. 지금은 **설계 단계**다. 주 산출물은 명세 문서다. 코드는 Product MVP 화면 가설을 시험하는 읽기 전용 시안뿐이고, 시뮬레이션 데이터만 다룬다. 실행 엔진은 아직 없다.

- git 저장소가 아니다. package.json, 의존성, 설치 단계가 없다.
- Node 24가 `.ts`를 직접 실행한다(타입 제거 방식). 그래서 TypeScript는 지울 수 있는 문법만 쓴다. enum, namespace, 생성자 매개변수 속성은 쓰지 않는다. 상대 import에는 `.ts` 확장자를 붙인다.
- 문서, 코드 주석, 화면 문구는 한국어로 쓴다.

## 명령

```bash
node --test tools/fold.test.ts                                   # 전체 시험
node --test --test-name-pattern="E4" tools/fold.test.ts          # 시험 하나
node tools/fold.ts scenarios/roombook [--at N]                   # 읽기 모델을 글로 출력(N = 재생 위치)
node tools/catena.ts status [--at N] [--json]                    # CLI 질의(C-12): status·ready·inbox·graph·show·agents·activity
node scenarios/roombook.build.ts                                 # 시나리오 묶음 다시 만들기
node prototype/build.ts                                          # tools/readmodel.ts → prototype/readmodel.js
python3 -m http.server 8765 --bind 127.0.0.1 --directory prototype   # 시안 보기: http://127.0.0.1:8765
```

시안은 `fetch`로 데이터를 읽으므로 `file://`로는 열리지 않는다. `.claude/launch.json`의 `prototype` 설정이 같은 서버를 띄운다. 화면에는 자동 시험이 없다.

## 구조

이벤트 기록을 접어(fold) 화면 상태를 만드는 구조다. 검사 규칙과 읽기 모델 코드는 한 곳에 있고, Node와 브라우저가 함께 쓴다.

**데이터 묶음** (`scenarios/<이름>/`)
- `dataset.json`: 묶음 선언. `dataset_id`, `origin`(`simulated`/`recorded`/`live`), `schema_version`, `default_position`(기본 재생 위치)이 있다.
- `events.jsonl`: ExecutionEvent 한 줄에 하나. `seq`는 1부터 빈틈없이 이어진다.
- `artifacts/sha256/<hex>`: 원문(transcript 발췌, diff, 검사 로그). 이벤트 payload는 원문을 `{kind: 'artifact', id: 'sha256:<hex>'}`로 참조하고, 불러올 때 해시를 다시 계산한다.
- `prototype/data`는 `../scenarios/roombook`을 가리키는 심볼릭 링크다.

**`tools/readmodel.ts`: 규칙의 유일한 출처**
- `checkStream`: 중복, 순서, 출처 선언을 확인한다(E1, E10).
- `apply`: 이벤트 하나를 모델에 반영하면서 나머지 검사 규칙을 확인한다. 위반하면 `RuleError("E<n>: …")`를 던진다.
- `foldAll(events, refCheck, at)`: 재생 위치 `at`까지 접는다.
- 화면용 질의: `card`, `waitsOf`, `edgesAt`, `relations`, `blocking`, `tasksUnder`, `path`, `conditionState`, `aggregate`, `inbox`, `taskEdges`, `rework`·`hasRework`(Q8), `agentGraph`, `nodeActivity`. 화면(`prototype/app.js`)과 CLI(`tools/catena.ts`)는 값을 이 함수로만 계산한다. 시험이 CLI JSON과 이 함수 값의 일치를 확인한다(인수 기준 11).
- 실행 환경에 의존하지 않으므로 `node:*`를 import하지 않는다. 원문 확인은 `refCheck`로 주입한다. Node 쪽 구현은 `tools/fold.ts`(fs + crypto), 브라우저 쪽 구현은 `prototype/app.js`(fetch + `crypto.subtle`)에 있다.

**`prototype/readmodel.js`는 생성 파일이다.** 직접 고치지 않는다. `tools/readmodel.ts`를 고친 뒤 `node prototype/build.ts`로 다시 만든다. 이 단계를 빠뜨리면 CLI 결과와 화면 결과가 달라진다.

**`prototype/app.js`** (프레임워크 없음)
- 불러오기 순서: 묶음 전체를 끝까지 접어 검사하고, 통과하면 기본 재생 위치로 다시 접는다. 검사에 실패하면 화면을 그리지 않는다. 네트워크 오류는 "불러오기 실패", 규칙 위반은 "검사 실패"로 나눠 표시한다.
- 화면은 해시 라우팅이다: `#overview`, `#wbs[-id]`, `#dag[-id]`, `#task-<id>`, `#agent-<id>`, `#approval-<id>`, `#phase`, `#milestone`.
- 상태 판단 로직은 넣지 않고 읽기 모델 질의 결과만 그린다.

**시나리오 생성기** (`scenarios/roombook.build.ts`)
- 결정적이다. `event_id`는 `sha256(dataset:seq)`에서 만들고, 시각은 `at()`으로 정한다. `Date.now()`나 난수를 쓰지 않는다.
- 실행하면 `scenarios/roombook/`을 지우고 새로 쓴다.

**시험과 시나리오는 맞물려 있다**
- `fold.test.ts`는 roombook의 특정 상태(예: T07 `실행 중`, T03 `decision` 대기)를 단정한다.
- 거부 시험은 묶음을 임시 폴더에 복사해 이벤트를 고친 뒤 실행한다.
- 마지막 시험은 생성기를 그 자리에서 다시 실행해 `events.jsonl` 해시가 그대로인지 본다. 생성기를 고쳤다면 먼저 생성기를 실행해 묶음을 다시 만든 뒤 시험을 돌린다.

## 명세 문서

- **최신은 `core_spec_v0.9.md`다(상태: 제안).** 이전 버전 파일은 이력으로 남겨 두고 고치지 않는다. 개정할 때는 새 버전 파일을 만들고, "vX 대비 변경" 절과 부록 변경 대조표를 둔다.
- `runner_security_spec_v0.3.md`: 공급자 중립 Runner의 공통 요건·시험(A-4)과 Engine MVP Claude Code Runner 구현 상세. 규칙 자체를 바꾸려면 core spec을 고친다.
- `orchestration_architecture_review.md`: v0.9의 기술 조사(Beads, Gas Town, Gas City, Herdr, LangGraph, ADK, MAF, Coding Agent CLI, MCP·ACP·A2A)와 아키텍처 결정 근거, Spike 목록.
- Catena는 독립 CLI이고 공식 상태와 Scheduler는 Catena만 가진다(0-9). CLI·Web UI·MCP는 같은 Core 라이브러리의 명령 계층과 읽기 모델을 쓴다(0-10). 상주 서버는 강제하지 않고, Run 감독은 감독 임대로 소유자를 정한다(0-6, 6-10).
- Engine Runner는 Agent SDK를 넣지 않는다. Orchestrator가 공식 Claude Code CLI(`claude -p`)를 자식 프로세스로 띄운다(14-2). 다른 CLI Agent는 확장 단계에서 Runner로 붙이지만, 2026-11-11 조사 기준 Codex·Gemini CLI(hook fail-open)와 OpenCode(샌드박스 없음)는 아직 요건을 못 채운다. Hard Invariant 사전 차단 시험(A-4)을 통과하지 못한 Runner에서는 실행하지 않는다(0-5).
- 코드 주석의 번호(`1-4`, `B-7`, `E6`, `9-8` 등)는 core spec의 feature 번호와 검사 규칙 번호다.
- 코드 작업과 관련 깊은 절:
  - 「사용자 경험과 화면 구조」: Drill-down 경로, 이동 수 기준
  - 「사용 형태와 실행 구조」: 구성 요소, 명령 계층, CLI 명령 예(C-12)
  - 「ExecutionEvent」: 이벤트 타입, 검사 규칙 E1~E11, v0.9 선택 필드(`node.started.profile` 등)
  - 13장 「Product MVP」: 기준 시나리오 요건, 인수 기준(11: CLI JSON과 화면 값 일치), 사용자 시험(Q1~Q6, Q8)
  - 14장: 14-10 기록 데이터 출처(미결정), 14-11 화면 구현 방식(결정: 로컬 Web UI)

## 설계 판단 기준 (명세 「제품 정의」, 0-7)

- **가치 우선순위:** Visibility 50%, Orchestration 25%, Control 25%. 이 비중은 UX와 개발 우선순위를 정하는 기준이다. 두 설계가 부딪히면 사용자가 진행 상황을 더 쉽게 이해하는 쪽을 고른다. 기술적으로 정교해진다는 이유만으로 기능이나 Core를 늘리지 않는다. 단, Hard Invariant(9-8)는 어떤 가치와도 맞바꾸지 않는다.
- **MVP 순서:** Product(기록·시뮬레이션 데이터로 화면 검증) → Engine → Integrated → 확장.
- **시간은 예측하지 않는다.** 예상 소요, 계획 일정, 계획 대비 지연은 제안하지 않는다. 진척은 시간이 아니라 인수된 완료 조건으로 표현한다.
- 명세 논의가 실행 통제·보안 쪽으로 치우쳐 작업 단계별 공정 상태가 빠진 적이 있다(v0.6, v0.7). 명세를 고칠 때는 공정표 쪽이 함께 다뤄지는지 확인한다.
- 모든 화면에 데이터 출처(`simulated`/`recorded`)를 표시하고, 시뮬레이션을 실제 실행처럼 보이게 하지 않는다.
- Engine 단계의 인증은 사용자가 직접 로그인한 CLI(본인 구독)나 사용자가 설정한 `ANTHROPIC_API_KEY`를 쓴다. Catena 코드도, 작업하는 Claude도 자격증명을 읽거나 저장하거나 입력하지 않는다. Catena를 다른 사람에게 제공하면 API 키 인증으로 바꾼다.

## 게시된 시안

시안은 비공개 Artifact로 게시돼 있다: https://claude.ai/artifact/HRCwfqrbETHVE4FrSfL4Sn
- 갱신할 때는 이 URL로 다시 게시한다.
- 페이지는 `prototype/index.html`이다. 함께 올리는 파일은 `app.js`, `readmodel.js`, `data/dataset.json`, `data/events.jsonl`, `data/artifacts/sha256/*`다.
- 확장자 없는 원문 파일은 contentType을 정확히 `"text/plain"`으로 지정해야 게시된다.
