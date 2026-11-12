# 대시보드 상호작용 설계 (초안)

- 상태: 초안. Catena 제작 공정 T29(화면 상호작용 설계)의 산출물이다. 인수되면 다음 명세 개정에 반영할 항목을 고른다.
- 기준 명세: `core_spec_v0.9.2.md`, `runner_security_spec_v0.3.md`
- 범위: 대시보드(Web UI)에서 사용자가 **무엇을 할 수 있는가**. 무엇을 보여 주는가는 명세의 「사용자 경험과 화면 구조」가 정한다.

## 1. 질문

지금 화면은 읽기 전용이다(Product MVP, C-4). 명세는 Web UI의 조작으로 **인수 승인·반려 하나**만 정해 두었다(Integrated MVP 범위). 이 문서는 다음 두 질문에 답한다.

1. 화면 객체(WBS 노드, Task, 슬롯, 완료 조건, Workflow 노드, Run, 대기 사유, 승인, Phase·Milestone)의 종류와 상태마다 어떤 조작이 맞는가.
2. 그 조작이 명세 원칙과 부딪히지 않으려면 어떤 규칙이 필요한가.

## 2. 출발점: 명세가 이미 정한 것

| 근거 | 내용 | 상호작용에 주는 제약 |
|---|---|---|
| 0-2, 0-9 | 공식 상태는 소유 Core만, Catena 명령으로만 바뀐다 | 화면은 명령을 보낼 뿐 상태를 직접 쓰지 않는다. 계산값(대표 상태, 집계, Milestone 도달)을 바꾸는 조작은 없다 |
| 0-10, 명령 계층 | 모든 인터페이스가 같은 명령 `{command, principal, channel, args, expected_version?}`을 쓴다. 실패 이유는 규칙 위반·권한 거부·버전 충돌·대상 없음 | 화면 조작마다 대응하는 CLI 명령이 있어야 한다. 화면만의 조작은 없다 |
| 0-4, 7-3 | Agent 자기 보고는 증거가 아니다. 필수 증거는 신뢰된 검증 주체가 낸다 | 사람이 자동 조건을 "통과 처리"하는 조작은 없다 |
| 0-5, 9-8 | 강제할 수 없는 것을 승인으로 대신하지 않는다. Hard Invariant에는 실행 중 예외 승인이 없다 | "이번만 허용", "경고 무시하고 진행" 조작은 없다 |
| 7-8, 9-4 | 승인은 화면에 보인 제출 기록, 승인한 버전에만 적용된다 | 승인 조작은 대상 버전을 함께 보낸다. 그사이 버전이 바뀌면 거부된다 |
| 9-10, R-10 | 승인·반려는 사람만, 대화형 채널로만(CLI TTY, Integrated부터 Web UI). 같은 OS 사용자의 외부 Agent는 채널을 흉내 낼 수 있다(14-15 미결정) | 웹 승인에는 화면에서 확인한 요청만 받는 장치가 필요하고, 남는 한계를 숨기지 않는다 |
| 대기 사유 형식 | 해소 행동 `{주체, 행동, 이동할 화면}`. 사용자 개입 목록은 주체가 `사용자`인 대기 사유다(C-10). 처리는 각 화면에서 한다 | 사용자 조작은 대부분 대기 사유의 해소 행동에서 나온다. 조작의 위치는 "이동할 화면"이다 |
| 1-1, 1-6, 10장 | 계획 작성 화면과 분할·통합·이동은 확장이다. Engine MVP는 Run이 생긴 Task를 잠근다 | 계획을 바꾸는 조작은 확장 단계의 변경안(ChangeSet) 제안으로만 들어온다 |
| 명령 예 표 | `plan import`·`run`·`cancel`·`approve`·`reject`는 Engine(CLI), Web UI 승인은 Integrated | 웹에서 착수·취소는 명세에 없다. 넣으려면 명세 개정이 필요하다(7절 Q1) |

정리하면 명세는 이미 **"조작 = 대기 사유의 해소 행동 + 몇 개의 이름 있는 명령"**이라는 모양을 가지고 있다. 이 문서는 이 모양을 객체별로 펼치고 빈 곳을 찾는다.

## 3. 설계 규칙 (제안)

**I1. 할 수 있는 조작은 읽기 모델이 계산한다.** 화면은 버튼을 그리기만 한다. `actions(model, 대상)`이 `[{명령, 라벨, 주체, 가능 여부, 불가 이유, 위험 등급}]`을 돌려주고, CLI(`catena actions <대상> --json`)와 화면이 같은 값을 쓴다(0-10, C-12와 같은 방식). 화면에 상태 판단 로직을 넣지 않는다는 지금 규칙을 조작까지 넓힌 것이다.

**I2. 못 하는 조작도 이유와 함께 보인다.** 가능하지 않은 조작은 숨기지 않고 비활성으로 두고 이유를 보인다. 예: `착수 요청 — 입력 슬롯 T02.bundles가 인수되기 전`. Visibility를 우선하는 원칙(가치 우선순위)에 맞는다. 다만 그 단계에 없는 조작(예: Product MVP의 승인)은 "이 단계에서는 CLI로" 같은 안내 한 줄로 줄인다.

**I3. 모든 조작은 화면에 보인 버전을 함께 보낸다.** `expected_version`에 그 화면이 그린 대상의 버전(제출 기록 ID, 계약 버전, Run 상태)을 넣는다. 버전 충돌이면 실행하지 않고 최신 상태로 화면을 다시 그린 뒤 다시 묻는다(9-4, 7-8).

**I4. 증거와 계산값을 사람이 대신 만들지 않는다.** 다음 조작은 두지 않는다.
- 자동 조건 "통과 처리", 검사 "건너뛰기", 상태 수동 지정(0-4, 7-3. Airflow mark success의 반례)
- Hard Invariant 예외 허용, 관리자 우회(0-5, 9-8. GitHub 보호 규칙 우회·Jenkins 관리자 응답의 반례)
- 요약 노드·Phase·Milestone의 상태 직접 변경(0-2: 계산값)
- Agent 보고를 증거로 올리기(0-4)

**I5. 사용자 조작의 입구는 사용자 개입 목록이다.** 주체가 `사용자`인 대기 사유마다 해소 행동이 곧 조작이다. 개입 목록 항목 → 해소 화면 → 조작이 한 길로 이어져야 한다(Q5 기준 경로 1회 이동을 유지). 개입 목록에 없는 조작(착수 요청, 취소)은 Task 상세에만 둔다.

**I6. 되돌릴 수 없는 조작은 한 번 더 확인한다.** 반려, 취소, 정책 변경은 확인 단계에서 대상·버전·결과를 요약해 보이고, 반려·취소에는 이유를 받는다. 이유는 다음 시도의 입력이 될 수 있으므로 기록한다. 확인 없이 되는 조작은 결과가 다시 바뀔 수 있는 것(착수 요청 철회 등)뿐이다.

**I7. 취소는 하나뿐이고, 요청과 결과를 나눠 보인다.** 정리 단계를 건너뛰는 "강제 종료"는 화면에 두지 않는다. 취소는 늘 6-9·6-10의 정리 순서(Ticket 취소, 프로세스 그룹 종료 확인, worktree 격리, 정산)를 거친다. 정리가 끝날 때까지 화면은 `취소 요청됨`을 따로 보이고, Run이 `취소`가 된 뒤에야 끝난 것으로 보인다. 요청과 결과를 섞은 화면은 사용자를 속인다(8절, Prefect·Cursor 사례).

**I10. 대기 사유가 허용 응답을 선언한다.** 대기 사유를 발행하는 Core가 해소 행동에 허용 응답(예: `decision`이면 `새 시도 / 그만두기`)과 입력 형식을 함께 싣고, 화면은 그것을 그대로 그린다. 응답은 명령 계층이 다시 검사한다. 브라우저 검사만으로 받지 않는다(8절, Airflow HITL·Prefect·Argo·LangGraph의 공통 방식).

**I11. 기한이 지나도 승인되지 않는다.** 대기에 기한을 두더라도 기한 만료의 결과는 `만료`(대기 사유가 열린 채 남음)이거나 거절이다. 기본값으로 승인하거나 진행하는 기한은 두지 않는다(0-5).

**I12. 확인 단계에 영향을 보인다.** 반려, 취소, 새 시도, 일괄 조작의 확인 단계는 "이 조작으로 무엇이 바뀌는가"(막히는 후행 Task, 무효가 되는 승인, 남는 Run)를 읽기 모델로 계산해 보인다. 문구 하나로 모든 조작을 확인하지 않는다(8절, Airflow dry run과 Argo의 반례).

**I13. 폰에서는 대기 응답과 취소 요청만 한다.** 폰 화면의 조작은 사용자 개입 항목 하나에 대한 응답(승인·반려·선택·짧은 이유)과 취소 요청으로 줄인다. 한 화면에 "무엇을, 어느 버전을, 어떤 영향으로"와 버튼 두 개를 둔다. 영향이 넓은 조작(일괄 착수, 계획 변경 제안)은 데스크톱에서만 연다(8절, GitHub Mobile·Copilot·Cursor).

**I8. 실제 실행이 아닌 데이터에는 명령을 보내지 않는다.** `simulated`·`recorded` 묶음에서는 조작이 비활성이고 "시뮬레이션 데이터에는 명령을 보내지 않는다"를 보인다(C-11). 사용자 시험에서 조작 이해도를 재려면 `모의 조작`(결과만 보여 주고 아무것도 쓰지 않음)을 따로 둔다.

**I9. 채널과 주체를 남기고, 한계를 숨기지 않는다.** 웹 조작은 `channel: web`, 주체는 사람으로 남는다. 승인 기록 옆에 채널을 보이고, R-10의 한계(같은 OS 사용자의 외부 Agent)를 승인 화면에 적는다.

## 4. 객체와 상태별 조작

표의 단계는 그 조작이 처음 생기는 단계다. "명세"는 명세에 이미 있음, "제안"은 이 문서가 새로 제안함을 뜻한다. 대응 명령 이름은 명세의 명령 예를 따른 가칭이다.

### 4-1. WBS 노드

| 노드 | 상태 | 조작 | 주체 | 대응 명령 | 단계 | 근거 |
|---|---|---|---|---|---|---|
| 요약 노드 | 모든 상태 | 하위 공정표 보기, 묶음·집계 엣지 펼치기 | 사용자 | 질의 `graph` | Product (있음) | C-1, 집계 엣지 규칙 3 |
| 요약 노드 | 모든 상태 | 상태 직접 변경 | — | 없음 | 두지 않음 | I4, 0-2 |
| 요약 노드 | 착수 가능 하위 Task 있음 | 하위 Task 일괄 착수 요청 | 사용자 | 각 Task의 `run`을 묶은 요청. 하나씩 검사하고 결과를 따로 보인다 | 확장 (제안) | 5-4 배정 루프와 겹친다. 7절 Q6 |
| 요약 노드 | 활성 | 이동·분할·통합 변경안, 책임자 배정, 중요도 | 사용자 | `propose` | 확장 (명세) | 1-1, 2-2, 5-4, 10-1 |
| Task | 계획 중(계약 없음) | 계약 작성·수정 | 사용자 | 계획 파일 + `plan import` | Engine (명세, CLI) | 1-2, 1-6. 웹 작성 화면은 확장 |
| Task | 닫힘(분할됨·통합됨·취소됨) | 뒤를 이은 노드로 가기, 기록 보기 | 사용자 | 질의 | Product (있음) | 분할·통합·이동 |

### 4-2. Task (대표 상태별)

| 대표 상태 | 조작 | 주체 | 대응 명령 | 단계 | 근거·조건 |
|---|---|---|---|---|---|
| 착수 가능 | 착수 요청 | 사용자 | `run <task>` | Engine (명세, CLI). 웹은 제안 | 1-4, 9-4. 권한 판정과 예약은 명령이 한다. 화면은 결과(허가·대기 사유)만 보인다 |
| 대기 (`dependency`) | 막고 있는 선행 Task로 가기 | 사용자 | 질의 | Product (있음) | 주체가 `시스템`이므로 사용자 조작은 없다 |
| 대기 (`resource`) | 예산 조정 요청 | 사용자 | 정책 변경 또는 예산 승인(9-3의 `예산` 종류) | 7절 Q5 | 5-1, 5-6. 자원이 회복되길 기다리는 것은 조작이 아니다 |
| 대기 / 실행 중 / 일시 중단 | 취소 | 사용자 | `cancel <run>` | Engine (명세, CLI). 웹은 제안 | I6, I7, 6-3 |
| 실행 중 | 일시 중단·재개 | 사용자 | 가칭 `pause`·`resume` | 확장 (제안) | Run 상태에 `일시 중단`은 있지만 사용자 명령은 명세에 없다. 7절 Q3. checkpoint(6-4)가 확장이다 |
| 결과 불명 | 기다림(외부 결과 확인) | 시스템 | 없음 | Engine | 6-6. 사용자 조작 없음 |
| 실패 + `decision` | 새 시도 / 그만두기 | 사용자 | `run <task>`(새 Run) / 7절 Q2 | Engine (명세, CLI). 웹은 제안 | 6-5, 6-8. 쓰기 범위 실패도 같다 |
| 검증 중 / 승인 대기(`approval`) | 승인 화면 열기 | 사용자 | 질의 | Product (있음) | C-4, C-10 |
| 인수됨 | 없음 | — | — | — | 다시 만들려면 확장 단계의 변경안(7-5) |
| 재검증 필요(`revalidation`) | 재검증 요청 | 사용자 또는 시스템 | 가칭 `revalidate` | 확장 (명세 개념) | 7-6 |

### 4-3. 슬롯과 완료 조건

| 객체 | 상태 | 조작 | 단계 | 근거 |
|---|---|---|---|---|
| 첫 Task의 입력 슬롯 | 공급 없음 | 초기 입력(원문) 등록 | Engine (계획 파일), 웹 업로드는 확장 | 1-3 `external_ref` |
| 출력 슬롯 | 인수 전 | 없음. 슬롯 인수는 승인과 증거로만 생긴다 | — | 7-5 |
| 완료 조건 (`auto`) | 미검증·검증 실패 | 증거 원문 보기. 통과 처리는 없다 | Product (있음) | I4, 7-3 |
| 완료 조건 (`auto`) | 검증 실패 | 같은 제출 기록으로 검사 다시 실행(불안정한 검사 확인용). 이전 증거도 남긴다 | 확장 (제안) | 7-3, 7-8. 결과는 새 증거이며 둘 다 보인다 |
| 완료 조건 (`human`) | 승인 대기 | 승인 화면에서 승인 범위에 넣어 승인 | Integrated (명세) | 승인의 `condition_ids` |

### 4-4. Workflow 노드 (실행 주체 × 단계)

| 노드 | 실행 중 | 끝난 뒤 | 단계 | 근거 |
|---|---|---|---|---|
| `agent` · 구현·수정 | 활동 기록 보기. 실행 중 지시 추가는 두지 않는다 | 산출물·diff·사용량 보기 | Product (있음) | 8-4: Context는 기록된 VersionRef로만 구성한다. 사람의 지시도 자료로 기록돼야 한다(7절 Q4) |
| `code` · 검증 | 로그 보기 | 증거 보기, 같은 제출 기록으로 다시 실행(4-3) | Product (있음) / 확장 | 7-3, 7-7 |
| `human` · 승인 | — | 승인·반려 | Integrated (명세) | C-4, 7-8, 9-10 |
| 반복 엣지 | 회차 보기 | 상한에 닿으면 `decision`: 새 시도 / 그만두기. 상한 늘리기는 Template 새 버전(확장) | Engine / 확장 | 3-2, 3-5, 6-5 |
| Manager 노드 | 위임 기록 보기 | 위임으로 생긴 Task 제안 검토 | 확장 | 2-3, 10-1 |

### 4-5. Run

| 상태 | 조작 | 단계 | 근거 |
|---|---|---|---|
| 대기·실행 중·일시 중단 | 취소(정리 포함) | Engine CLI, 웹은 제안 | I7, 6-9, 6-10 |
| 실패·종료·취소 | 기록 보기. 재시도는 Task의 새 Run | Engine | 6-9 |
| 감독 상실 | 정리 결과 보기 | Engine | 6-9 |

### 4-6. 대기 사유 (유형별 해소 조작)

| 유형 | 해소 주체 | 화면 조작 | 단계 |
|---|---|---|---|
| `dependency` | 시스템 | 선행 Task로 가기만 | Product (있음) |
| `approval` | 사용자 | 승인·반려(4-7) | Integrated (명세) |
| `decision` | 사용자 | 새 시도 / 그만두기 / (확장) 계획 변경 제안 | Engine CLI, 웹은 제안 |
| `resource` | 시스템 또는 사용자 | 예산 조정 | 7절 Q5 |
| `revalidation` | 시스템 또는 사용자 | 재검증 요청 | 확장 |
| `migration` | 시스템 | 없음 | 확장 |
| `external` | 외부 | 없음(외부 응답 대기) | Engine |

### 4-7. 승인

| 조건 | 조작 | 검사 |
|---|---|---|
| 열린 승인, 대상 제출 기록이 화면에 보인 것과 같음 | 승인(조건 범위 선택), 반려(이유 필수) | 승인자는 사람, 채널은 대화형(9-10), 대상 VersionRef 일치·유효 기간(9-4), 증거·승인·산출물이 같은 제출 기록(7-8) |
| 대상이 바뀜(수정 반복으로 새 제출 기록) | 없음. 새 제출 기록의 승인 화면으로 안내 | 7-8: 이전 승인은 새 제출 기록에 쓰지 않는다 |
| 이미 결정됨 | 결정 기록 보기 | E8 |

### 4-8. Phase·Milestone·Project

| 객체 | 조작 | 단계 |
|---|---|---|
| Phase·Milestone 묶음 | 하위로 내려가기만. 정의 변경은 계획 변경 | Product (있음) / 확장 |
| Project 정책 | 정책 변경은 사람만, 대화형 채널로만(9-5). 웹에서 여는 것은 7절 Q5 | Engine CLI |

## 5. 단계별 요약

| 단계 | 웹에서 할 수 있는 조작 |
|---|---|
| Product (지금) | 보기와 이동만. 제안: `actions` 질의를 먼저 만들어 비활성 버튼과 이유를 보이고, 사용자 시험에서 `모의 조작`으로 이해도를 잰다(I1, I2, I8) |
| Engine | 웹 조작 없음. CLI로 `plan import`·`run`·`cancel`·`approve`·`reject` |
| Integrated | 명세: 승인·반려. 제안: `decision` 해소(새 시도·그만두기)와 취소를 함께 넣는다(7절 Q1) |
| 확장 | 변경안 제안(분할·통합·이동·계약), 일괄 착수, 재검증, 검사 다시 실행, 일시 중단·재개, 예산 조정 |

## 6. Catena 제작 공정에 지금 적용할 수 있는 것

제작 공정(`?data=catena`)은 계획 파일과 사람 인수 기록뿐이라 Run·제출 기록·증거 이벤트가 없다(0-11). 여기서 해 볼 수 있는 조작은 **인수 요청과 그 결정** 하나다.

- Agent가 Task를 끝내면 조건별 증거를 인수 요청 파일에 올린다. 화면은 이를 `approval` 대기 사유처럼 보여 주고, 사용자 개입 목록에 띄운다.
- 사용자가 화면에서 인수·반려(이유)를 고르면, 개발 서버의 쓰기 창구가 `tools/planfold.ts`의 같은 검사를 거쳐 `plan/accepted.json`에 적는다. 반려 이유는 다음 세션의 Agent가 읽는다.
- 이것은 Integrated의 화면 승인(T31)을 계획 파일로 먼저 시험해 보는 것이다. 명령 계층(T14)이 생기면 그것으로 바꾼다.
- 한계: 같은 맥의 프로세스(작업하는 Agent 포함)는 쓰기 창구를 직접 부를 수 있다. Tailscale serve가 붙이는 사용자 헤더는 본인 확인에 쓸 수 있지만 로컬 프로세스가 꾸밀 수 있으므로 보안 경계가 아니다(R-10, 14-15와 같은 한계). "Agent는 스스로 인수하지 않는다"는 지금처럼 규칙으로 지킨다.

이 적용은 별도 Task로 계획에 올린 뒤 진행한다.

## 7. 열린 질문

| 번호 | 질문 | 선택지 | 영향 |
|---|---|---|---|
| Q1 | 웹에서 착수 요청·취소·`decision` 해소를 Integrated에 넣을까 | 명세대로 승인만 / 셋을 함께 넣음(명령 계층은 같으므로 웹 채널만 더함) | Integrated 범위, C-4, 명령 예 표 |
| Q2 | `decision`의 "그만두기"는 무엇인가 | Task를 `취소됨`으로 닫음(계획 변경, 1-6) / 대기 사유만 닫고 Task는 착수 가능으로 둠 / 확장의 변경안으로만 | 6-5, 6-8, 1-6 |
| Q3 | Run 일시 중단을 사용자 명령으로 둘까 | 두지 않음(지금처럼 5-6 자원 소진에서만) / 단계 경계에서 멈추는 `pause` 추가(확장) | 6-3, 6-4 |
| Q4 | 실행 중인 Agent에 사람이 지시를 더할 수 있게 할까 | 두지 않음 / 다음 반복 회차의 입력으로만, 기록된 자료(VersionRef)로 | 8-4, 8-8, 0-4 |
| Q5 | 예산 조정과 정책 변경을 웹에서 할까 | CLI만 / 웹(대화형 채널)도 | 9-5, 9-10, 5-1 |
| Q6 | 요약 노드에서 일괄 조작을 둘까 | 두지 않음 / 하위 Task 명령을 묶어 하나씩 검사 | 5-4, 0-2 |
| Q7 | 폰에서 승인할 때 추가 확인 수단을 둘까 | 두지 않음(R-10 한계 표시) / 사람만 할 수 있는 확인(OS 인증, 기기 인증) | 14-15, 9-10 |
| Q8 | 사람에게도 직무 분리를 적용할까 | 적용하지 않음(1인 사용) / Run을 요청한 사람은 그 Run의 제출 기록을 승인하지 못함(Project 정책으로 켬) | 7-4, 9-1. Copilot·GitHub·Jira 사례 |
| Q9 | 폰이 로컬 Web UI에 어떻게 닿는가 | 닿지 않음(127.0.0.1만) / 사용자가 사설망(Tailscale 등)으로 넘김 / Catena가 원격 접근을 제공. 상주 서버를 강제하지 않는 원칙(0-6)과 R-10의 127.0.0.1·`Origin` 검사와 함께 정한다 | 0-6, R-10, 14-15. 제작 공정은 지금 Tailscale serve로 본다 |

**Spike 후보** (검토 문서 10절에 더할 것)

| 번호 | 확인할 것 |
|---|---|
| S1 | 허용 응답 선언(I10): 대기 사유마다 허용 응답과 입력 형식을 이벤트에 실을 수 있는가. 375px에서 그릴 수 있는가. 명령 계층 검사와 화면 표시가 같은 결과를 내는가 |
| S2 | 낡은 화면의 승인(I3): 승인 화면을 연 뒤 새 제출 기록이 생기면 승인이 거부되고 최신 화면으로 바뀌는가. 조사한 도구 중 이것을 명시한 곳은 없었다 |
| S3 | 취소 두 단계(I7): Claude Code Runner에서 취소 요청부터 `취소`까지 무엇이 남는가. `취소 요청됨`은 어떤 기록에서 계산하는가 |
| S4 | 영향 미리보기(I12): 새 시도·취소·반려의 영향을 읽기 모델로 계산해 보일 수 있는가 |
| S5 | 실행 중 지시(Q4): `claude -p` 실행 중 사람 메시지를 넣을 수 있는가. 넣는다면 어떤 기록(VersionRef)으로 남는가 |

## 8. 비교 도구 조사

2026-11-11에 공식 문서와 공식 저장소의 UI 소스로 조사했다. 엔진·프로토콜 비교는 `orchestration_architecture_review.md`에 있으므로 여기서는 화면 조작만 본다. 「2차」 표시는 포럼·서드파티에만 근거한 것이라 결정 근거로 쓰기 전에 다시 확인한다.

### 8-1. 도구별 요약

| 도구 | 화면 조작 | Catena에 주는 시사점 |
|---|---|---|
| LangGraph Studio | 노드 앞뒤 interrupt, 재개, 체크포인트 상태 편집 후 fork, 체크포인트부터 재실행(항상 새 fork). interrupt의 허용 응답(accept·edit·respond·ignore)을 interrupt를 만든 쪽이 선언 | 허용 응답 선언(I10). 사람이 Agent 산출물을 고치는 fork는 새 버전으로 기록하고 인수 대상도 그쪽으로 옮겨야 한다 |
| Temporal Web UI | Request Cancellation(협조적, Workflow가 정리)과 Terminate(강제)를 나누고 문서가 취소를 권함. Reset은 이벤트를 골라야 확인 버튼이 켜짐. 운영자가 쓰기 조작을 통째로나 조작별로 끌 수 있고, 끄면 UI 서버 API도 거부 | 협조적 취소만 두기(I7). 조작별로 켜고 끄는 방식은 읽기 전용 시안에서 조작을 하나씩 여는 데 쓸 수 있다 |
| Airflow 3 | Clear는 영향받는 Task 목록을 dry run으로 먼저 보이고 항목을 뺄 수 있음. Mark success·failed로 상태를 직접 지정. HITL은 지정 사용자만 응답하고 기한이 지나면 기본값(예: 거절) 적용 | 영향 미리보기(I12)는 채택. 상태 직접 지정은 반례(I4). 기한 기본값은 거절·만료만(I11) |
| Dagster | 재실행 범위: 전체·선택·선택부터·실패부터. 실패부터는 실패한 run에서만 켜짐 | 상태가 버튼을 켠다(I1, I2) |
| Prefect 3 | pause·suspend로 멈추고 입력 폼으로 재개. 폼은 타입에서 만든 JSON schema, 브라우저는 형식만 검사. 취소가 `Cancelling`에 머무는 사례(2차) | 서버 쪽 재검사(I10). 요청과 결과를 나눠 보이기(I7) |
| Argo Workflows | retry(같은 객체에서 실패 단계만), resubmit(새 Workflow), suspend·resume(재개할 때 값 입력), stop(exit handler 실행)과 terminate(즉시). 모든 조작을 같은 확인 문구로 물음 | 새 Run을 만드는 재실행이 Catena의 기록 구조와 맞는다(6-9 재시도와 같음). 같은 확인 문구는 반례(I12) |
| GitHub Actions | 배포 job 승인·거절(필수 리뷰어, 코멘트 선택, self-review 금지 설정). 관리자 보호 규칙 우회(코멘트 필수, "결과를 이해함" 확인). Re-run은 같은 SHA와 처음 실행자의 권한으로 | 버전 결합의 방향은 같지만 화면을 연 뒤 대상이 바뀐 경우의 거부는 없다(S2). 관리자 우회는 반례(I4) |
| Jenkins `input` | Proceed·Abort, `submitter` 지정. 관리자는 submitter와 상관없이 응답. 단계마다 proceed·abort URL이 있어 외부 프로세스도 응답 | URL·REST로 하는 승인은 사람 승인을 흉내 내는 통로가 된다(9-10, R-10, SP-8) |
| Copilot cloud agent | 실행 중 후속 메시지(진행 중인 도구 호출 뒤 반영), 세션 중지(이미 push한 commit은 남음), PR 코멘트로 변경 요청. Agent도 작업을 요청한 사람도 승인하지 못함 | 사람의 직무 분리(Q8). 실행 중 지시는 다음 경계에서만 반영(Q4) |
| Devin, Cursor | 멈춘 뒤 사람이 IDE·터미널을 넘겨받음(take over), 후속 지시 | 사람이 Run의 작업공간을 직접 고치면 제출 기록과 증거의 연결이 끊긴다. Catena-driven Run에는 두지 않고, 하려면 Run 밖의 작업(0-11)이 된다 |
| OpenHands | 도구 호출마다 확인하는 confirmation mode가 기본, 자동 승인·LLM 승인 옵션 | Hard Invariant를 사람이 매번 확인으로 대신하지 않는다(0-5) |
| Jira | 전이마다 condition(수행자·권한·직무 분리, 조건에 안 맞으면 버튼 숨김), validator(입력 검사), post function | 조건에 안 맞는 조작은 숨기지 않고 이유와 함께 보인다(I2)는 점이 다르다 |

### 8-2. 채택하는 것

1. 상태가 조작을 켜고 끈다(Argo·Dagster·GitHub) → I1, I2. Catena는 계산을 읽기 모델에 두어 CLI와 같게 한다.
2. 대기를 만든 쪽이 허용 응답을 선언한다(LangGraph·Airflow·Prefect·Argo·Jenkins) → I10.
3. 협조적 취소를 기본으로 하고 요청과 결과를 나눠 보인다(Temporal) → I7.
4. 재실행은 새 Run으로, 이전 기록을 남긴다(Argo resubmit·Temporal reset·LangGraph fork) → 명세 6-9와 같다.
5. 확인 단계에 영향 목록을 보인다(Airflow Clear) → I12.
6. 직무 분리(Copilot·GitHub·Jira) → Q8에서 정한다.
7. 폰은 대기 응답과 중지에 집중한다(GitHub Mobile·Copilot·Cursor) → I13.

### 8-3. 채택하지 않는 것

| 패턴 | 이유 |
|---|---|
| 상태 수동 지정(Airflow mark success, Prefect 상태 지정) | 증거 없이 완료를 만든다(0-4, 7-3) |
| 관리자 우회(GitHub 보호 규칙 우회, Jenkins 관리자 응답) | 경고를 띄우고 진행하는 것과 같다(0-5, 9-8) |
| 기한이 지나면 기본값으로 진행(Airflow `defaults`, Argo 자동 재개) | 기본값이 승인·진행이면 사람 승인을 건너뛴다(I11) |
| 강제 종료(Temporal Terminate, Argo terminate) | 정리 없이 끝내면 6-9의 정리(Ticket, 프로세스 그룹, worktree, 정산)가 빠진다(I7) |
| 같은 객체 안에서 재실행(Argo retry, Airflow clear) | 이전 시도의 기록을 덮는다. Catena는 시도마다 새 Run이다 |
| take over(Devin, Cursor) | Run의 제출 기록과 증거 연결이 끊긴다(6-8, 7-8) |
| URL·REST 승인(Jenkins input URL) | 비대화형 승인 통로다(9-10) |
| 모든 조작에 같은 확인 문구(Argo) | 파괴성의 차이를 숨긴다(I12) |

### 8-4. 조사하지 않은 것

- 도구를 설치해 화면을 직접 눌러 보지 않았다. Dagster의 현재 메뉴 이름, Prefect 3의 UI 버튼, LangSmith·Prefect·Airflow의 수행자 권한 세부는 확인하지 못했다.
- 2차 출처뿐인 것: Cursor 중지 동작, Prefect `Cancelling` 정체, Argo의 stop·terminate 권한 포함 관계, Airflow mark success와 scheduler의 경합.

### 8-5. 출처

LangGraph: docs.langchain.com/langsmith/use-studio, /oss/python/langgraph/interrupts, /langsmith/human-in-the-loop-time-travel · Temporal: docs.temporal.io/web-ui, /encyclopedia/workflow/cancellation-and-termination, /references/web-ui-configuration, github.com/temporalio/ui(`client-actions/*-confirmation-modal.svelte`) · Airflow: airflow.apache.org/docs/apache-airflow/stable/ui.html, 3.4.0/tutorial/hitl.html, github.com/apache/airflow(`ClearTaskInstanceDialog.tsx`) · Dagster: docs.dagster.io/guides/dagster/re-execution · Prefect: prefect.io/docs/v3/advanced/interactive · Argo: argo-workflows.readthedocs.io(cli/argo_retry, argo_resubmit, argo_stop, argo_terminate, intermediate-inputs), github.com/argoproj/argo-workflows(`workflow-operations-map.ts`) · GitHub: docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments, …/re-running-workflows-and-jobs, …/approving-workflow-runs-from-public-forks, github.blog/changelog/2021-04-01-reviewing-deployments-on-github-mobile · Copilot: docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents, …/concepts/agents/cloud-agent/risks-and-mitigations · Jenkins: jenkins.io/doc/pipeline/steps/pipeline-input-step · Devin: docs.devin.ai/work-with-devin/devin-session-tools · Cursor: docs.cursor.com/background-agent · OpenHands: docs.openhands.dev/openhands/usage/cli/terminal · Jira: support.atlassian.com/jira-cloud-administration/docs/configure-advanced-issue-workflows
