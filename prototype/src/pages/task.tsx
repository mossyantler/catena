// Task 상세(C-8, Q2·Q4·Q8): 상태, 완료 조건과 증거, 슬롯과 의존, 실행 기록, 제출 기록, 계약.
import type { ReactNode } from 'react'

import { KeyValues, Notice, PageHeader, Section, SubTitle } from '@/components/page'
import { RawButton } from '@/components/raw-viewer'
import { StageTag, StatusBadge, Tid } from '@/components/status'
import { CondCount, PhaseTag, TaskState, useCard } from '@/components/task'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import * as RM from '@/lib/rm'
import { hm, issuerLabel, profText, waitHref, waitLabel, when } from '@/lib/status'
import { useCatena } from '@/lib/store'

function Tbl({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {head.map((h) => (
            <TableHead key={h}>{h}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

const TaskLink = ({ id }: { id: string }) => {
  const { nameOf } = useCatena()
  return (
    <a href={`#task-${id}`} className="underline-offset-4 hover:underline">
      <Tid id={id} /> {nameOf(id)}
    </a>
  )
}

export function TaskPage({ id }: { id: string }) {
  const { model, node } = useCatena()
  const n = node(id)
  if (!n || n.kind !== 'task') return <Notice>찾을 수 없는 Task입니다.</Notice>
  if (RM.CLOSED.includes(n.lifecycle))
    return (
      <>
        <PageHeader title={<><Tid id={id} /> {n.name}</>} tabTitle={`${id} ${n.name}`} description={n.closedReason ?? ''} />
        <Notice>닫힌 Task({n.lifecycle})는 기본 화면에서 숨깁니다. 기록은 이 ID에 남습니다.</Notice>
      </>
    )
  const c = model.contracts.get(id)
  if (!c)
    return (
      <>
        <PageHeader title={<><Tid id={id} /> {n.name}</>} tabTitle={`${id} ${n.name}`} />
        <Notice>Task 명세가 아직 확정되지 않았습니다(계획 중).</Notice>
      </>
    )
  return <TaskDetail id={id} />
}

function TaskDetail({ id }: { id: string }) {
  const { model, node, bundle } = useCatena()
  const hand = bundle.accepted?.find((a) => a.task_id === id) // 계획 파일의 사람 인수 기록
  const n = node(id)
  const c = model.contracts.get(id)
  const { c: card } = useCard(id)
  const openAppr = [...model.approvals.values()].filter((a) => a.task === id && !a.decision)
  const runs = [...model.runs.values()].filter((r) => r.task === id).sort((a, b) => a.attempt - b.attempt)
  const subs = [...model.submissions.values()].filter((s) => s.task === id)
  const cost = model.usage.filter((u) => u.task === id).reduce((s, u) => s + u.cost, 0)
  const wf = model.workflows.get(id)
  const rework = new Map(RM.rework(model, id).map((x) => [x.run_id, x]))
  return (
    <>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Task 상세 <PhaseTag phase={n.phase} /></span>}
        title={<><Tid id={id} /> {n.name}</>}
        tabTitle={`${id} ${n.name}`}
        actions={
          <>
            {/* Agent 그래프는 Task를 시작할 때 워크플로우가 정해져야 생긴다(6-1) */}
            {model.workflows.has(id) ? (
              <Button asChild>
                <a href={`#agent-${id}`}>Agent 그래프</a>
              </Button>
            ) : null}
            {openAppr.map((a) => (
              <Button key={a.approval_id} asChild variant="outline">
                <a href={`#approval-${a.approval_id}`}>승인 요청 {a.approval_id} 열기</a>
              </Button>
            ))}
            <Button asChild variant="outline">
              <a href="#dag">작업 네트워크에서 보기</a>
            </Button>
          </>
        }
      />
      <Section title="지금 상태">
        <KeyValues
          items={[
            ['작업 상태', <TaskState key="state" id={id} />],
            ['완료 조건', <CondCount key="cond" id={id} />],
            [
              '보류 사유',
              card.waits.length
                ? card.waits.map((w) => (
                    <div key={w.id} className="flex flex-wrap items-center gap-2">
                      <StatusBadge state={waitLabel(w)} tone={w.action.actor === '사용자' ? 'user' : 'wait'} />
                      {w.resolve}
                      <span className="text-xs text-muted-foreground">
                        {issuerLabel(w.issuer)}
                        {w.raised_at ? ` · ${when(w.raised_at)}부터` : ''}
                      </span>
                    </div>
                  ))
                : '없음',
            ],
            [
              '할 일',
              card.waits.length
                ? card.waits.map((w) => (
                    <div key={w.id}>
                      {w.action.actor}: {w.action.text}{' '}
                      {/* 지금 보고 있는 Task 상세로 가는 링크는 뺀다 */}
                      {waitHref(id, w) === `#task-${id}` ? null : (
                        <a href={waitHref(id, w)} className="underline-offset-4 hover:underline">
                          {w.action.screen} 열기
                        </a>
                      )}
                    </div>
                  ))
                : '없음',
            ],
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['실행 상태 (최근 실행)', <StatusBadge key="exec" state={card.exec === '없음' ? '실행 없음' : card.exec} />],
            ['검수 상태 (Task 전체)', <StatusBadge key="acc" state={card.acceptance} tone={card.acceptance === '미인수' ? 'muted' : undefined} />],
            ['실행 중인 단계', card.stages.length ? card.stages.map((s: string) => <StageTag key={s} stage={s} />) : '없음'],
          ].map(([k, v], i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-lg border px-3 py-2.5">
              <span className="text-xs text-muted-foreground">{k}</span>
              <span className="flex flex-wrap gap-1">{v}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="완료 조건과 검수 근거">
        <Tbl head={['ID', '조건', '항목', '확인 방법', '상태', '근거']}>
          {c.conditions.map((cd: any) => {
            const evs = [...model.evidence.values()].filter((e) => e.task === id && e.condition_id === cd.condition_id)
            const last = evs.at(-1)
            return (
              <TableRow key={cd.condition_id}>
                <TableCell><span className="font-mono">{cd.condition_id}</span></TableCell>
                <TableCell className="min-w-48 whitespace-normal">{cd.description}</TableCell>
                <TableCell><span className="font-mono">{cd.slot ?? 'Task 전체'}</span></TableCell>
                <TableCell>{cd.method === 'auto' ? '자동 검사' : '사용자 승인'}</TableCell>
                <TableCell>
                  <StatusBadge state={RM.conditionState(model, id, cd.condition_id)} />
                </TableCell>
                <TableCell>
                  {last ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <StatusBadge state={last.result} />
                      <span className="font-mono text-xs">{last.evidence_id}</span>
                      <RawButton refId={last.raw_log_ref} title={`${last.evidence_id} 검사 로그`} label="로그 보기" />
                      {evs.length > 1 ? <span className="text-xs text-muted-foreground">(검사 {evs.length}회)</span> : null}
                    </span>
                  ) : hand?.evidence[cd.condition_id] ? (
                    <span className="block min-w-60 whitespace-normal">
                      {hand.evidence[cd.condition_id]}
                      <span className="block text-xs text-muted-foreground">
                        검수 기록 · {hand.approved_at} · {hand.channel}
                      </span>
                    </span>
                  ) : cd.method === 'auto' ? (
                    '검수 근거 없음'
                  ) : (
                    '사용자 승인 필요'
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </Tbl>
      </Section>

      <Section title="입력 및 출력">
        <SubTitle>입력 항목</SubTitle>
        <Tbl head={['항목', '선행 Task', '상태']}>
          {c.input_slots.length ? (
            c.input_slots.map((s: any) => {
              const d = model.deps.find((x) => x.to.task_id === id && x.to.slot === s.name)
              const ok = d && !d.from.external_ref && model.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)
              return (
                <TableRow key={s.name}>
                  <TableCell><span className="font-mono">{s.name}</span></TableCell>
                  <TableCell>
                    {!d ? '선행 Task가 정해지지 않음' : d.from.external_ref ? <>사용자가 직접 넣은 입력 <RawButton refId={d.from.external_ref} title={`${s.name} 초기 입력`} /></> : <><TaskLink id={d.from.task_id} /> · <span className="font-mono">{d.from.slot}</span></>}
                  </TableCell>
                  <TableCell>{!d ? <StatusBadge state="대기" /> : d.from.external_ref ? <StatusBadge state="사용 가능" /> : <StatusBadge state={ok ? '인수됨' : '인수 전'} />}</TableCell>
                </TableRow>
              )
            })
          ) : (
            <TableRow>
              <TableCell colSpan={3}>입력 없음</TableCell>
            </TableRow>
          )}
        </Tbl>
        <SubTitle>결과 항목</SubTitle>
        <Tbl head={['항목', '후행 Task', '상태']}>
          {c.output_slots.map((s: any) => {
            const users = model.deps.filter((x) => x.from.task_id === id && x.from.slot === s.name)
            const ok = model.slotAccepted.has(`${id}/${s.name}`)
            return (
              <TableRow key={s.name}>
                <TableCell><span className="font-mono">{s.name}</span></TableCell>
                <TableCell className="whitespace-normal">
                  {users.length
                    ? users.map((x, i) => (
                        <span key={x.to.task_id}>
                          {i ? ', ' : ''}
                          <TaskLink id={x.to.task_id} />
                        </span>
                      ))
                    : '후행 Task 없음'}
                </TableCell>
                <TableCell>
                  <StatusBadge state={ok ? '인수됨' : '인수 전'} tone={ok ? undefined : 'muted'} />
                </TableCell>
              </TableRow>
            )
          })}
        </Tbl>
      </Section>

      <Section title="실행 기록">
        {runs.length ? (
          runs.map((r) => {
            const x = rework.get(r.id)!
            const logs = model.nodeLog.filter((l) => l.run === r.id)
            return (
              <div key={r.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-strong">{r.id}</span>
                  <span className="text-muted-foreground">실행 {r.attempt}회차</span>
                  <StatusBadge state={r.state} />
                  {r.reason ? <span className="text-xs text-muted-foreground">{r.reason}</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Agent {x.round}회차{x.round > 1 ? ` · 수정 ${x.round - 1}회` : ''}
                  {x.failed.length ? ` · 통과 못 한 검사: ${x.failed.map((f: any) => `${f.condition_id} ${f.result}(${f.evidence_id})`).join(', ')}` : ''}
                </p>
                <Tbl head={['노드', '단계', '회차', '담당', '시작–끝', '결과']}>
                  {logs.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell>{wf.nodes.get(l.node).name}</TableCell>
                      <TableCell>
                        <StageTag stage={wf.nodes.get(l.node).stage} />
                      </TableCell>
                      <TableCell><span className="font-mono">{l.iteration}</span></TableCell>
                      <TableCell>
                        {l.actor.role ?? ''} <span className="font-mono">{l.actor.instance}</span>
                        {l.profile ? <span className="block text-xs text-muted-foreground">{profText(l.profile)}</span> : null}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono">
                          {hm(l.started)}–{l.finished ? hm(l.finished) : '진행 중'}
                        </span>
                      </TableCell>
                      <TableCell>{l.result ? <StatusBadge state={l.result} /> : <StatusBadge state="실행 중" />}</TableCell>
                    </TableRow>
                  ))}
                </Tbl>
              </div>
            )
          })
        ) : (
          <Notice>아직 실행하지 않았습니다.</Notice>
        )}
      </Section>

      <Section title="제출 기록">
        {subs.length ? (
          <Tbl head={['ID', '생성 단계', '시각', '결과 항목', '변경 범위', '원문']}>
            {subs.map((s) => (
              <TableRow key={s.submission_id}>
                <TableCell><span className="font-mono">{s.submission_id}</span></TableCell>
                <TableCell>
                  {wf.nodes.get(s.node_id).name} {s.iteration}회차
                </TableCell>
                <TableCell><span className="font-mono">{when(s.at)}</span></TableCell>
                <TableCell>
                  {s.slots.map((sl: any) => (
                    <span key={sl.output_slot} className="mr-2 inline-flex items-center gap-1">
                      <span className="font-mono">{sl.output_slot}</span>
                      <RawButton refId={sl.artifact_ref} title={`${s.submission_id} · ${sl.output_slot}`} label="원문 보기" />
                    </span>
                  ))}
                </TableCell>
                <TableCell>
                  <StatusBadge state={s.scope_check === '통과' ? '통과' : '거부'} />
                </TableCell>
                <TableCell>
                  <RawButton refId={s.diff_ref} title={`${s.submission_id} 변경 내용`} label="변경 내용" />
                </TableCell>
              </TableRow>
            ))}
          </Tbl>
        ) : (
          <Notice>제출 기록이 없습니다.</Notice>
        )}
      </Section>

      <Section title="Task 명세">
        <KeyValues
          items={[
            ['목표', c.goal],
            ['전체 내용', <RawButton key="raw" refId={c.contract_ref} title={`${id} Task 명세 전문`} label="Task 명세 전체 보기" />],
            ['사용량', <span key="cost" className="font-mono">${cost.toFixed(2)} (추정값)</span>],
          ]}
        />
      </Section>
    </>
  )
}
