// 실시간 화면(T30). C1: live 데이터와 묶음 데이터가 섞이지 않는다(Integrated 인수 기준 3).
// C2: 같은 시점에 CLI 질의와 화면이 같은 값을 보여 준다(Integrated 인수 기준 6). 화면은 live API가 내준 이벤트를
// 묶음과 같은 검사(checkStream, foldAll)로 접어 같은 질의 함수로 그린다. 여기서는 그 값을 CLI --json과 비교한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLiveApi } from './live-api.ts';
import { checkStream, foldAll, refsOf } from './readmodel.ts';
import { query } from './catena.ts';
import { openStore } from '../engine/store.ts';
import { execute } from '../engine/commands.ts';
import { me } from '../engine/supervise.ts';
import { runWorkflow } from '../engine/workflow.ts';

const human = { kind: 'human' as const, id: 'user' };
const fake = (name: string) => [process.execPath, join(import.meta.dirname, '..', 'engine', 'fixtures', name)];
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const plan = {
  project: { project_id: 'p', name: '실시간 시험' }, phases: [{ id: 'P1', name: '구현' }], milestones: [{ id: 'M1', name: '완성', items: ['B'] }],
  wbs: [
    { id: 'A', name: '인사 파일 구현', phase: 'P1', goal: '인사 파일을 만든다', outputs: { greet: '코드' },
      conditions: [{ id: 'A-C1', method: 'auto', slot: 'greet', text: '인사 파일이 있다', verify: { command: 'test -f hello.txt' } }] },
    { id: 'B', name: '인사 확인 구현', phase: 'P1', agent: 'codex', goal: '인사 파일을 확인한다', inputs: { greet: 'A.greet' }, outputs: { check: '코드' },
      conditions: [
        { id: 'B-C1', method: 'auto', slot: 'check', text: '인사 내용이 맞다', verify: { command: 'grep -q 안녕 hello.txt' } },
        { id: 'B-C2', method: 'human', slot: 'check', text: '사용자가 결과를 확인한다' }] },
  ],
};

async function serve(root: string) {
  const api = createLiveApi(root);
  const srv = createServer((req, res) => api(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as any).port}/live/`;
  return { base, close: () => new Promise(r => srv.close(r)) };
}
// 화면(lib/data.ts)과 같은 순서: 선언 → 이벤트 검사 → 원문을 받아 해시 확인 → 끝까지 접기
async function screenModel(base: string, id: string) {
  const manifest = await (await fetch(`${base}${id}/dataset.json`)).json();
  const lines = (await (await fetch(`${base}${id}/events.jsonl`)).text()).split('\n').filter(Boolean);
  const events = checkStream(manifest, lines);
  const bad = new Map<string, string>();
  for (const r of refsOf(events)) {
    const res = await fetch(`${base}${id}/artifacts/sha256/${r.id.slice(7)}`);
    if (!res.ok) bad.set(r.id, '원문 파일 없음');
    else if (createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') !== r.id.slice(7)) bad.set(r.id, '해시 불일치');
  }
  return { manifest, lines, events, model: foldAll(events, (r: any) => bad.get(r.id)) };
}
const cli = (store: string, ...args: string[]) => JSON.parse(execFileSync(process.execPath, [join(import.meta.dirname, 'catena.ts'), ...args, '--store', store, '--json'], { encoding: 'utf8' }));
async function until(f: () => boolean) { for (const t = Date.now() + 10_000; !f(); await new Promise(r => setTimeout(r, 20))) if (Date.now() > t) throw new Error('기다리던 상태가 오지 않았다'); }

// A(가짜 Claude Code)를 검수까지 돌리고 B(가짜 Codex)를 시작해 승인을 기다리는 데까지 간다
async function untilApproval() {
  const tmp = mkdtempSync(join(tmpdir(), 'catena-live-'));
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const root = join(tmp, 'projects');
  const dir = join(root, 'p');
  const s = openStore(dir);
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CODEX_MODE = 'ok';
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: git(repo, 'rev-parse', 'HEAD') } }).ok);
  assert.equal((await runWorkflow(s, { run_id: 'A-r1', holder: me(), command: fake('fake-claude.mjs'), tickMs: 50, pollMs: 50 })).outcome, '검수');
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'B' } }).ok);
  const b = runWorkflow(s, { run_id: 'B-r1', holder: me(), command: fake('fake-codex.mjs'), tickMs: 50, pollMs: 50 });
  await until(() => Boolean(s.db.prepare('SELECT 1 FROM approval_requests').get()));
  const done = () => b.finally(() => { delete process.env.FAKE_CLAUDE_MODE; delete process.env.FAKE_CODEX_MODE; });
  return { tmp, root, dir, s, b: done() };
}

test('T30-C2: 실행 도중(승인 대기)과 끝난 뒤, 화면이 live로 받은 값과 CLI 질의 값이 같다', async () => {
  const { root, dir, s, b } = await untilApproval();
  const { base, close } = await serve(root);
  const same = (model: any) => {
    for (const args of [['status'], ['ready'], ['inbox'], ['graph'], ['show', 'A'], ['show', 'B'], ['agents', 'B']]) {
      const out = cli(dir, ...args);
      assert.equal(out.source.origin, 'live');
      assert.deepEqual(out.data, JSON.parse(JSON.stringify(query(model, args[0], args.slice(1)))), args.join(' '));
    }
  };
  const mid = await screenModel(base, 'p');
  assert.equal(mid.model.approvals.get('B-r1-s1-a1').decision, undefined, '승인을 기다리는 시점');
  same(mid.model);

  assert.ok(execute(s, { command: 'approval.decide', principal: human, channel: 'cli-tty', args: { approval_id: 'B-r1-s1-a1', decision: '승인', comment: '' } }).ok);
  assert.equal((await b).outcome, '검수');
  // 화면은 마지막으로 받은 seq 뒤만 새로 받는다. 이어 붙인 흐름은 처음부터 받은 것과 같다
  const fresh = (await (await fetch(`${base}p/events.jsonl?after=${mid.lines.length}`)).text()).split('\n').filter(Boolean);
  const end = await screenModel(base, 'p');
  assert.deepEqual([...mid.lines, ...fresh], end.lines);
  assert.ok(fresh.length > 0 && JSON.parse(fresh[0]).seq === mid.lines.length + 1);
  same(end.model);
  await close();
  s.close();
});

test('T30-C1: live 저장소는 출처 live로만 내주고, 다른 출처의 이벤트가 섞이면 화면 검사(E10)가 거부한다', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'catena-live-')), 'projects');
  const s = openStore(join(root, 'p'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan } }).ok);
  s.close();
  mkdirSync(join(root, 'not-a-store'));
  const { base, close } = await serve(root);
  assert.deepEqual(await (await fetch(`${base}index.json`)).json(), { projects: ['p'] }, '저장소가 있는 폴더만 Project다');
  const { manifest, events } = await screenModel(base, 'p');
  assert.deepEqual(manifest, { origin: 'live', schema_version: 1, project_id: 'p' });
  assert.ok(events.every(e => e.origin === 'live' && e.dataset_id === undefined), '묶음 ID 없이 live 출처만');
  assert.equal((await fetch(`${base}..%2Fp/dataset.json`)).status, 404);
  assert.equal((await fetch(`${base}none/events.jsonl`)).status, 404);

  // 시뮬레이션 묶음의 이벤트 한 줄이 저장소에 끼어들었다고 하자: 출처가 달라 전체를 거부한다(조용히 섞지 않는다)
  const db = new DatabaseSync(join(root, 'p', 'catena.db'));
  const n = events.length + 1;
  db.prepare('INSERT INTO events VALUES (?, ?, ?)').run(n, `sim-${n}`, JSON.stringify({ ...events[0], seq: n, event_id: `sim-${n}`, origin: 'simulated', dataset_id: 'roombook' }));
  db.close();
  await assert.rejects(screenModel(base, 'p'), /E10/);
  await close();
});

test('T31-C1: 화면 승인과 CLI 승인이 같은 검수 기록과 이벤트를 남긴다(채널만 다르다). 화면 승인은 보인 제출 기록에 묶인다', async () => {
  const post = (base: string, body: any, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}p/approvals/B-r1-s1-a1`, { method: 'POST', headers, body: JSON.stringify(body) });
  // 같은 계획을 두 번 돌려 하나는 대화형 CLI로, 하나는 화면(live API)으로 승인한다
  const viaCli = await untilApproval();
  assert.ok(execute(viaCli.s, { command: 'approval.decide', principal: human, channel: 'cli-tty', args: { approval_id: 'B-r1-s1-a1', decision: '승인', comment: '확인함' } }).ok);
  assert.equal((await viaCli.b).outcome, '검수');

  const viaWeb = await untilApproval();
  const { base, close } = await serve(viaWeb.root);
  const before = viaWeb.s.events().length;
  const refused = [
    [await post(base, { decision: '승인', comment: '', submission_id: 'B-r1-s9' }), 409, '화면에 보인 제출 기록과 다르면 버전 충돌'],
    [await post(base, { decision: '승인', submission_id: 'B-r1-s1' }, { 'Content-Type': 'text/plain' }), 415, 'JSON이 아니면 거부(다른 사이트의 단순 요청 차단)'],
    [await post(base, { decision: '승인', submission_id: 'B-r1-s1' }, { 'Content-Type': 'application/json', Origin: 'https://evil.example' }), 403, '다른 사이트에서 온 요청'],
    [await post(base, { decision: '반려', comment: ' ', submission_id: 'B-r1-s1' }), 422, '반려에는 이유가 필요'],
  ] as const;
  for (const [res, status, why] of refused) assert.equal(res.status, status, why);
  assert.equal(viaWeb.s.events().length, before, '거부된 요청은 아무것도 남기지 않는다');
  const ok = await post(base, { decision: '승인', comment: '확인함', submission_id: 'B-r1-s1' });
  assert.deepEqual([ok.status, ((await ok.json()) as any).ok], [200, true]);
  assert.equal((await post(base, { decision: '승인', comment: '', submission_id: 'B-r1-s1' })).status, 422, '이미 결정한 요청');
  assert.equal((await viaWeb.b).outcome, '검수');
  await close();

  // 커밋 해시·내용 해시·시각·임시 경로는 실행마다 다르므로 자리표시로 바꾸고, 승인 채널만 다른지 본다
  const norm = (x: { tmp: string; s: any }): string[] => x.s.events().map((e: any) => JSON.stringify({ type: e.type, actor: e.actor, payload: e.payload })
    .replaceAll(x.tmp, '<tmp>').replace(/\b[0-9a-f]{64}\b/g, '<sha>').replace(/\b[0-9a-f]{40}\b/g, '<commit>').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>'));
  const cliEvents = norm(viaCli);
  const webEvents = norm(viaWeb);
  const decided = (evs: string[]) => evs.findIndex(e => e.includes('"approval.decided"'));
  assert.equal(decided(cliEvents), decided(webEvents));
  assert.deepEqual(webEvents.map((e, i) => (i === decided(webEvents) ? e.replace('"channel":"web"', '"channel":"cli-tty"') : e)), cliEvents);
  const acc = (x: any) => x.s.db.prepare('SELECT acceptance_id, task_id FROM acceptances ORDER BY acceptance_id').all();
  assert.deepEqual(acc(viaWeb), acc(viaCli));
  assert.equal(JSON.parse(webEvents[decided(webEvents)]).payload.channel, 'web');
  viaCli.s.close();
  viaWeb.s.close();
});
