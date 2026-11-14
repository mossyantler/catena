// Claude Code Runner(Runner 명세 v0.4 R-4, R-6, R-7): claude -p를 사용자 설정 그대로 띄우고(권한 모드는 Project 설정),
// stream-json 출력을 ExecutionEvent 초안으로 바꾼다. Agent의 행위는 막지 않는다(Core 명세 0-5).
// Runtime이 낸 도구 호출과 메시지는 Agent 보고이며 증거가 아니다(0-4). Catena가 직접 본 것(프로세스 종료, 원문 저장)만 시스템 기록이다.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realProcs } from './supervise.ts';

export type LaunchSpec = { command: string[]; argv: string[]; env: NodeJS.ProcessEnv; cwd: string; stdin: string };

/** R-4 prepare. command는 실행 파일과 앞쪽 인자다(기본 ['claude'], 시험에서는 가짜 CLI). */
export function prepare(x: {
  command?: string[]; worktree: string; tmpDir: string; prompt: string; runId?: string;
  permissionMode: string; maxTurns: number; model?: string | null; budgetUsd?: number | null;
}): LaunchSpec {
  const argv = [
    '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-mode', x.permissionMode, '--max-turns', String(x.maxTurns),
    ...(x.model ? ['--model', x.model] : []),
    // 클라이언트 추정치라 넘을 수 있으므로 예약액보다 낮게 준다(5-3). API 키 인증일 때만 뜻이 있다
    ...(x.budgetUsd ? ['--max-budget-usd', (x.budgetUsd * 0.9).toFixed(2)] : []),
  ];
  // 사용자 환경을 그대로 상속한다. 바꾸는 것은 Run 전용 TMPDIR과 백그라운드 대기 상한뿐이다(R-6.1)
  // CATENA_RUN_ID: Agent 안에서 catena를 부르면 Runner 채널로 알아본다(승인 거부, 9-10)
  const env = { ...process.env, TMPDIR: x.tmpDir, CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '5000', ...(x.runId ? { CATENA_RUN_ID: x.runId } : {}) };
  return { command: x.command ?? ['claude'], argv, env, cwd: x.worktree, stdin: x.prompt };
}

export type Handle = { child: ChildProcessWithoutNullStreams; pgid: number; started_at: string; exit: Promise<number | null> };

/** R-4 start: 새 프로세스 그룹으로 띄우고 prompt를 stdin으로 넘긴다. */
export function start(spec: LaunchSpec): Handle {
  const [bin, ...pre] = spec.command;
  const child = spawn(bin, [...pre, ...spec.argv], { cwd: spec.cwd, env: spec.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(spec.stdin);
  const exit = new Promise<number | null>(r => child.on('close', code => r(code)));
  return { child, pgid: child.pid!, started_at: realProcs.startTime(child.pid!) ?? '', exit };
}

/** R-4 stop: 프로세스 그룹 전체를 끝내고 끝났는지 확인한다. */
export const stop = (h: Handle) => realProcs.killGroup(h.pgid);

export type Draft =
  | { type: 'agent.activity'; payload: { kind: '도구 호출' | '메시지'; summary: string; source: 'Agent 보고' } }
  | { type: 'init'; payload: { model?: string; session_id?: string; apiKeySource?: string } }
  | { type: 'result'; payload: { ok: boolean; subtype?: string; cost_usd?: number; tokens?: number } } // cost_usd: 보고하지 않는 Runtime(Codex)은 없음
  | { type: 'rate_limit'; payload: { status?: string } };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** R-7: stream-json 한 줄(객체)을 이벤트 초안으로. 표에 없는 종류는 버리고 원문(transcript)에만 남긴다. */
export function normalize(msg: any): Draft[] {
  if (!msg || typeof msg !== 'object') return [];
  // apiKeySource는 인증 방식의 이름뿐이다(none이면 구독 로그인). 자격증명 값은 읽지 않는다
  if (msg.type === 'system' && msg.subtype === 'init') return [{ type: 'init', payload: { model: msg.model, session_id: msg.session_id, ...(msg.apiKeySource ? { apiKeySource: msg.apiKeySource } : {}) } }];
  if (msg.type === 'assistant') {
    const out: Draft[] = [];
    for (const c of msg.message?.content ?? []) {
      if (c?.type === 'tool_use') out.push({ type: 'agent.activity', payload: { kind: '도구 호출', summary: clip(`${c.name} ${JSON.stringify(c.input ?? {})}`, 160), source: 'Agent 보고' } });
      else if (c?.type === 'text' && c.text?.trim()) out.push({ type: 'agent.activity', payload: { kind: '메시지', summary: clip(c.text.trim(), 200), source: 'Agent 보고' } });
    }
    return out;
  }
  if (msg.type === 'result') {
    const u = msg.usage ?? {};
    const tokens = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((n, k) => n + (Number(u[k]) || 0), 0);
    return [{ type: 'result', payload: { ok: msg.subtype === 'success' && !msg.is_error, subtype: msg.subtype, cost_usd: Number(msg.total_cost_usd) || 0, tokens: tokens || undefined } }];
  }
  if (msg.type === 'rate_limit_event') return [{ type: 'rate_limit', payload: { status: msg.status ?? msg.rate_limit_info?.status } }];
  return [];
}

/** 표준 출력을 줄 단위 JSON으로 읽는다. 원문은 그대로 모아 둔다(R-3 3). */
export async function* lines(h: Handle, raw: Buffer[]): AsyncGenerator<any> {
  let buf = '';
  for await (const chunk of h.child.stdout as AsyncIterable<Buffer>) {
    raw.push(chunk);
    buf += chunk.toString('utf8');
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const line = buf.slice(0, i).trim();
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* JSON이 아닌 줄은 원문에만 남긴다 */ }
    }
  }
}
