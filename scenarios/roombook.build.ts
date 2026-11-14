// Product MVP 기준 시나리오 "회의실 예약 서비스"를 데이터 묶음(scenarios/roombook/)으로 만든다.
// 시뮬레이션 데이터다. 같은 코드를 다시 실행하면 같은 파일이 나온다(event_id와 원문 해시가 결정적이다).
// 사용: node scenarios/roombook.build.ts && node tools/fold.ts scenarios/roombook
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario, USER, CATENA, MGR, W, RV, TEST, diff, log, transcript } from './sim.ts';

const { ev, art, at, node, contract, link, simpleFlow, runStart, runEnd, start, finish, act, submit, usage, evidence, request, decide, accept, write } =
  scenario('roombook-sim-1', '2026-11-01');

// ================= 1일차: 계획 =================
at(1, '09:00');
ev('project.defined', 'roombook', USER, 'Planning', {
  project_id: 'roombook', name: '회의실 예약 서비스',
  phases: [['P1', '요구사항'], ['P2', '설계'], ['P3', '구현'], ['P4', '테스트'], ['P5', '배포']].map(([phase_id, name], i) => ({ phase_id, name, order: i + 1 })),
});
node('T01', null, 'task', '요구사항 명세 작성', 1, 'P1');
node('S1', null, 'summary', 'Backend', 2);
node('S11', 'S1', 'summary', '사용자 인증', 1);
node('T02', 'S11', 'task', '인증 API 설계', 1, 'P2');
node('S111', 'S11', 'summary', '로그인 구현', 2);
node('T03', 'S111', 'task', '토큰 발급 구현', 1, 'P3');
node('T04', 'S111', 'task', '세션 관리 구현', 2, 'P3');
node('T05', 'S11', 'task', '인증 통합 테스트', 3, 'P4');
node('S12', 'S1', 'summary', '예약 도메인', 2);
node('T06', 'S12', 'task', 'DB 스키마 설계', 1, 'P2');
node('T07', 'S12', 'task', '예약 API 구현', 2, 'P3');
node('T08', 'S12', 'task', '예약 충돌 검사 테스트', 3, 'P4');
node('S2', null, 'summary', 'Frontend', 3);
node('T09', 'S2', 'task', '화면 설계', 1, 'P2');
node('T10', 'S2', 'task', '예약 화면 구현', 2, 'P3');
node('T11', 'S2', 'task', '로그인 화면 구현', 3, 'P3');
node('T13', 'S2', 'task', '관리자 통계 화면', 4, 'P3');
node('S3', null, 'summary', '배포', 4);
node('T12', 'S3', 'task', '배포 파이프라인 구성', 1, 'P5');
node('T14', 'S3', 'task', '운영 배포', 2, 'P5');

at(1, '09:10');
contract('T01', '회의실 예약 서비스 v1의 요구사항을 ID와 수용 기준으로 정리한다', '관리자 기능', ['docs/requirements.md'],
  ['brief'], [['requirements', '문서']],
  [['T01-C1', '요구사항마다 ID와 수용 기준이 있다', 'auto', 'requirements'], ['T01-C2', '요구사항 검토', 'human', 'requirements']]);
contract('T02', '로그인·토큰 갱신 API와 토큰 정책을 설계한다', '외부 SSO 연동', ['docs/auth-api.yaml', 'docs/token-policy.md'],
  ['requirements'], [['auth_api_spec', 'OpenAPI'], ['token_policy', '문서']],
  [['T02-C1', 'OpenAPI 문서가 스키마 검사를 통과한다', 'auto', 'auth_api_spec'], ['T02-C2', '보안 검토', 'human', 'auth_api_spec'],
   ['T02-C3', '토큰 만료·갱신 규칙이 명시돼 있다', 'human', 'token_policy']]);
contract('T03', '토큰 정책에 맞춰 액세스·갱신 토큰을 발급한다', '세션 저장소', ['src/auth/token.ts'],
  ['token_policy'], [['token_service', '코드']],
  [['T03-C1', '토큰 발급·만료 단위 테스트 통과', 'auto', 'token_service'], ['T03-C2', '코드 검토', 'human', 'token_service']]);
contract('T04', '인증 API 명세에 맞춰 세션을 유지하고 만료시킨다', '토큰 발급', ['src/auth/session.ts'],
  ['auth_api_spec'], [['session_service', '코드']],
  [['T04-C1', '세션 유지·만료 단위 테스트 통과', 'auto', 'session_service'], ['T04-C2', '코드 검토', 'human', 'session_service']]);
contract('T05', '로그인부터 세션 만료까지 통합 테스트를 작성하고 통과시킨다', '부하 시험', ['tests/auth/'],
  ['token_service', 'session_service'], [['auth_test_report', '테스트 보고서']],
  [['T05-C1', '로그인 통합 테스트 통과', 'auto', 'auth_test_report'], ['T05-C2', '테스트 범위 검토', 'human', 'auth_test_report']]);
contract('T06', '회의실·예약 테이블과 마이그레이션을 설계한다', '통계용 테이블', ['db/migrations/'],
  ['requirements'], [['schema', 'SQL']],
  [['T06-C1', '마이그레이션 적용·되돌리기 검사 통과', 'auto', 'schema'], ['T06-C2', '스키마 검토', 'human', 'schema'],
   ['T06-C3', '요구사항 R-03~R-05의 데이터를 모두 담는다', 'human']]);
contract('T07', '예약 생성·조회·취소 API와 시간 충돌 검사를 구현한다', '알림 발송', ['src/api/reservations.ts', 'src/domain/conflict.ts'],
  ['schema', 'screen_flow'], [['reservation_api', '코드']],
  [['T07-C1', '예약 CRUD 단위 테스트 통과', 'auto', 'reservation_api'], ['T07-C2', '예약 시간 충돌 테스트 통과', 'auto', 'reservation_api'],
   ['T07-C3', 'API 계약 일치 검토', 'human', 'reservation_api']]);
contract('T08', '예약 충돌 시나리오를 테스트로 만든다', '성능 시험', ['tests/reservations/'],
  ['reservation_api'], [['conflict_test_report', '테스트 보고서']],
  [['T08-C1', '충돌 시나리오 테스트 통과', 'auto', 'conflict_test_report'], ['T08-C2', '테스트 범위 검토', 'human', 'conflict_test_report']]);
contract('T09', '예약·로그인 화면 흐름과 와이어프레임을 만든다', '관리자 화면', ['docs/screens.md', 'docs/ui-mock.md'],
  ['requirements'], [['screen_flow', '문서'], ['ui_mock', '문서']],
  [['T09-C1', '화면 흐름이 요구사항 ID를 모두 덮는다', 'auto', 'screen_flow'], ['T09-C2', '디자인 검토', 'human', 'ui_mock']]);
contract('T10', '와이어프레임대로 예약 화면을 구현한다', '관리자 화면', ['web/src/reservation/'],
  ['ui_mock', 'reservation_api'], [['reservation_ui', '코드']],
  [['T10-C1', '예약 화면 컴포넌트 테스트 통과', 'auto', 'reservation_ui'], ['T10-C2', '화면 검토', 'human', 'reservation_ui']]);
contract('T11', '와이어프레임과 인증 API 명세대로 로그인 화면을 구현한다', 'SSO 버튼', ['web/src/login/'],
  ['ui_mock', 'auth_api_spec'], [['login_ui', '코드']],
  [['T11-C1', '로그인 화면 컴포넌트 테스트 통과', 'auto', 'login_ui'], ['T11-C2', '화면 검토', 'human', 'login_ui']]);

at(1, '09:15');
const BRIEF = '# 기획 메모 (사람이 등록한 초기 입력)\n\n- 사내 회의실 12개, 예약 충돌이 잦다.\n- 사내 계정으로 로그인한다.\n- 첫 버전에는 관리자 통계가 없어도 된다.\n';
ev('dependency.linked', 'T01', USER, 'Planning', { from: { external_ref: art(BRIEF) }, to: { task_id: 'T01', slot: 'brief' } });
link('T01', 'requirements', 'T02', 'requirements');
link('T01', 'requirements', 'T06', 'requirements');
link('T01', 'requirements', 'T09', 'requirements');
link('T02', 'token_policy', 'T03', 'token_policy');
link('T02', 'auth_api_spec', 'T04', 'auth_api_spec');
link('T02', 'auth_api_spec', 'T11', 'auth_api_spec');
link('T03', 'token_service', 'T05', 'token_service');
link('T04', 'session_service', 'T05', 'session_service');
link('T06', 'schema', 'T07', 'schema');
link('T09', 'screen_flow', 'T07', 'screen_flow');
link('T07', 'reservation_api', 'T08', 'reservation_api');
link('T07', 'reservation_api', 'T10', 'reservation_api');
link('T09', 'ui_mock', 'T10', 'ui_mock');
link('T09', 'ui_mock', 'T11', 'ui_mock');

at(1, '09:20');
for (const t of ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T08', 'T09', 'T10', 'T11']) simpleFlow(t);
ev('workflow.bound', 'T07', CATENA, 'Graph Design', {
  task_id: 'T07',
  nodes: [
    { node_id: 'plan', name: '작업 나누기', stage: '계획', executor: 'agent', role: 'Manager' },
    { node_id: 'impl-api', name: 'CRUD 핸들러 구현', stage: '구현', executor: 'agent', role: 'Worker' },
    { node_id: 'check-api', name: 'CRUD 단위 테스트', stage: '검증', executor: 'code' },
    { node_id: 'review-api', name: 'API 계약 검토', stage: '검증', executor: 'agent', role: 'Reviewer' },
    { node_id: 'impl-conflict', name: '충돌 검사 구현', stage: '구현', executor: 'agent', role: 'Worker' },
    { node_id: 'check-conflict', name: '충돌 테스트', stage: '검증', executor: 'code' },
    { node_id: 'approve', name: '인수 승인', stage: '승인', executor: 'human', role: '승인자' },
  ],
  edges: [
    { from: 'plan', to: 'impl-api', kind: '분기' }, { from: 'plan', to: 'impl-conflict', kind: '분기' },
    { from: 'impl-api', to: 'check-api', kind: '순차' }, { from: 'check-api', to: 'impl-api', kind: '반복' },
    { from: 'check-api', to: 'review-api', kind: '순차' },
    { from: 'impl-conflict', to: 'check-conflict', kind: '순차' }, { from: 'check-conflict', to: 'impl-conflict', kind: '반복' },
    { from: 'review-api', to: 'approve', kind: '합류' }, { from: 'check-conflict', to: 'approve', kind: '합류' },
  ],
});
ev('milestone.defined', 'M1', USER, 'Planning', { milestone_id: 'M1', name: '인증 기능 완성',
  items: [{ task_id: 'T02', slot: 'auth_api_spec' }, { task_id: 'T02', slot: 'token_policy' }, { task_id: 'T03' }, { task_id: 'T04' }, { task_id: 'T05' }] });
ev('milestone.defined', 'M2', USER, 'Planning', { milestone_id: 'M2', name: '예약 기능 첫 동작',
  items: [{ task_id: 'T06' }, { task_id: 'T07' }, { task_id: 'T08' }, { task_id: 'T10' }] });

// ================= 1일차: T01 요구사항 =================
const REQ = [
  '# 회의실 예약 서비스 요구사항 v1', '',
  '| ID | 요구사항 | 수용 기준 |', '|---|---|---|',
  '| R-01 | 사내 계정으로 로그인한다 | 비밀번호 5회 오류 시 10분 잠금 |',
  '| R-02 | 로그인 상태를 30분 유지한다 | 30분 무활동 시 다시 로그인 |',
  '| R-03 | 회의실 목록과 빈 시간을 본다 | 오늘부터 14일 범위 |',
  '| R-04 | 회의실을 30분 단위로 예약한다 | 겹치는 예약은 거절 |',
  '| R-05 | 자기 예약을 취소한다 | 시작 10분 전까지 |',
  '| R-06 | 관리자 통계 | v1 범위 제외 |',
];
at(1, '09:30'); runStart('T01', 'R01-1'); start('R01-1', 'work', 1, W(4));
at(1, '09:50'); act('R01-1', 'work', 1, W(4), '도구 호출', 'docs/requirements.md 작성', '시스템 기록');
at(1, '10:05'); act('R01-1', 'work', 1, W(4), '메시지', '요구사항 6개를 ID와 수용 기준으로 정리했습니다', 'Agent 보고');
at(1, '10:10'); submit('R01-1', 'work', 'S01-1', [{ output_slot: 'requirements', path: 'docs/requirements.md', artifact_ref: art(REQ.join('\n') + '\n') }], diff('docs/requirements.md', REQ));
usage('R01-1', 'work', 0.42); finish('R01-1', 'work', 1, W(4));
at(1, '10:12'); start('R01-1', 'check', 1, TEST);
evidence('S01-1', 'E01-1', 'T01-C1', '통과', log('npm run lint:requirements', ['requirements.md: 6개 요구사항, ID 누락 0, 수용 기준 누락 0', 'PASS']));
finish('R01-1', 'check', 1, TEST);
at(1, '10:15'); start('R01-1', 'approve', 1, USER); request('S01-1', 'A01-1', ['T01-C2']);
at(1, '10:40'); decide('A01-1', 'R-06을 범위 제외로 둔 것 확인');
accept('AC01-1', 'T01', 'requirements', 'S01-1', ['T01-C1', 'T01-C2'], ['E01-1'], 'A01-1');
accept('AC01-2', 'T01', null, 'S01-1', [], [], 'A01-1');
finish('R01-1', 'approve', 1, USER); runEnd('R01-1', '종료');

// ================= 1일차: T02·T06·T09 병렬 =================
at(1, '11:00'); runStart('T02', 'R02-1'); start('R02-1', 'work', 1, W(5));
runStart('T06', 'R06-1'); start('R06-1', 'work', 1, W(1));
at(1, '11:05'); runStart('T09', 'R09-1'); start('R09-1', 'work', 1, W(6));

const SQL1 = ['CREATE TABLE rooms (id INTEGER PRIMARY KEY, name TEXT NOT NULL, capacity INTEGER NOT NULL);',
  'CREATE TABLE reservations (id INTEGER PRIMARY KEY, room_id INTEGER REFERENCES rooms(id), starts_at TEXT, ends_at TEXT, owner TEXT);'];
at(1, '11:40'); act('R06-1', 'work', 1, W(1), '도구 호출', 'db/migrations/001_init.up.sql 작성 (rooms, reservations)', '시스템 기록');
at(1, '11:50'); submit('R06-1', 'work', 'S06-1', [{ output_slot: 'schema', path: 'db/migrations/' }], diff('db/migrations/001_init.up.sql', SQL1));
usage('R06-1', 'work', 0.55); finish('R06-1', 'work', 1, W(1));
at(1, '11:52'); start('R06-1', 'check', 1, TEST);
evidence('S06-1', 'E06-1', 'T06-C1', '실패', log('npm run migrate:check', ['apply 001_init ... ok', 'rollback 001_init ... FAIL', 'error: down migration not found for 001_init']));
finish('R06-1', 'check', 1, TEST, '실패');

at(1, '12:00'); act('R09-1', 'work', 1, W(6), '도구 호출', 'docs/screens.md 작성 (화면 흐름 5개)', '시스템 기록');
at(1, '12:05'); start('R06-1', 'work', 2, W(1));
act('R06-1', 'work', 2, W(1), '메시지', '되돌리기 실패 원인은 down 마이그레이션 누락입니다. 추가하겠습니다', 'Agent 보고');
at(1, '12:20'); act('R02-1', 'work', 1, W(5), '도구 호출', 'docs/auth-api.yaml 작성 (OpenAPI 3.1, /login, /token/refresh)', '시스템 기록');
at(1, '12:30'); submit('R06-1', 'work', 'S06-2', [{ output_slot: 'schema', path: 'db/migrations/' }],
  diff('db/migrations/001_init.down.sql', ['DROP TABLE reservations;', 'DROP TABLE rooms;']));
usage('R06-1', 'work', 0.31); finish('R06-1', 'work', 2, W(1));
at(1, '12:32'); start('R06-1', 'check', 2, TEST);
evidence('S06-2', 'E06-2', 'T06-C1', '통과', log('npm run migrate:check', ['apply 001_init ... ok', 'rollback 001_init ... ok', 'PASS']));
finish('R06-1', 'check', 2, TEST);
at(1, '12:35'); start('R06-1', 'approve', 1, USER); request('S06-2', 'A06-1', ['T06-C2', 'T06-C3']);

const SCREENS = ['# 화면 흐름', '- F1 로그인 (R-01, R-02)', '- F2 회의실 목록 (R-03)', '- F3 예약 만들기 (R-04)', '- F4 내 예약 (R-05)', '- F5 예약 충돌 안내 (R-04)'];
const MOCK = ['# 와이어프레임', '[로그인] 아이디 | 비밀번호 | 로그인 버튼', '[목록] 회의실 카드 12개, 날짜 선택', '[예약] 시작·종료(30분 단위), 확인 버튼'];
at(1, '12:50'); act('R09-1', 'work', 1, W(6), '도구 호출', 'docs/ui-mock.md 와이어프레임 작성', '시스템 기록');
at(1, '13:00'); submit('R09-1', 'work', 'S09-1', [
  { output_slot: 'screen_flow', path: 'docs/screens.md', artifact_ref: art(SCREENS.join('\n') + '\n') },
  { output_slot: 'ui_mock', path: 'docs/ui-mock.md', artifact_ref: art(MOCK.join('\n') + '\n') }],
  diff('docs/screens.md', SCREENS) + diff('docs/ui-mock.md', MOCK));
usage('R09-1', 'work', 0.48); finish('R09-1', 'work', 1, W(6));
at(1, '13:02'); start('R09-1', 'check', 1, TEST);
evidence('S09-1', 'E09-1', 'T09-C1', '통과', log('npm run check:coverage -- docs/screens.md', ['R-01..R-05 모두 화면 흐름에 연결됨 (R-06 범위 제외)', 'PASS']));
finish('R09-1', 'check', 1, TEST);
at(1, '13:05'); start('R09-1', 'approve', 1, USER); request('S09-1', 'A09-1', ['T09-C2']);

const AUTH_API = ['openapi: 3.1.0', 'paths:', '  /login: { post: { summary: 로그인 } }', '  /token/refresh: { post: { summary: 토큰 갱신 } }'];
const TOKEN_POLICY = ['# 토큰 정책', '- 액세스 토큰 15분, 갱신 토큰 30분 (R-02)', '- 갱신 시 갱신 토큰도 교체한다', '- 만료 판정은 서버 시각 기준, 오차 허용 없음'];
at(1, '13:20'); act('R02-1', 'work', 1, W(5), '도구 호출', 'docs/token-policy.md 작성', '시스템 기록');
at(1, '13:30'); act('R02-1', 'work', 1, W(5), '메시지', '인증 API 명세와 토큰 정책 두 문서를 작성했습니다', 'Agent 보고');
submit('R02-1', 'work', 'S02-1', [
  { output_slot: 'auth_api_spec', path: 'docs/auth-api.yaml', artifact_ref: art(AUTH_API.join('\n') + '\n') },
  { output_slot: 'token_policy', path: 'docs/token-policy.md', artifact_ref: art(TOKEN_POLICY.join('\n') + '\n') }],
  diff('docs/auth-api.yaml', AUTH_API) + diff('docs/token-policy.md', TOKEN_POLICY));
usage('R02-1', 'work', 0.62); finish('R02-1', 'work', 1, W(5));
at(1, '13:32'); start('R02-1', 'check', 1, TEST);
evidence('S02-1', 'E02-1', 'T02-C1', '통과', log('npx openapi-lint docs/auth-api.yaml', ['0 errors, 0 warnings', 'PASS']));
finish('R02-1', 'check', 1, TEST);
at(1, '13:35'); start('R02-1', 'approve', 1, USER); request('S02-1', 'A02-1', ['T02-C3']);

at(1, '14:00'); decide('A06-1', 'R-03~R-05에 필요한 컬럼 확인');
accept('AC06-1', 'T06', 'schema', 'S06-2', ['T06-C1', 'T06-C2'], ['E06-2'], 'A06-1');
accept('AC06-2', 'T06', null, 'S06-2', ['T06-C3'], [], 'A06-1');
finish('R06-1', 'approve', 1, USER); runEnd('R06-1', '종료');

at(1, '15:00'); decide('A09-1', '와이어프레임 확인');
accept('AC09-1', 'T09', 'screen_flow', 'S09-1', ['T09-C1'], ['E09-1'], 'A09-1');
accept('AC09-2', 'T09', 'ui_mock', 'S09-1', ['T09-C2'], [], 'A09-1');
accept('AC09-3', 'T09', null, 'S09-1', [], [], 'A09-1');
finish('R09-1', 'approve', 1, USER); runEnd('R09-1', '종료');

// T02는 토큰 정책만 먼저 인수하고, 인증 API 명세는 보안 검토 승인을 기다린다.
at(1, '15:30'); decide('A02-1', '토큰 정책 먼저 승인. API 명세는 보안 검토 후');
accept('AC02-1', 'T02', 'token_policy', 'S02-1', ['T02-C3'], [], 'A02-1');
at(1, '15:35'); request('S02-1', 'A02-2', ['T02-C2']);

// ================= 2일차 =================
const TOKEN_TS = ['export function issue(user: string, now = Date.now()) {', '  return { user, expiresAt: now + 15 * 60 * 1000 };', '}',
  'export const expired = (t: { expiresAt: number }, now = Date.now()) => now > t.expiresAt;'];
const failLog = (n: number) => log('npm test -- tests/auth/token.test.ts', [
  '✓ 액세스 토큰을 발급한다', '✓ 갱신 토큰을 교체한다',
  `✗ 만료 시각과 같은 순간에는 만료로 본다 (시도 ${n})`, '  expected expired(t, t.expiresAt) to be true, got false', 'FAIL 1 of 3']);

at(2, '09:00'); runStart('T03', 'R03-1'); start('R03-1', 'work', 1, W(3));
at(2, '09:10'); ev('wbs_node.closed', 'T13', USER, 'Planning', { node_id: 'T13', lifecycle: '취소됨', reason: '요구사항 R-06이 v1 범위에서 빠짐' });
at(2, '09:30');
contract('T12', '테스트와 배포를 자동으로 돌리는 CI 파이프라인을 만든다', '운영 서버 구성', ['.ci/'],
  [], [['pipeline', '설정']],
  [['T12-C1', 'CI 파이프라인 시험 실행 성공', 'auto', 'pipeline'], ['T12-C2', '배포 권한 검토', 'human']]);
simpleFlow('T12');
// 운영 배포는 백엔드·프론트엔드 결과와 파이프라인이 모두 인수돼야 착수한다. 파이프라인(T12)은 구현과 따로 먼저 만들 수 있다.
contract('T14', '인수된 백엔드와 화면을 파이프라인으로 운영 서버에 배포한다', '무중단 배포', ['deploy/'],
  ['auth_test_report', 'conflict_test_report', 'reservation_ui', 'login_ui', 'pipeline'], [['release', '배포 기록']],
  [['T14-C1', '스테이징 배포 뒤 스모크 시험 통과', 'auto', 'release'], ['T14-C2', '운영 배포 승인', 'human', 'release']]);
simpleFlow('T14');
link('T05', 'auth_test_report', 'T14', 'auth_test_report');
link('T08', 'conflict_test_report', 'T14', 'conflict_test_report');
link('T10', 'reservation_ui', 'T14', 'reservation_ui');
link('T11', 'login_ui', 'T14', 'login_ui');
link('T12', 'pipeline', 'T14', 'pipeline');
at(2, '09:40'); act('R03-1', 'work', 1, W(3), '도구 호출', 'src/auth/token.ts 작성', '시스템 기록');
at(2, '09:50'); submit('R03-1', 'work', 'S03-1', [{ output_slot: 'token_service', path: 'src/auth/token.ts' }], diff('src/auth/token.ts', TOKEN_TS));
usage('R03-1', 'work', 0.38); finish('R03-1', 'work', 1, W(3));
at(2, '09:52'); start('R03-1', 'check', 1, TEST); evidence('S03-1', 'E03-1', 'T03-C1', '실패', failLog(1)); finish('R03-1', 'check', 1, TEST, '실패');

at(2, '10:00'); runStart('T07', 'R07-1'); start('R07-1', 'plan', 1, MGR);
at(2, '10:05');
ev('wait.raised', 'T12', CATENA, 'Resource', { wait_id: 'W-T12-budget', wait_type: 'resource', target_id: 'T12',
  resolve_condition: '예약 가능한 예산 $4.00 이상 필요', action: { actor: '시스템', text: 'T07 실행의 비용 정산 대기', screen: 'Project 개요' } });
start('R03-1', 'work', 2, W(3));
act('R03-1', 'work', 2, W(3), '메시지', '시간 비교를 밀리초 단위로 고쳤습니다', 'Agent 보고');
at(2, '10:10');
act('R07-1', 'plan', 1, MGR, '메시지', '예약 API를 CRUD 핸들러와 시간 충돌 검사로 나눠 맡깁니다', 'Agent 보고',
  { raw_ref: art(transcript([['manager-1', '계약 T07의 조건 3개를 보면 CRUD와 충돌 검사는 서로 다른 파일을 고친다.'], ['manager-1', 'worker-1: src/api/reservations.ts, worker-2: src/domain/conflict.ts로 나눈다.']])) });
at(2, '10:12');
act('R07-1', 'plan', 1, MGR, '위임', '예약 CRUD 핸들러 구현을 맡김', '시스템 기록', { to_instance: 'worker-1' });
act('R07-1', 'plan', 1, MGR, '위임', '예약 시간 충돌 검사 구현을 맡김', '시스템 기록', { to_instance: 'worker-2' });
at(2, '10:15'); usage('R07-1', 'plan', 0.20); finish('R07-1', 'plan', 1, MGR);
start('R07-1', 'impl-api', 1, W(1)); start('R07-1', 'impl-conflict', 1, W(2));

at(2, '10:30'); submit('R03-1', 'work', 'S03-2', [{ output_slot: 'token_service', path: 'src/auth/token.ts' }],
  diff('src/auth/token.ts', ['export const expired = (t: { expiresAt: number }, now = Date.now()) => now - t.expiresAt > 0;']));
usage('R03-1', 'work', 0.29); finish('R03-1', 'work', 2, W(3));
at(2, '10:32'); start('R03-1', 'check', 2, TEST); evidence('S03-2', 'E03-2', 'T03-C1', '실패', failLog(2)); finish('R03-1', 'check', 2, TEST, '실패');
at(2, '10:40'); start('R03-1', 'work', 3, W(3));

const API_TS = ['router.post("/reservations", create);', 'router.get("/reservations", list);', 'router.delete("/reservations/:id", cancel);'];
at(2, '11:00'); act('R07-1', 'impl-api', 1, W(1), '도구 호출', 'src/api/reservations.ts 작성 (생성·조회·취소)', '시스템 기록',
  { raw_ref: art(transcript([['tool', 'Edit src/api/reservations.ts (+48 -0)'], ['worker-1', '생성·조회·취소 핸들러를 추가했다. 조회는 회의실별로 거른다.']])) });
at(2, '11:20'); act('R03-1', 'work', 3, W(3), '메시지', '모든 테스트를 통과했습니다', 'Agent 보고',
  { raw_ref: art(transcript([['worker-3', '경계 비교를 >= 로 바꿨고 로컬에서 테스트가 통과했다고 판단한다.'], ['worker-3', '모든 테스트를 통과했습니다.']])) });
submit('R03-1', 'work', 'S03-3', [{ output_slot: 'token_service', path: 'src/auth/token.ts' }],
  diff('src/auth/token.ts', ['export const expired = (t: { expiresAt: number }, now = Date.now()) => now >= t.expiresAt + 1;']));
usage('R03-1', 'work', 0.33); finish('R03-1', 'work', 3, W(3));
at(2, '11:22'); start('R03-1', 'check', 3, TEST); evidence('S03-3', 'E03-3', 'T03-C1', '실패', failLog(3)); finish('R03-1', 'check', 3, TEST, '실패');
at(2, '11:25'); runEnd('R03-1', '실패', '수정 반복 상한 3회 도달');
ev('wait.raised', 'T03', CATENA, 'Execution', { wait_id: 'W-T03-decision', wait_type: 'decision', target_id: 'T03',
  resolve_condition: '다음 진행을 사용자가 정해야 함', action: { actor: '사용자', text: '실패한 검사 로그를 보고 다시 실행할지 결정', screen: 'Task 상세' } });

at(2, '11:40'); act('R07-1', 'impl-conflict', 1, W(2), '도구 호출', 'src/domain/conflict.ts 작성 시작', '시스템 기록');
at(2, '12:00'); act('R07-1', 'impl-api', 1, W(1), '도구 호출', 'npm test -- reservations (로컬 실행)', '시스템 기록');
at(2, '12:10'); act('R07-1', 'impl-api', 1, W(1), '메시지', 'CRUD 핸들러 구현을 마쳤습니다', 'Agent 보고');
at(2, '12:15'); submit('R07-1', 'impl-api', 'S07-1', [{ output_slot: 'reservation_api', path: 'src/api/reservations.ts' }], diff('src/api/reservations.ts', API_TS));
usage('R07-1', 'impl-api', 0.74); finish('R07-1', 'impl-api', 1, W(1));
at(2, '12:17'); start('R07-1', 'check-api', 1, TEST);
evidence('S07-1', 'E07-1', 'T07-C1', '통과', log('npm test -- tests/api/reservations.test.ts', ['✓ 예약을 만든다', '✓ 회의실별로 조회한다', '✓ 예약을 취소한다', 'PASS 3 of 3']));
finish('R07-1', 'check-api', 1, TEST);
at(2, '12:20'); start('R07-1', 'review-api', 1, RV);
at(2, '12:40'); act('R07-1', 'review-api', 1, RV, '판단', '응답 형식은 API 계약과 일치한다. 목록 조회에 페이지네이션이 빠졌다', 'Agent 보고',
  { raw_ref: art(transcript([['reviewer-1', 'POST /reservations 응답 필드가 계약과 같다.'], ['reviewer-1', 'GET /reservations는 14일 범위(R-03)를 한 번에 돌려준다. 페이지네이션이 필요하다.']])) });
at(2, '13:00'); act('R07-1', 'impl-conflict', 1, W(2), '메시지', '겹치는 시간 판정 규칙을 구현하고 있습니다', 'Agent 보고');

write(join(dirname(fileURLToPath(import.meta.url)), 'roombook'),
  '회의실 예약 서비스 개발 2일차 오후의 공정. 만든 데이터이며 실제 실행이 아니다. Product MVP 기준 시나리오(core spec 13장)의 항목을 모두 담는다. Agent 노드의 Runtime·모델 구성(Codex 포함)은 확장 단계를 가정한 값이다.');
