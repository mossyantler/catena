// Project 저장소 시험(T13): 여러 프로세스가 동시에 써도 seq에 빈틈이 없다(C1), 불변 기록은 수정·삭제가 거부된다(C2),
// 저장된 이벤트를 읽기 모델로 접으면 검사 규칙을 통과한다(C3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMMUTABLE, openStore } from './store.ts';
import { foldAll } from '../tools/readmodel.ts';
import { describe, foldBundle } from '../tools/fold.ts';

const fresh = () => mkdtempSync(join(tmpdir(), 'catena-store-'));
const ping = (subject: string) => ({ occurred_at: new Date().toISOString(), type: 'test.ping', subject, actor: { kind: 'system', instance: 'test' }, issuer: 'test', payload: {} }) as any;

test('C1: 여러 프로세스가 같은 저장소에 동시에 써도 seq가 1부터 빈틈없이 이어진다', async () => {
  const dir = fresh();
  openStore(dir).close(); // 스키마를 먼저 만든다
  const store = new URL('./store.ts', import.meta.url).pathname;
  // 네 프로세스가 준비를 마친 뒤 신호(go 파일)에 맞춰 함께 쓰기 시작한다. 트랜잭션 사이에 1ms를 쉬어
  // 한 프로세스가 잠금을 연달아 잡지 않게 해, 쓰기가 실제로 섞이는지도 확인한다.
  const writer = (w: number) => `import { openStore } from ${JSON.stringify(store)};
    import { existsSync, writeFileSync } from 'node:fs';
    const s = openStore(${JSON.stringify(dir)});
    writeFileSync(${JSON.stringify(dir)} + '/ready-${w}', '');
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (const until = Date.now() + 30_000; !existsSync(${JSON.stringify(dir)} + '/go'); Atomics.wait(pause, 0, 0, 1)) if (Date.now() > until) process.exit(3);
    for (let i = 0; i < 50; i++) {
      s.tx(() => s.append({ occurred_at: new Date().toISOString(), type: 'test.ping', subject: 'w${w}-' + i, actor: { kind: 'system', instance: 'w${w}' }, issuer: 'test', payload: {} }));
      Atomics.wait(pause, 0, 0, 1);
    }
    s.close();`;
  const runs = [0, 1, 2, 3].map(w => new Promise<number | null>(done => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', writer(w)], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('close', done);
  }));
  for (const until = Date.now() + 20_000; readdirSync(dir).filter(f => f.startsWith('ready-')).length < 4; await new Promise(r => setTimeout(r, 5))) if (Date.now() > until) throw new Error('자식 프로세스가 준비 신호를 보내지 않았다');
  writeFileSync(join(dir, 'go'), '');
  assert.deepEqual(await Promise.all(runs), [0, 0, 0, 0]);
  const s = openStore(dir);
  const evs = s.events(); // checkStream이 빈틈·중복(E1)을 다시 검사한다
  s.close();
  assert.deepEqual(evs.map(e => e.seq), Array.from({ length: 200 }, (_, i) => i + 1));
  assert.equal(new Set(evs.map(e => e.event_id)).size, 200);
  for (const w of [0, 1, 2, 3]) assert.equal(evs.filter(e => e.subject.startsWith(`w${w}-`)).length, 50);
  const switches = evs.filter((e, i) => i > 0 && e.subject.split('-')[0] !== evs[i - 1].subject.split('-')[0]).length;
  assert.ok(switches > 20, `쓰기가 섞이지 않았다(전환 ${switches}회): 동시 쓰기를 시험하지 못했다`);
});

test('여러 프로세스가 새 저장소를 동시에 열어도 잠금 때문에 실패하지 않는다', async () => {
  // 회귀 시험: busy_timeout보다 journal_mode를 먼저 두면, 동시에 연 프로세스 하나가 기다리지 않고 SQLITE_BUSY로 죽었다(2026-11-13 발견)
  const dir = fresh();
  const store = new URL('./store.ts', import.meta.url).pathname;
  const codes = await Promise.all(Array.from({ length: 8 }, (_, w) => new Promise<number | null>(done => {
    const code = `import { openStore } from ${JSON.stringify(store)};
      const s = openStore(${JSON.stringify(dir)});
      s.tx(() => s.append({ occurred_at: '', type: 'test.ping', subject: 'o${w}', actor: { kind: 'system', instance: 'o${w}' }, issuer: 'test', payload: {} }));
      s.close();`;
    spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'inherit'] }).on('close', done);
  })));
  assert.deepEqual(codes, Array(8).fill(0));
  const s = openStore(dir);
  assert.deepEqual(s.events().map(e => e.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
  s.close();
});

test('트랜잭션: 실패하면 아무것도 남지 않고 다음 seq도 빈틈없이 이어진다. 트랜잭션 밖에서는 이벤트를 쓸 수 없다', () => {
  const s = openStore(fresh());
  s.tx(() => s.append(ping('a')));
  assert.throws(() => s.tx(() => { s.append(ping('b')); throw new Error('규칙 위반'); }), /규칙 위반/);
  s.tx(() => s.append(ping('c')));
  assert.deepEqual(s.events().map(e => [e.seq, e.subject]), [[1, 'a'], [2, 'c']]);
  assert.throws(() => s.append(ping('d')), /트랜잭션/);
  s.close();
});

test('C2: 불변 기록과 이벤트는 수정·삭제가 거부되고, 상태 테이블은 바뀔 수 있다', () => {
  const s = openStore(fresh());
  const rows: Record<string, string> = {
    contracts: "INSERT INTO contracts VALUES ('T1', 1, '{}')",
    baselines: "INSERT INTO baselines VALUES ('B1', '{}')",
    submissions: "INSERT INTO submissions VALUES ('S1', 'R1', '{}')",
    evidence: "INSERT INTO evidence VALUES ('E1', 'S1', '{}')",
    acceptances: "INSERT INTO acceptances VALUES ('A1', 'T1', '{}')",
    approval_requests: "INSERT INTO approval_requests VALUES ('P1', '{}')",
    approval_decisions: "INSERT INTO approval_decisions VALUES ('P1', '{}')",
    commands: "INSERT INTO commands VALUES (1, 1, 'plan.import', '{}', 'cli-tty', 'x', '')",
  };
  s.tx(() => { for (const sql of Object.values(rows)) s.db.exec(sql); s.append(ping('x')); });
  const key: Record<string, string> = { contracts: 'task_id', baselines: 'baseline_id', submissions: 'submission_id', evidence: 'evidence_id', acceptances: 'acceptance_id', approval_requests: 'approval_id', approval_decisions: 'approval_id', events: 'seq', commands: 'command' };
  for (const t of IMMUTABLE) {
    assert.throws(() => s.tx(() => s.db.exec(`UPDATE ${t} SET ${key[t]} = ${key[t]}`)), /불변 기록/, `${t} 수정`);
    assert.throws(() => s.tx(() => s.db.exec(`DELETE FROM ${t}`)), /불변 기록/, `${t} 삭제`);
  }
  assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM contracts').get() as any).n, 1, '거부된 뒤에도 남아 있다');
  s.tx(() => { s.db.exec("INSERT INTO runs VALUES ('R1', 'T1', 1, '대기', '{}')"); s.db.exec("UPDATE runs SET state = '실행 중' WHERE run_id = 'R1'"); });
  assert.equal((s.db.prepare("SELECT state FROM runs WHERE run_id = 'R1'").get() as any).state, '실행 중');
  s.close();
});

test('C3: 기준 시나리오를 저장소에 넣고 접으면 검사 규칙을 통과하고, 묶음을 접은 결과와 같다', () => {
  const bundle = join(import.meta.dirname, '..', 'scenarios', 'roombook');
  const s = openStore(fresh());
  for (const hex of readdirSync(join(bundle, 'artifacts', 'sha256'))) {
    assert.equal(s.putArtifact(readFileSync(join(bundle, 'artifacts', 'sha256', hex))).id, `sha256:${hex}`);
  }
  const lines = readFileSync(join(bundle, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
  s.tx(() => { for (const l of lines) { const { seq: _s, schema_version: _v, origin: _o, dataset_id: _d, ...draft } = JSON.parse(l); s.append(draft); } });
  const stored = foldAll(s.events(), s.refCheck);
  const original = foldBundle(bundle, lines.length).model;
  assert.deepEqual(describe(stored), describe(original));

  // 원문이 바뀌면 접기가 거부된다(E9)
  const hex = readdirSync(join(s.dir, 'artifacts', 'sha256'))[0];
  writeFileSync(join(s.dir, 'artifacts', 'sha256', hex), '바뀐 내용');
  assert.throws(() => foldAll(s.events(), s.refCheck), /E9/);
  s.close();
});
