// 백그라운드 Orchestrator 시험(T32-C1, Integrated 인수 기준 7): `run --detach`로 착수만 요청한 Run을 배경의 serve가 감독해
// 끝까지 진행하고, serve를 강제 종료하면 임대 만료 뒤 다음 Catena 실행이 남은 Agent 프로세스를 정리하고 Run을 감독 상실로 닫으며,
// 같은 Task를 새 Run으로 다시 시도할 수 있다(Engine 인수 기준 8과 같은 정리).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import './step.ts';

const CLI = join(import.meta.dirname, '..', 'tools', 'catena.ts');
const FAKE = JSON.stringify([process.execPath, join(import.meta.dirname, 'fixtures', 'fake-claude.mjs')]);
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pgid: number) => alive(-pgid); // Agent와 그 하위 프로세스(가짜 Agent의 sleep) 가운데 하나라도 남았는가
const plan = { project: { project_id: 'p', name: '배경 감독 시험' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [
    { id: 'A', name: '인사 파일 구현', phase: 'P1', goal: '인사 파일을 만든다', outputs: { greet: '코드' },
      conditions: [{ id: 'A-C1', method: 'auto', slot: 'greet', text: '인사 파일이 있다', verify: { command: 'test -f hello.txt' } }] },
    { id: 'B', name: '인사 확인 구현', phase: 'P1', goal: '인사 파일을 확인한다', inputs: { greet: 'A.greet' }, outputs: { check: '코드' },
      conditions: [{ id: 'B-C1', method: 'auto', slot: 'check', text: '인사 파일이 있다', verify: { command: 'test -f hello.txt' } }] },
  ] };
async function until(what: string, f: () => boolean, ms = 20_000) {
  for (const t = Date.now() + ms; !f(); await new Promise(r => setTimeout(r, 50))) if (Date.now() > t) throw new Error(`기다리던 상태가 오지 않았다: ${what}`);
}

test('T32-C1: serve가 배경에서 Run을 감독하고, 강제 종료되면 임대 만료 뒤 다음 Catena 실행이 정리하며 새 Run으로 다시 시도할 수 있다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'catena-serve-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const dir = join(base, 'store');
  const s = openStore(dir);
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  const cli = (env: Record<string, string>, ...args: string[]) => execFileSync(process.execPath, [CLI, ...args, '--store', dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  const state = (run_id: string) => (s.db.prepare('SELECT state FROM runs WHERE run_id = ?').get(run_id) as { state: string } | undefined)?.state;
  const env = (mode: string) => ({ CATENA_AGENT_COMMAND: FAKE, CATENA_LEASE_MS: '1500', FAKE_CLAUDE_MODE: mode });
  // serve를 배경으로 띄운다: 띄운 명령은 바로 끝나고(터미널과 분리), 배경 프로세스의 ID는 serve.pid에 남는다
  const startServe = (mode: string) => {
    const out = cli(env(mode), 'serve');
    assert.match(out, /serve를 배경에서 띄웠다/);
    const pid = Number(readFileSync(join(dir, 'serve.pid'), 'utf8'));
    assert.ok(alive(pid));
    return pid;
  };
  const kill = async (pid: number) => { process.kill(pid, 'SIGKILL'); await until('serve 종료', () => !alive(pid)); };

  // 1) 착수만 요청하면 Run은 대기로 남고, 배경의 serve가 끝까지 감독한다
  assert.match(cli({}, 'run', 'A', '--base-ref', git(repo, 'rev-parse', 'HEAD'), '--detach'), /A-r1: 대기/);
  assert.equal(state('A-r1'), '대기');
  let pid = startServe('ok');
  assert.throws(() => cli(env('ok'), 'serve'), /이미 serve가 돌고 있다/, '같은 저장소에 serve는 하나');
  await until('A-r1 종료', () => state('A-r1') === '종료');
  assert.ok((s.db.prepare("SELECT 1 FROM acceptances WHERE task_id = 'A'").get()), 'A 검수');
  await kill(pid);

  // 2) Agent가 일하는 도중 serve를 강제 종료한다: Agent 프로세스는 남는다
  pid = startServe('slow');
  cli({}, 'run', 'B', '--detach');
  // Agent가 출력을 내고 활동이 기록된 뒤에 끊는다(출력 전에 끊으면 Agent가 닫힌 출력 통로에 쓰다 스스로 끝나 시험 전제가 흐려진다)
  await until('B-r1 Agent 활동 기록', () => s.events().some(e => e.type === 'agent.activity' && e.payload.run_id === 'B-r1'));
  const agent = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'B-r1'").get() as any).payload).process.pgid;
  assert.equal(state('B-r1'), '실행 중');
  await kill(pid);
  assert.ok(groupAlive(agent), 'serve가 죽어도 Agent 프로세스 그룹은 남아 있다');

  // 3) 임대가 만료된 뒤 다음 Catena 실행(여기서는 CLI 질의)이 남은 프로세스 그룹을 끝내고 Run을 감독 상실로 닫는다
  await new Promise(r => setTimeout(r, 1700));
  const show = JSON.parse(cli({}, 'show', 'B', '--json'));
  assert.equal(state('B-r1'), '실패');
  await until('Agent 프로세스 그룹 정리', () => !groupAlive(agent), 5000);
  assert.deepEqual(show.data.runs.map((r: any) => [r.run_id, r.state, r.reason]), [['B-r1', '실패', '감독 상실']]);

  // 4) 같은 Task를 새 Run으로 다시 시도하고, 다시 띄운 serve가 끝까지 감독한다
  assert.match(cli({}, 'run', 'B', '--detach'), /B-r2: 대기/);
  pid = startServe('ok');
  await until('B-r2 종료', () => state('B-r2') === '종료');
  await kill(pid);
  const log = readFileSync(join(dir, 'serve.log'), 'utf8');
  assert.match(log, /A-r1: 검수/);
  assert.match(log, /B-r2: 검수/);
  assert.ok(existsSync(join(dir, 'serve.pid')));
  s.close();
});
