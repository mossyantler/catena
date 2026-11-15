// 실시간 화면용 읽기 전용 API(T30, B-7): Project 저장소(기본 ~/.catena/projects/<project_id>)의 이벤트와 원문을
// 데이터 묶음과 같은 모양으로 내준다. 화면은 같은 검사(checkStream, foldAll)와 같은 읽기 모델로 그린다.
// 저장소에는 쓰지 않는다(읽기 전용 연결). 개발 서버·미리보기 서버(vite.config.ts)와 첨삭 서버가 함께 쓴다.
//   GET live/index.json                       → { projects: [project_id] }
//   GET live/<id>/dataset.json                → { origin: 'live', schema_version, project_id }
//   GET live/<id>/events.jsonl[?after=N]      → seq가 N보다 큰 이벤트(한 줄에 하나)
//   GET live/<id>/artifacts/sha256/<hex>      → 원문
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function createLiveApi(root = join(homedir(), '.catena', 'projects')) {
  const db = (id: string) => join(root, id, 'catena.db');
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const m = url.pathname.match(/\/live\/(?:index\.json|([^/]+)\/(dataset\.json|events\.jsonl|artifacts\/sha256\/([0-9a-f]{64})))$/);
    if (req.method !== 'GET' || !m) return next();
    const send = (status: number, type: string, body: string | Buffer) => { res.statusCode = status; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store'); res.end(body); };
    const [, id, what, hex] = m;
    if (!id) {
      const projects = existsSync(root) ? readdirSync(root).filter(n => ID.test(n) && existsSync(db(n))).sort() : [];
      return send(200, 'application/json', JSON.stringify({ projects }));
    }
    if (!ID.test(id) || !existsSync(db(id))) return send(404, 'text/plain; charset=utf-8', `Project 저장소가 없다: ${id}`);
    if (what === 'dataset.json') return send(200, 'application/json', JSON.stringify({ origin: 'live', schema_version: 1, project_id: id }));
    if (hex) {
      const f = join(root, id, 'artifacts', 'sha256', hex);
      return existsSync(f) ? send(200, 'application/octet-stream', readFileSync(f)) : send(404, 'text/plain; charset=utf-8', '원문 파일 없음');
    }
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!Number.isInteger(after) || after < 0) return send(400, 'text/plain; charset=utf-8', `after는 0 이상의 정수다: ${url.searchParams.get('after')}`);
    const d = new DatabaseSync(db(id), { readOnly: true });
    try {
      const rows = d.prepare('SELECT body FROM events WHERE seq > ? ORDER BY seq').all(after) as { body: string }[];
      send(200, 'application/x-ndjson; charset=utf-8', rows.map(r => r.body).join('\n') + (rows.length ? '\n' : ''));
    } finally { d.close(); }
  };
}
