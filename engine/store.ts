// Project 저장소(14-3, B-1~B-3): SQLite 파일 하나(WAL)에 소유 Core별 테이블과 append-only 이벤트 테이블,
// 내용 해시 산출물 파일을 둔다. Node 내장 node:sqlite를 쓴다(14-3의 드라이버 결정).
// 쓰기는 BEGIN IMMEDIATE 트랜잭션으로 직렬화하고(0-6), 이벤트 seq는 그 트랜잭션 안에서 매긴다.
// 불변 기록은 BEFORE UPDATE·DELETE trigger로 거부한다. 같은 사용자 권한의 프로세스를 막지는 못한다(0-5).
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkStream, type Event, type Ref } from '../tools/readmodel.ts';

export const SCHEMA_VERSION = 1;

/** 사용자 데이터 디렉터리 안의 Project별 폴더(14-3). 저장소 작업 트리 밖이다. */
export const defaultStoreDir = (projectId: string) => join(homedir(), '.catena', 'projects', projectId);

// 불변 기록(14-3): 만든 뒤 수정·삭제할 수 없다. 승인은 요청과 결정을 따로 남긴다(결정도 바뀌지 않는다).
export const IMMUTABLE = ['contracts', 'baselines', 'submissions', 'evidence', 'acceptances', 'approval_requests', 'approval_decisions', 'events', 'commands'];

const SCHEMA = `
-- Planning
CREATE TABLE IF NOT EXISTS projects (project_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wbs_nodes (node_id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT NOT NULL, lifecycle TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contracts (task_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (task_id, version));
CREATE TABLE IF NOT EXISTS dependencies (to_task TEXT NOT NULL, to_slot TEXT NOT NULL, from_task TEXT, from_slot TEXT, payload TEXT NOT NULL, PRIMARY KEY (to_task, to_slot));
CREATE TABLE IF NOT EXISTS milestones (milestone_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
-- D · Version & Provenance
CREATE TABLE IF NOT EXISTS baselines (baseline_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
-- Resource
CREATE TABLE IF NOT EXISTS tickets (ticket_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
-- Execution
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, attempt INTEGER NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE (task_id, attempt));
-- Task마다 끝나지 않은 Run은 하나뿐이다. 여러 프로세스가 동시에 착수를 요청해도 이 유일 제약이 지킨다(6-1)
CREATE UNIQUE INDEX IF NOT EXISTS runs_one_open ON runs(task_id) WHERE state IN ('대기', '실행 중', '일시 중단', '결과 불명');
CREATE TABLE IF NOT EXISTS run_leases (run_id TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (submission_id TEXT PRIMARY KEY, run_id TEXT, payload TEXT NOT NULL);
-- Validation & Acceptance
CREATE TABLE IF NOT EXISTS evidence (evidence_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS acceptances (acceptance_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, payload TEXT NOT NULL);
-- Policy & Authorization
CREATE TABLE IF NOT EXISTS approval_requests (approval_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approval_decisions (approval_id TEXT PRIMARY KEY REFERENCES approval_requests(approval_id), payload TEXT NOT NULL);
-- B · 이벤트(ExecutionEvent, 형식은 읽기 모델과 같다)
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
-- 명령 기록: 성공한 명령마다 남긴 이벤트 범위, 요청 주체, 채널(0-10). 실패한 명령은 남기지 않는다
CREATE TABLE IF NOT EXISTS commands (seq_from INTEGER NOT NULL, seq_to INTEGER NOT NULL, command TEXT NOT NULL, principal TEXT NOT NULL, channel TEXT NOT NULL, args_hash TEXT NOT NULL, at TEXT NOT NULL);
${IMMUTABLE.map(t => `
CREATE TRIGGER IF NOT EXISTS ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, '불변 기록: ${t}은 수정할 수 없다'); END;
CREATE TRIGGER IF NOT EXISTS ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '불변 기록: ${t}은 삭제할 수 없다'); END;`).join('')}
`;

/** 새 이벤트 초안. seq, event_id, schema_version, origin은 저장소가 정한다. */
export type EventDraft = Omit<Event, 'seq' | 'event_id' | 'schema_version' | 'origin' | 'dataset_id'> & { event_id?: string };

export function openStore(dir: string) {
  mkdirSync(join(dir, 'artifacts', 'sha256'), { recursive: true });
  const db = new DatabaseSync(join(dir, 'catena.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
  const ver = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (ver > SCHEMA_VERSION) throw new Error(`저장소 형식 ${ver}은 이 Catena(${SCHEMA_VERSION})보다 새롭다`);
  db.exec(`BEGIN IMMEDIATE; ${SCHEMA} PRAGMA user_version = ${SCHEMA_VERSION}; COMMIT;`);

  const nextSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM events');
  const insertEvent = db.prepare('INSERT INTO events (seq, event_id, body) VALUES (?, ?, ?)');
  const artifactPath = (hex: string) => join(dir, 'artifacts', 'sha256', hex);

  /** 쓰기 트랜잭션. 처음부터 쓰기 잠금을 잡고(BEGIN IMMEDIATE), 예외가 나면 아무것도 남기지 않는다. */
  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /** 이벤트 하나를 덧붙인다. 상태를 바꾸는 같은 트랜잭션(tx) 안에서 부른다. */
  function append(d: EventDraft): Event {
    if (!db.isTransaction) throw new Error('append는 쓰기 트랜잭션(tx) 안에서만 부른다');
    const { n } = nextSeq.get() as { n: number };
    const e: Event = { ...d, event_id: d.event_id ?? randomUUID(), seq: n, schema_version: 1, origin: 'live' };
    insertEvent.run(e.seq, e.event_id, JSON.stringify(e));
    return e;
  }

  /** 저장된 이벤트 전체를 seq 순서로. 읽기 모델의 입력 검사(E1, E10)를 거친다. */
  function events(): Event[] {
    const rows = db.prepare('SELECT body FROM events ORDER BY seq').all() as { body: string }[];
    return checkStream({ origin: 'live', schema_version: 1 }, rows.map(r => r.body));
  }

  /** 산출물을 내용 해시 파일로 쓴다. 파일을 먼저 디스크에 반영한 뒤 참조를 돌려준다(14-3 쓰기 순서). */
  function putArtifact(bytes: Uint8Array | string): Ref {
    const buf = typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes);
    const hex = createHash('sha256').update(buf).digest('hex');
    const path = artifactPath(hex);
    if (!existsSync(path)) {
      const tmp = `${path}.${process.pid}.tmp`;
      const fd = openSync(tmp, 'w');
      try {
        writeSync(fd, buf);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, path);
    }
    return { kind: 'artifact', id: `sha256:${hex}`, version: 1 };
  }

  /** 읽기 모델의 원문 확인(refCheck). 파일이 없거나 내용이 해시와 다르면 이유를 돌려준다. */
  function refCheck(r: Ref): string | undefined {
    const hex = r.id.slice(7);
    const path = artifactPath(hex);
    if (!existsSync(path)) return '원문 파일 없음';
    if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hex) return '해시 불일치';
  }

  return { dir, db, tx, append, events, putArtifact, refCheck, close: () => db.close() };
}

export type Store = ReturnType<typeof openStore>;
