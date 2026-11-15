// Codex 실행기(T37, 14-14 결정: Runtime별 CLI 직접 실행): codex exec --json을 Run 전용 worktree에서 사용자 설정 그대로 띄우고,
// JSONL 이벤트를 Claude Code 실행기와 같은 활동 기록 초안으로 바꾼다. 도구 호출과 메시지는 Agent 보고다(0-4).
// Codex는 비용을 보고하지 않으므로 사용량은 토큰만 남는다(5-7).
import { clip, type Draft, type LaunchSpec } from './runner.ts';

export function prepareCodex(x: { command?: string[]; worktree: string; tmpDir: string; prompt: string; model?: string | null; runId?: string }): LaunchSpec {
  const argv = ['exec', '--json', '--ephemeral', '-C', x.worktree, '-s', 'workspace-write', ...(x.model ? ['-m', x.model] : []), '-'];
  const env = { ...process.env, TMPDIR: x.tmpDir, ...(x.runId ? { CATENA_RUN_ID: x.runId } : {}) };
  return { command: x.command ?? ['codex'], argv, env, cwd: x.worktree, stdin: x.prompt };
}

const report = (kind: '도구 호출' | '메시지', summary: string): Draft => ({ type: 'agent.activity', payload: { kind, summary, source: 'Agent 보고' } });

/** codex exec --json 한 줄(객체)을 이벤트 초안으로. 끝난 항목(item.completed)만 기록하고, 표에 없는 종류는 원문에만 남긴다. */
export function normalizeCodex(msg: any): Draft[] {
  if (!msg || typeof msg !== 'object') return [];
  if (msg.type === 'thread.started') return [{ type: 'init', payload: { session_id: msg.thread_id } }];
  if (msg.type === 'turn.completed') {
    const u = msg.usage ?? {};
    // cached_input_tokens는 input_tokens에, reasoning_output_tokens는 output_tokens에 이미 들어 있다(codex-cli 0.167.2 실제 출력으로 확인)
    const tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
    return [{ type: 'result', payload: { ok: true, subtype: 'turn.completed', tokens: tokens || undefined } }];
  }
  if (msg.type === 'turn.failed' || msg.type === 'error') return [{ type: 'result', payload: { ok: false, subtype: msg.type } }];
  if (msg.type !== 'item.completed' || !msg.item) return [];
  const it = msg.item;
  switch (it.type) {
    case 'agent_message': return it.text?.trim() ? [report('메시지', clip(it.text.trim(), 200))] : [];
    case 'command_execution': return [report('도구 호출', clip(`명령 ${it.command ?? ''}${it.exit_code !== undefined ? ` (종료 코드 ${it.exit_code})` : ''}`, 160))];
    case 'file_change': return [report('도구 호출', clip(`파일 변경 ${(it.changes ?? []).map((c: any) => `${c.kind ?? ''} ${c.path ?? ''}`.trim()).join(', ')}`, 160))];
    case 'mcp_tool_call': return [report('도구 호출', clip(`${it.server ?? 'mcp'}.${it.tool ?? ''}`, 160))];
    case 'web_search': return [report('도구 호출', clip(`웹 검색 ${it.query ?? ''}`, 160))];
    default: return [];
  }
}
