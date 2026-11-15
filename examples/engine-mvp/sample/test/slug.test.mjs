import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.mjs';

test('영문은 소문자로, 영문·숫자가 아닌 문자가 이어지면 하이픈 하나로 바꾼다', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('Catena  Engine -- MVP!'), 'catena-engine-mvp');
  assert.equal(slugify('v0.10 release'), 'v0-10-release');
});

test('앞뒤 하이픈을 없애고, 남는 글자가 없으면 빈 문자열이다', () => {
  assert.equal(slugify('  --Trim me--  '), 'trim-me');
  assert.equal(slugify('!!!'), '');
});
