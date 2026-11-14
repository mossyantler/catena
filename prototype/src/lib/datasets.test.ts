// 프로젝트 목록 시험(T28-C1): data/index.json의 항목이 모두 있고 검사를 통과해 읽히며, data/의 묶음이 목록에서 빠지지 않는다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldBundle } from '../../../tools/fold.ts'
import { loadPlan } from '../../../tools/plan.ts'

const DATA = join(import.meta.dirname, '..', '..', 'public', 'data')

test('T28-C1: 프로젝트 목록의 묶음이 모두 검사를 통과해 읽히고, data/의 묶음이 목록에서 빠지지 않는다', () => {
  const { datasets } = JSON.parse(readFileSync(join(DATA, 'index.json'), 'utf8')) as { datasets: string[] }
  assert.deepEqual([...datasets].sort(), readdirSync(DATA).filter((f) => f !== 'index.json').sort(), '목록과 data/ 폴더가 같다')
  for (const name of datasets) {
    const dir = join(DATA, name)
    const manifest = JSON.parse(readFileSync(join(dir, 'dataset.json'), 'utf8'))
    const model = manifest.origin === 'plan' ? loadPlan(dir).model : foldBundle(dir).model
    assert.ok(model.project?.name, `${name}: 프로젝트 이름`)
    assert.ok(['simulated', 'recorded', 'plan'].includes(manifest.origin), `${name}: 출처 ${manifest.origin}`)
  }
})
