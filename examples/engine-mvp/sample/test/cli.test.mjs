import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const run = (...args) => spawnSync(process.execPath, ['bin/slug.mjs', ...args], { encoding: 'utf8' });

test('인자를 공백으로 이어 slug 한 줄을 출력한다', () => {
  const r = run('Hello', 'World!');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'hello-world\n');
});

test('인자가 없으면 사용법을 표준 오류로 내고 종료 코드 2로 끝낸다', () => {
  const r = run();
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /사용법/);
});
