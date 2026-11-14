// 시험용 가짜 Claude Code CLI: claude -p --output-format stream-json과 같은 모양의 줄을 낸다.
// FAKE_CLAUDE_MODE: ok(작업 디렉터리에 파일을 쓰고 끝냄) / slow(하위 프로세스를 띄우고 오래 기다림) / fail(실패로 끝냄)
// FAKE_CLAUDE_ARGS: 받은 인자와 stdin을 적을 파일
// FAKE_CLAUDE_EDITS: ok 모드에서 더 할 변경 {write: {경로: 내용}, delete: [경로]}(JSON)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const prompt = readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_ARGS) writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify({ argv: process.argv.slice(2), prompt, tmpdir: process.env.TMPDIR }));
const say = o => process.stdout.write(JSON.stringify(o) + '\n');
const model = process.argv[process.argv.indexOf('--model') + 1] ?? 'default';
say({ type: 'system', subtype: 'init', model, session_id: 'fake-session', tools: ['Write'], apiKeySource: process.env.FAKE_CLAUDE_KEYSOURCE ?? 'none' });
// FAKE_CLAUDE_RATE=rejected: 구독 사용 한도에 닿았다는 신호를 보낸다
if (process.env.FAKE_CLAUDE_RATE) say({ type: 'rate_limit_event', rate_limit_info: { status: process.env.FAKE_CLAUDE_RATE } });
if (mode === 'ok') {
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'hello.txt', content: '안녕' } }] } });
  writeFileSync('hello.txt', '안녕\n');
  const edits = JSON.parse(process.env.FAKE_CLAUDE_EDITS ?? '{}');
  for (const [p, c] of Object.entries(edits.write ?? {})) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
  for (const p of edits.delete ?? []) rmSync(p);
  say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: '구현을 마쳤고 모든 테스트를 통과했습니다.' }] } });
  say({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.12, usage: { input_tokens: 100, output_tokens: 50 } });
} else if (mode === 'plan') {
  say({ type: 'assistant', message: { content: [{ type: 'text', text: '계획을 만들었습니다.' }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: process.env.FAKE_PLAN ?? '', total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });
} else if (mode === 'slow') {
  spawn('sleep', ['120'], { stdio: 'ignore' }); // 같은 프로세스 그룹에 남는 하위 프로세스
  say({ type: 'assistant', message: { content: [{ type: 'text', text: '작업을 시작합니다.' }] } });
  setInterval(() => {}, 1000);
} else {
  say({ type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.03 });
  process.exit(1);
}
