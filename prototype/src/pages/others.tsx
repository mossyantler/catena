// 승인(C-4), Phase별(C-9), Milestone별(C-10) 화면.
import { KeyValues, Notice, PageHeader, Section, SubTitle } from '@/components/page'
import { DiffText, RawButton } from '@/components/raw-viewer'
import { CountsBar, StatusBadge, Tid } from '@/components/status'
import { ActionText, BlockText, CondCount, TaskState } from '@/components/task'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import * as RM from '@/lib/rm'
import { label, waitLabel, when } from '@/lib/status'
import { useCatena } from '@/lib/store'

// ---------------- 승인 ----------------
export function ApprovalPage({ id }: { id: string }) {
  const { model, bundle, nameOf } = useCatena()
  const a = model.approvals.get(id)
  if (!a) return <Notice>이 재생 위치에는 승인 요청 {id}이 없습니다.</Notice>
  const s = model.submissions.get(a.submission_id)
  const c = model.contracts.get(a.task)
  const evs = [...model.evidence.values()].filter((e) => e.submission_id === a.submission_id)
  const f = s ? bundle.files.get(s.diff_ref.id.slice(7)) : undefined
  return (
    <>
      <PageHeader
        eyebrow={
          <a href={`#task-${a.task}`} className="underline-offset-4 hover:underline">
            {a.task} {nameOf(a.task)}
          </a>
        }
        title={<>승인 요청 <span className="font-mono">{id}</span></>}
        tabTitle={`승인 요청 ${id}`}
        actions={a.decision ? <StatusBadge state={a.decision} /> : <StatusBadge state="결정 전" />}
      />
      <Section title="승인할 내용">
        <KeyValues
          items={[
            ['종류', `${a.kind} 승인`],
            ['요청 시각', when(a.requested)],
            [
              '승인할 조건',
              a.condition_ids.map((cid: string) => (
                <div key={cid}>
                  <span className="font-mono">{cid}</span> {c.conditions.find((x: any) => x.condition_id === cid)?.description}
                </div>
              )),
            ],
            ['검토할 제출 기록', <><span className="font-mono">{a.submission_id}</span>. 승인은 이 제출 기록에만 적용됩니다. 이후 고친 결과는 다시 승인해야 합니다.</>],
            ...(a.decision ? ([['결정', `${a.decision} · ${when(a.decided)}${a.channel ? ` · ${a.channel === 'cli-tty' ? '대화형 CLI' : a.channel}` : ''} · ${a.comment ?? ''}`]] as [string, string][]) : []),
            // 14-15: 같은 사용자 권한의 Agent도 이 채널을 흉내 낼 수 있다. 막지 않고 한계로 보인다
            ...(a.channel_note ? ([['승인 채널의 한계', a.channel_note]] as [string, string][]) : []),
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>승인</Button>
          <Button variant="outline" disabled>
            반려
          </Button>
          <span className="text-xs text-muted-foreground">지금 시안에서는 결과를 볼 수만 있습니다. 승인·반려는 아직 할 수 없습니다.</span>
        </div>
      </Section>
      <Section title="같은 제출 기록의 검수 근거">
        {evs.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {['검수 근거', '조건', '결과', '검사 방법', '로그'].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {evs.map((e) => (
                <TableRow key={e.evidence_id}>
                  <TableCell><span className="font-mono">{e.evidence_id}</span></TableCell>
                  <TableCell><span className="font-mono">{e.condition_id}</span></TableCell>
                  <TableCell>
                    <StatusBadge state={e.result} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {e.verifier_ref ? <RawButton refId={e.verifier_ref} title="검사 방법" /> : <span className="text-xs text-muted-foreground">검사 방법 기록이 없어 Task 명세에 정한 검사인지 확인할 수 없습니다.</span>}
                  </TableCell>
                  <TableCell>
                    <RawButton refId={e.raw_log_ref} title={`${e.evidence_id} 검사 로그`} label="로그 보기" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Notice>이 요청에는 사용자 승인 조건만 있고, 자동 검사 결과는 없습니다.</Notice>
        )}
      </Section>
      <Section title={<>변경 내용 <span className="font-mono">{a.submission_id}</span></>}>
        <DiffText text={f?.ok ? f.text : ''} />
      </Section>
    </>
  )
}

// ---------------- Phase별 ----------------
export function PhasePage() {
  const { model, node, nameOf, phaseName } = useCatena()
  const ids = RM.tasksUnder(model)
  const phaseOf = (id: string) => node(id).phase
  const between = new Map<string, { a: string; b: string; n: number; acc: number }>()
  for (const d of model.deps) {
    if (d.from.external_ref) continue
    const a = phaseOf(d.from.task_id)
    const b = phaseOf(d.to.task_id)
    if (!a || !b || a === b) continue
    const k = `${a}>${b}`
    const x = between.get(k) ?? { a, b, n: 0, acc: 0 }
    x.n++
    if (model.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)) x.acc++
    between.set(k, x)
  }
  return (
    <>
      <PageHeader title="작업 단계별 공정" description="Task를 작업 단계(설계·구현·시험 등)별로 모아 보여 줍니다. 작업 구성의 계층과는 따로입니다." />
      <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
        {model.project.phases.map((ph: any) => {
          const ts = ids.filter((id) => phaseOf(id) === ph.phase_id)
          const a = RM.aggregate(model, ts)
          return (
            <section key={ph.phase_id} className="flex flex-col gap-2">
              <header className="flex flex-col gap-2 border-b pb-2">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-strong">{ph.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {a.acc}/{a.tot}
                  </span>
                </span>
                <CountsBar counts={a.counts} legend={false} />
              </header>
              {ts.map((id) => (
                <a key={id} href={`#task-${id}`} className="flex flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 text-xs transition-colors hover:bg-accent">
                  <span className="truncate text-muted-foreground">
                    {RM.path(model, id).slice(0, -1).map(nameOf).join(' / ') || '최상위'}
                  </span>
                  <span className="truncate text-sm">
                    <Tid id={id} /> <span className="font-medium text-strong">{nameOf(id)}</span>
                  </span>
                  <TaskState id={id} />
                  <span className="text-muted-foreground">
                    <CondCount id={id} />
                  </span>
                  <span className="truncate">
                    <BlockText id={id} />
                  </span>
                  <span className="truncate text-muted-foreground">
                    <ActionText id={id} />
                  </span>
                </a>
              ))}
            </section>
          )
        })}
      </div>
      <Section title="작업 단계 사이의 연결" description="요약 엣지: 하위 Task 사이의 연결을 합친 선. 실행 순서가 아님">
        <ul className="flex flex-col gap-1.5">
          {[...between.values()].map((x) => (
            <li key={`${x.a}>${x.b}`}>
              {phaseName(x.a)} → {phaseName(x.b)}: 연결 {x.n}개 · 검수 {x.acc}
              {between.has(`${x.b}>${x.a}`) ? <span className="text-xs text-muted-foreground"> (반대 방향 연결도 있음)</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

// ---------------- Milestone별 ----------------
export function MilestonePage() {
  const { model, nameOf } = useCatena()
  const done = (it: any) => (it.slot ? model.slotAccepted.has(`${it.task_id}/${it.slot}`) : model.taskAccepted.has(it.task_id))
  return (
    <>
      <PageHeader title="마일스톤별 공정" description="마일스톤은 날짜가 아니라 검수돼야 할 항목의 목록입니다." />
      {[...model.milestones.values()].map((ms: any) => {
        const k = ms.items.filter(done).length
        return (
          <Section key={ms.milestone_id ?? ms.name} title={ms.name} action={<span className="font-mono text-sm text-strong">{ms.items.length}개 중 {k}개 달성</span>}>
            <Progress value={(k / ms.items.length) * 100} aria-label={`${ms.name} 달성 비율`} />
            <SubTitle>항목</SubTitle>
            <ul className="flex flex-col gap-2">
              {ms.items.map((it: any, i: number) => {
                const c = RM.card(model, it.task_id)
                const w = c.waits[0]
                const ok = done(it)
                return (
                  <li key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge state={ok ? '인수됨' : '미달성'} tone={ok ? 'ok' : 'muted'} />
                        <Tid id={it.task_id} className="text-xs" />
                        <span className="font-medium text-strong">{nameOf(it.task_id)}</span>
                        {it.slot ? <span className="text-xs text-muted-foreground">결과 항목 <span className="font-mono">{it.slot}</span></span> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {ok ? '달성' : `${label(c.rep, true)}${w ? ` · ${waitLabel(w)}: ${w.resolve} → ${w.action.actor}: ${w.action.text}` : ''}`}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a href={`#task-${it.task_id}`}>열기</a>
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Section>
        )
      })}
    </>
  )
}
