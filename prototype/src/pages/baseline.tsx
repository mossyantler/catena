// 사용자 시험의 비교 기준(core spec 13장 「사용자 시험」): 같은 묶음을 Task 목록과 실행 로그로만 보여 준다.
// Catena의 해석(대표 상태, 차단 이유, 해소 행동, 공정표, 집계, 결정할 일, 상태 색)은 넣지 않는다.
// Task 목록은 계획에 적힌 값(WBS 위치, Phase, 선언된 입력, 완료 조건)이고, 로그는 이벤트 원문이다.
import { useState } from 'react'

import { PageHeader, Section } from '@/components/page'
import { RawButton } from '@/components/raw-viewer'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import * as RM from '@/lib/rm'
import { when } from '@/lib/status'
import { useCatena } from '@/lib/store'

// 원문 참조는 짧은 표시로 바꾸고, 줄 아래 원문 보기 버튼으로 연다.
const payloadText = (p: unknown) =>
  JSON.stringify(p, (_, v) => (v && typeof v === 'object' && v.kind === 'artifact' ? `[원문 ${v.id.slice(7, 15)}]` : v))

export function BaselinePage() {
  const { bundle, model, pos, nameOf, phaseName } = useCatena()
  const [q, setQ] = useState('')
  const m = bundle.manifest
  const tasks = [...model.nodes.values()].filter((n) => n.kind === 'task').sort((a, b) => a.id.localeCompare(b.id))
  const events = bundle.events.slice(0, pos)
  const shown = q ? events.filter((e) => JSON.stringify(e).toLowerCase().includes(q.toLowerCase())) : events
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow={model.project.name}
        title="Task 목록과 실행 로그"
        description="계획에 적힌 Task와 실행 기록을 그대로 보여 줍니다."
        actions={
          <Badge variant="wait" title={m.description}>
            {m.origin === 'simulated' ? '시뮬레이션 데이터' : '기록 재생'} · {m.dataset_id}
          </Badge>
        }
      />
      <Section title={`Task ${tasks.length}개`} description="ID 순서입니다. 입력은 계획에서 선언한 공급 Task와 슬롯입니다.">
        <Table>
          <TableHeader>
            <TableRow>
              {['ID', '이름', '상위 항목', 'Phase', '입력(공급 Task.슬롯)', '완료 조건'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((n) => {
              const c = model.contracts.get(n.id)
              const inputs = model.deps.filter((d) => d.to.task_id === n.id)
              return (
                <TableRow key={n.id} className="align-top">
                  <TableCell>
                    <span className="font-mono">{n.id}</span>
                  </TableCell>
                  <TableCell>
                    {n.name}
                    {n.lifecycle !== '활성' ? ` (${n.lifecycle})` : ''}
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">{RM.path(model, n.id).slice(0, -1).map(nameOf).join(' / ') || '-'}</span>
                  </TableCell>
                  <TableCell>{phaseName(n.phase) ?? '-'}</TableCell>
                  <TableCell className="min-w-40 whitespace-normal">
                    {inputs.map((d) => (
                      <div key={d.to.slot} className="font-mono text-xs">
                        {d.from.external_ref ? `외부 입력 → ${d.to.slot}` : `${d.from.task_id}.${d.from.slot}`}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="min-w-72 whitespace-normal">
                    {(c?.conditions ?? []).map((x: any) => (
                      <div key={x.condition_id} className="text-xs">
                        <span className="font-mono">{x.condition_id}</span> {x.description}
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Section>
      <Section
        title="실행 로그"
        description={`기록된 이벤트 ${events.length}건${q ? ` 중 ${shown.length}건` : ''}, 오래된 것부터. 시각은 ${m.origin === 'simulated' ? '가상 시각입니다' : '기록 시각입니다'}.`}
        action={<Input className="w-48 sm:w-64" placeholder="로그 거르기 (예: T03, 실패)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="로그 거르기" />}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {['#', '시각', '종류', '기록 주체', '대상', '내용'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e) => (
              <TableRow key={e.seq} className="align-top">
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{e.seq}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{when(e.occurred_at)}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{e.type}</span>
                </TableCell>
                <TableCell>
                  <span className="text-xs">{[e.actor.role, e.actor.instance].filter(Boolean).join(' ')}</span>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">{e.subject}</span>
                </TableCell>
                <TableCell className="min-w-80 whitespace-normal">
                  <p className="font-mono text-xs break-all whitespace-pre-wrap">{payloadText(e.payload)}</p>
                  {RM.refsOf([e]).map((r) => (
                    <div key={r.id}>
                      <RawButton refId={r} title={`#${e.seq} ${e.type} 원문`} label={`원문 보기 ${r.id.slice(7, 15)}`} />
                    </div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </main>
  )
}
