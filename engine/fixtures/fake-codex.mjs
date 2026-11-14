// 시험용 가짜 Codex CLI: codex exec --json과 같은 모양의 JSONL을 낸다.
// FAKE_CODEX_MODE: ok(작업 디렉터리에 파일을 쓰고 끝냄) / fail(턴 실패로 끝냄)
// FAKE_CODEX_ARGS: 받은 인자와 stdin을 적을 파일
import { readFileSync, writeFileSync } from 'node:fs';

const mode = process.env.FAKE_CODEX_MODE ?? 'ok';
const prompt = readFileSync(0, 'utf8');
if (process.env.FAKE_CODEX_ARGS) writeFileSync(process.env.FAKE_CODEX_ARGS, JSON.stringify({ argv: process.argv.slice(2), prompt, tmpdir: process.env.TMPDIR }));
const say = o => process.stdout.write(JSON.stringify(o) + '\n');
say({ type: 'thread.started', thread_id: 'fake-thread' });
say({ type: 'turn.started' });
if (mode === 'ok') {
  say({ type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' } });
  say({ type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'bash -lc ls', aggregated_output: 'README.md\n', exit_code: 0, status: 'completed' } });
  writeFileSync('hello.txt', '안녕\n');
  say({ type: 'item.completed', item: { id: 'item_1', type: 'file_change', changes: [{ path: 'hello.txt', kind: 'add' }], status: 'completed' } });
  say({ type: 'item.completed', item: { id: 'item_2', type: 'reasoning', text: '파일을 만들자' } });
  say({ type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: '인사 파일을 만들었고 테스트를 통과했습니다.' } });
  say({ type: 'turn.completed', usage: { input_tokens: 200, cached_input_tokens: 50, output_tokens: 30 } });
} else if (mode === 'plan') {
  say({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: process.env.FAKE_PLAN ?? '' } });
  say({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } });
} else {
  say({ type: 'turn.failed', error: { message: '모의 실패' } });
  process.exit(1);
}
