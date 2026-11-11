// Catena Product MVP 화면 시안. 데이터 묶음(data/)을 불러와 검사한 뒤, 읽기 모델(readmodel.js)만으로 화면을 그린다.
import * as RM from './readmodel.js';

const BASE = 'data/';
const S = { manifest: null, events: [], files: new Map(), model: null, pos: 0, total: 0, error: null,
  view: 'overview', id: undefined, showClosed: false, crumbsOpen: false, dagSel: null, agentNode: null };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 ${iso.slice(11, 16)}` : '';
const hm = iso => iso ? iso.slice(11, 16) : '';
const WAIT = { dependency: '선행 대기', approval: '승인 대기', decision: '결정 필요', resource: '자원 대기', external: '외부 대기', migration: '전환 중', revalidation: '재검증 필요' };
const ST = { '인수됨': 'ok', '실행 중': 'run', '대기': 'wait', '실패': 'fail', '검증 중': 'user', '착수 가능': 'ready', '일시 중단': 'wait', '결과 불명': 'fail',
  '검증 통과(인수 대기)': 'run', '검증 실패': 'fail', '미검증': 'muted', '성공': 'ok', '중단': 'wait', '통과': 'ok', 'skip': 'fail', '미실행': 'fail', '승인': 'ok', '반려': 'fail' };
const chip = (text, cls) => `<span class="chip st-${cls ?? ST[text] ?? 'muted'}">${esc(text)}</span>`;
const refCheck = r => { const f = S.files.get(r.id.slice(7)); if (!f) return '원문 파일 없음'; return f.ok ? undefined : f.err; };
const rawBtn = (ref, title, label = '원문 보기') => ref ? `<button type="button" class="linkbtn" data-raw="${esc(ref.id.slice(7))}" data-title="${esc(title)}">${esc(label)}</button>` : '';
const M = () => S.model;
const node = id => M().nodes.get(id);
const nameOf = id => node(id)?.name ?? id;
const phaseName = id => M().project.phases.find(p => p.phase_id === id)?.name;
const sim = () => S.manifest.origin !== 'live';
const profText = p => p ? `${p.runtime} · ${p.model}` : '';
// Q8: 가장 최근 Run의 수정 반복 회차와 통과하지 못한 검사 수
const reworkText = id => { const r = RM.rework(M(), id).at(-1); return r ? `Agent ${r.round}회차${r.round > 1 ? ` · 수정 ${r.round - 1}회` : ''}${r.failed.length ? ` · 통과 못 한 검사 ${r.failed.length}` : ''}` : 'Run 없음'; };

// ---------------- 불러오기 ----------------
// 네트워크 실패는 몇 번 다시 시도하고, 그래도 안 되면 검사 실패와 구분해 알린다.
async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fetch(url); } catch {
      if (i >= tries) throw Object.assign(new Error(`${url}을(를) 받지 못했습니다(네트워크 오류).`), { load: true });
    }
  }
}

async function load() {
  try {
    const mres = await get(BASE + 'dataset.json');
    if (!mres.ok) throw new Error('데이터 묶음(dataset.json)을 찾지 못했습니다.');
    S.manifest = await mres.json();
    const text = await (await get(BASE + 'events.jsonl')).text();
    S.events = RM.checkStream(S.manifest, text.split('\n').filter(Boolean));
    const hexes = [...new Set(RM.refsOf(S.events).map(r => r.id.slice(7)))];
    await Promise.all(hexes.map(async h => {
      const res = await get(`${BASE}artifacts/sha256/${h}`);
      if (!res.ok) { S.files.set(h, { ok: false, err: '원문 파일 없음' }); return; }
      const buf = await res.arrayBuffer();
      const dig = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
      S.files.set(h, dig === h ? { ok: true, text: new TextDecoder().decode(buf) } : { ok: false, err: '해시 불일치' });
    }));
    S.total = S.events.length;
    RM.foldAll(S.events, refCheck); // 묶음 전체를 먼저 검사한다. 실패하면 아무것도 보여 주지 않는다.
    S.pos = Math.min(S.manifest.default_position ?? S.total, S.total);
    S.model = RM.foldAll(S.events, refCheck, S.pos);
  } catch (err) {
    S.error = err.message;
    S.errorKind = err.load ? '불러오기 실패' : '검사 실패';
  }
  setupTop();
  route();
}

function setupTop() {
  if (S.error) return;
  $('proj').textContent = M().project.name;
  const o = $('origin');
  o.hidden = !sim();
  o.textContent = S.manifest.origin === 'simulated' ? `시뮬레이션 데이터 · ${S.manifest.dataset_id}` : `기록 재생 · ${S.manifest.dataset_id}`;
  o.title = S.manifest.description ?? '';
  const r = $('replay');
  $('replay-row').hidden = !sim();
  r.max = S.total; r.value = S.pos;
  r.addEventListener('input', () => { S.pos = +r.value; S.model = RM.foldAll(S.events, refCheck, S.pos); render(); });
  $('replay-end').addEventListener('click', () => { r.value = S.total; r.dispatchEvent(new Event('input')); });
  if (matchMedia('(min-width: 901px)').matches) $('tree-wrap').open = true;
  $('show-closed').addEventListener('change', e => { S.showClosed = e.target.checked; render(); });
  const find = $('find'), results = $('find-results'), rw = $('find-rework');
  const show = () => {
    const q = find.value.trim();
    const only = rw.getAttribute('aria-pressed') === 'true';
    if (!q && !only) { results.hidden = true; return; }
    const hits = RM.tasksUnder(M(), undefined, S.showClosed).filter(id => {
      if (only && !RM.hasRework(M(), id)) return false;
      const c = RM.card(M(), id);
      return !q || id.toLowerCase().includes(q.toLowerCase()) || nameOf(id).includes(q) || c.rep.includes(q) || (phaseName(node(id).phase) ?? '').includes(q);
    }).slice(0, 8);
    results.innerHTML = hits.length ? hits.map(id => `<a href="#task-${id}"><span class="tid">${id}</span><span>${esc(nameOf(id))}${only ? `<span class="note"> · ${esc(reworkText(id))}</span>` : ''}</span>${chip(RM.card(M(), id).rep)}</a>`).join('')
      : `<a href="#overview" tabindex="-1"><span></span><span>찾은 Task가 없습니다</span><span></span></a>`;
    results.hidden = false;
  };
  find.addEventListener('input', show);
  rw.addEventListener('click', () => { rw.setAttribute('aria-pressed', String(rw.getAttribute('aria-pressed') !== 'true')); show(); });
  find.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = results.querySelector('a[href^="#task-"]'); if (a) location.hash = a.getAttribute('href'); } });
  results.addEventListener('click', () => { results.hidden = true; find.value = ''; rw.setAttribute('aria-pressed', 'false'); });
  document.addEventListener('click', e => { if (!e.target.closest('.find, #find-rework')) results.hidden = true; });
}

// ---------------- 라우팅 ----------------
function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'overview';
  const i = h.indexOf('-');
  S.view = i < 0 ? h : h.slice(0, i);
  S.id = i < 0 ? undefined : h.slice(i + 1);
  S.crumbsOpen = false;
  if (S.view !== 'agent') S.agentNode = null;
  render();
}
window.addEventListener('hashchange', () => { route(); window.scrollTo({ top: 0 }); });

function render() {
  const main = $('main');
  if (S.error) {
    main.innerHTML = `<div class="err"><strong>${S.errorKind} — 데이터 묶음을 불러오지 않았습니다.</strong><br>${esc(S.error)}<br><span class="mono">묶음은 전부 불러오거나 전부 거부합니다(ExecutionEvent 처리 규칙 7).</span></div>`;
    return;
  }
  const m = M();
  const last = S.events[S.pos - 1];
  $('replay-out').textContent = `${S.pos} / ${S.total} · ${when(last?.occurred_at)}${sim() ? ' (가상 시각)' : ''}`;
  const todos = todoItems();
  const t = $('todo');
  t.hidden = false;
  t.textContent = `결정할 일 ${todos.length}`;
  for (const a of document.querySelectorAll('#tabs a')) a.setAttribute('aria-current', a.dataset.tab === tabOf(S.view) ? 'page' : 'false');
  $('tree').innerHTML = treeHtml();
  $('crumbs').innerHTML = crumbsHtml();
  const views = { overview: viewOverview, wbs: viewWbs, dag: viewDag, task: viewTask, agent: viewAgent, approval: viewApproval, phase: viewPhase, milestone: viewMilestone };
  main.innerHTML = (views[S.view] ?? viewOverview)(S.id);
  void m;
}
const tabOf = v => ({ task: 'wbs', agent: 'wbs', approval: 'overview' }[v] ?? v);

// ---------------- 공통 조각 ----------------
const todoItems = () => RM.inbox(M());
const waitHref = (id, w) => w.type === 'approval' ? `#approval-${w.source}` : w.type === 'dependency' && w.source ? `#task-${w.source}` : `#task-${id}`;

function cardParts(id) {
  const c = RM.card(M(), id);
  const w = c.waits[0];
  return {
    c,
    state: `${chip(c.rep)}${c.stages.map(s => ` <span class="stage">${esc(s)}</span>`).join('')}`,
    conds: `<span class="num">${c.accepted} / ${c.total}</span> 인수${c.passed ? ` · <span class="num">${c.passed}</span> 검증 통과` : ''}`,
    block: w ? `${esc(WAIT[w.type] ?? w.type)}: ${esc(w.resolve)}${c.waits.length > 1 ? ` <span class="num">(외 ${c.waits.length - 1}건)</span>` : ''}` : '없음',
    action: w ? `${esc(w.action.actor)}: ${esc(w.action.text)}` : '—',
  };
}

function rowCard(id) {
  const n = node(id);
  const p = cardParts(id);
  return `<a class="trow" href="#task-${id}">
    <span class="cell"><span class="k"><span class="tid">${id}</span>${n.phase ? `<span class="phase-tag">${esc(phaseName(n.phase))}</span>` : ''}</span><span class="nm">${esc(n.name)}</span></span>
    <span class="cell"><span class="k">작업 상태</span>${p.state}</span>
    <span class="cell"><span class="k">완료 조건</span>${p.conds}</span>
    <span class="cell wline"><span class="k">차단 이유 · 할 일</span>${p.block}<span class="act">${p.action}</span></span>
  </a>`;
}

const aggregate = ids => RM.aggregate(M(), ids);
const countsHtml = counts => [...counts].map(([k, v]) => `<span class="chip st-${ST[k] ?? 'muted'}">${esc(k)} <span class="num">${v}</span></span>`).join(' ');

// ---------------- 위치 표시 ----------------
function crumbsHtml() {
  const m = M();
  const items = [{ href: '#wbs', label: m.project.name }];
  let focus;
  if (['task', 'agent'].includes(S.view) && node(S.id)) focus = S.id;
  if (['wbs', 'dag'].includes(S.view) && S.id && node(S.id)) focus = S.id;
  if (S.view === 'approval' && m.approvals.get(S.id)) focus = m.approvals.get(S.id).task;
  if (focus) for (const id of RM.path(m, focus)) items.push({ href: node(id).kind === 'summary' ? `#wbs-${id}` : `#task-${id}`, label: node(id).kind === 'task' ? `${id} ${node(id).name}` : node(id).name });
  const viewLabel = { overview: '개요', wbs: '하위 공정표', dag: '의존 관계', task: 'Task 상세', agent: 'Agent Graph', approval: `승인 ${S.id ?? ''}`, phase: 'Phase별', milestone: 'Milestone별' }[S.view] ?? '개요';
  let shown = items;
  if (items.length > 4 && !S.crumbsOpen) shown = [items[0], { more: true }, ...items.slice(-2)];
  const parts = shown.map(it => it.more ? `<button type="button" data-crumbs aria-label="가운데 단계 펼치기">…</button>` : `<a href="${it.href}">${esc(it.label)}</a>`);
  parts.push(`<span class="here">${esc(viewLabel)}</span>`);
  return parts.join('<span class="sep">›</span>');
}

function treeHtml() {
  const m = M();
  const sel = ['task', 'agent', 'wbs', 'dag'].includes(S.view) ? S.id : undefined;
  const kids = parent => [...m.nodes.values()].filter(n => n.parent === parent && (S.showClosed || !RM.CLOSED.includes(n.lifecycle))).sort((a, b) => a.order - b.order);
  const li = n => {
    const closed = RM.CLOSED.includes(n.lifecycle);
    if (n.kind === 'summary') {
      const a = aggregate(RM.tasksUnder(m, n.id));
      return `<li><a href="#wbs-${n.id}" class="${sel === n.id ? 'on' : ''}">▸ ${esc(n.name)}<span class="sum num">${a.acc}/${a.tot}</span></a><ul>${kids(n.id).map(li).join('')}</ul></li>`;
    }
    const rep = closed ? n.lifecycle : RM.card(m, n.id).rep;
    return `<li><a href="#task-${n.id}" class="${sel === n.id ? 'on' : ''}"><span class="tid">${n.id}</span><span class="${closed ? 'closed' : ''}">${esc(n.name)}</span><span class="sum"><span class="chip st-${ST[rep] ?? 'muted'}" title="${esc(rep)}"></span></span></a></li>`;
  };
  return `<ul>${kids(undefined).map(li).join('')}</ul>`;
}

// ---------------- 그래프 배치 ----------------
function scc(ids, edges) {
  let idx = 0, c = 0;
  const index = new Map(), low = new Map(), on = new Set(), st = [], comp = new Map();
  const adj = new Map(ids.map(i => [i, []]));
  for (const e of edges) if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from).push(e.to);
  const visit = v => {
    index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v);
    for (const w of adj.get(v)) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) { let w; do { w = st.pop(); on.delete(w); comp.set(w, c); } while (w !== v); c++; }
  };
  for (const v of ids) if (!index.has(v)) visit(v);
  return comp;
}

// items: [{id, h, cls, attrs, html}], layoutEdges: [{from,to}], drawEdges: [{from,to,cls,label,both}]
function graph(items, layoutEdges, drawEdges, opt = {}) {
  const W = opt.w ?? 236, GX = opt.gx ?? 104, GY = 20, PAD = 24;
  const ids = items.map(i => i.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const byId = new Map(items.map(i => [i.id, i]));
  const comp = scc(ids, layoutEdges);
  const comps = new Map();
  for (const id of ids) { const c = comp.get(id); if (!comps.has(c)) comps.set(c, []); comps.get(c).push(id); }
  const rank = new Map([...comps.keys()].map(c => [c, 0]));
  const cedges = layoutEdges.filter(e => comp.has(e.from) && comp.has(e.to) && comp.get(e.from) !== comp.get(e.to)).map(e => [comp.get(e.from), comp.get(e.to)]);
  for (let k = 0; k < comps.size; k++) for (const [a, b] of cedges) rank.set(b, Math.max(rank.get(b), rank.get(a) + 1));
  const cols = new Map();
  for (const [c, r] of rank) { if (!cols.has(r)) cols.set(r, []); cols.get(r).push(c); }
  const pos = new Map(), groups = [];
  let maxY = 0;
  for (const [r, cs] of [...cols].sort((a, b) => a[0] - b[0])) {
    const minOrder = c => Math.min(...comps.get(c).map(id => order.get(id)));
    cs.sort((a, b) => minOrder(a) - minOrder(b));
    let y = PAD + 8;
    for (const c of cs) {
      const members = comps.get(c).sort((a, b) => order.get(a) - order.get(b));
      const multi = members.length > 1;
      if (multi) y += 10;
      const top = y;
      for (const id of members) { const h = byId.get(id).h; pos.set(id, { x: PAD + r * (W + GX), y, h, col: r }); y += h + GY; }
      if (multi) { groups.push({ x: PAD + r * (W + GX) - 10, y: top - 14, w: W + 20, h: y - GY - top + 26 }); y += 16; }
      y += 6;
    }
    maxY = Math.max(maxY, y);
  }
  const width = PAD * 2 + cols.size * W + (cols.size - 1) * GX + 80;
  const height = maxY + (opt.backArcs ? 70 : 10);
  const marker = (id, color) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" style="fill:var(${color})"/></marker>`;
  const paths = drawEdges.map(e => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return '';
    let d, lx, ly;
    if (a.col === b.col) {
      const x = a.x + W, y1 = a.y + a.h / 2, y2 = b.y + b.h / 2, bend = x + 48;
      d = `M${x},${y1} C${bend},${y1} ${bend},${y2} ${x},${y2}`; lx = bend - 2; ly = (y1 + y2) / 2;
    } else if (a.col < b.col) {
      const x1 = a.x + W, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, dx = Math.max(40, (x2 - x1) / 2);
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 - 6;
    } else {
      const x1 = a.x + W / 2, y1 = a.y + a.h, x2 = b.x + W / 2, y2 = b.y + b.h, low = Math.max(y1, y2) + 46;
      d = `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}`; lx = (x1 + x2) / 2; ly = low - 8;
    }
    const mk = e.cls.includes('e-hi') ? 'ah-a' : e.cls.includes('e-leaf') ? 'ah' : 'ah-m';
    const label = e.label ? `<text class="elabel" x="${lx}" y="${ly}" text-anchor="${a.col === b.col ? 'start' : 'middle'}">${esc(e.label)}</text>` : '';
    return `<path class="e ${e.cls}" d="${d}" marker-end="url(#${mk})"${e.both ? ` marker-start="url(#${mk})"` : ''}/>${label}`;
  }).join('');
  const svg = `<svg width="${width}" height="${height}" aria-hidden="true"><defs>${marker('ah', '--ink')}${marker('ah-m', '--muted')}${marker('ah-a', '--accent')}</defs>${paths}</svg>`;
  const grp = groups.map(g => `<div class="group" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px"><span>${esc(opt.groupLabel ?? '서로 얽힌 묶음')}</span></div>`).join('');
  const boxes = items.map(it => {
    const p = pos.get(it.id);
    const tag = it.tag ?? 'a';
    return `<${tag} class="box ${it.cls ?? ''}" ${it.attrs ?? ''} style="left:${p.x}px;top:${p.y}px;width:${W}px;height:${p.h}px">${it.html}</${tag}>`;
  }).join('');
  return `<div class="canvas-wrap"><div class="canvas" style="width:${width}px;height:${height}px">${grp}${svg}${boxes}</div></div>`;
}

function taskBox(id, extra = '') {
  const n = node(id);
  const closed = RM.CLOSED.includes(n.lifecycle);
  if (closed) return `<span class="l1"><span class="tid">${id}</span>${esc(n.lifecycle)}</span><span class="nm">${esc(n.name)}</span><span class="ln">${esc(n.closedReason ?? '')}</span>`;
  const p = cardParts(id);
  return `<span class="l1"><span class="tid">${id}</span>${n.phase ? `<span class="phase-tag">${esc(phaseName(n.phase))}</span>` : ''}${extra}</span>
    <span class="nm">${esc(n.name)}</span>
    <span class="ln">${p.state}</span>
    <span class="ln"><b>완료 조건</b>${p.conds}</span>
    <span class="ln"><b>차단</b>${p.block}</span>
    <span class="ln"><b>할 일</b>${p.action}</span>`;
}

function summaryBox(id, ext) {
  const m = M();
  const tasks = RM.tasksUnder(m, id);
  const a = aggregate(tasks);
  const blockers = RM.blocking(m);
  const top = Math.max(0, ...blockers.values());
  const hasTop = top > 0 && tasks.some(t => blockers.get(t) === top);
  return `<span class="l1">요약 노드 · Task <span class="num">${tasks.length}</span> · 집계</span>
    <span class="nm">${esc(nameOf(id))}</span>
    <span class="ln">${countsHtml(a.counts)}</span>
    <span class="ln"><b>완료 조건</b><span class="num">${a.acc} / ${a.tot}</span> 인수</span>
    <span class="ln"><b>지금 착수 가능</b><span class="num">${a.ready}</span>${hasTop ? ' · 뒤를 가장 많이 막는 Task 포함' : ''}</span>
    <span class="ln"><b>범위 밖</b>${ext ? `선행 <span class="num">${ext.in}</span> · 후행 <span class="num">${ext.out}</span>` : '없음'}</span>`;
}

const legend = (extra = '') => `<div class="legend">
  <span><svg width="44" height="10"><path d="M2,5 L40,5" class="e e-leaf"/></svg>원본 의존(Task 사이, 슬롯 인수 수)</span>
  <span><svg width="44" height="10"><path d="M2,5 L40,5" class="e e-agg"/></svg>집계 엣지: 하위 Task 의존을 묶은 표시이며 실행 순서를 뜻하지 않음</span>
  ${extra}</div>`;

// ---------------- 화면: 개요 ----------------
function viewOverview() {
  const m = M();
  const ids = RM.tasksUnder(m);
  const a = aggregate(ids);
  const todos = todoItems();
  const blockers = [...RM.blocking(m)].sort((x, y) => y[1] - x[1]);
  const groups = ['실행 중', '실패', '검증 중', '대기', '착수 가능', '인수됨', '계획 중'];
  const byRep = new Map(groups.map(g => [g, []]));
  for (const id of ids) { const r = RM.card(m, id).rep; if (!byRep.has(r)) byRep.set(r, []); byRep.get(r).push(id); }
  const blockedBy = src => ids.filter(id => RM.waitsOf(m, id).some(w => w.source === src && w.type === 'dependency'));
  return `
  <section class="panel">
    <div class="panel-head"><h2>공정 현황</h2><span class="note">진척은 시간이 아니라 인수된 완료 조건으로 셉니다.</span>
      <span class="actions"><a class="btn" href="#dag">전체 의존 보기</a><a class="btn" href="#wbs">WBS 공정표</a></span></div>
    <div class="ledger">
      ${[...a.counts].sort((x, y) => groups.indexOf(x[0]) - groups.indexOf(y[0])).map(([k, v]) => `<span class="item"><span class="n">${v}</span><span class="lbl">${chip(k)}</span></span>`).join('')}
      <span class="item"><span class="n">${a.acc}<span class="lbl"> / ${a.tot}</span></span><span class="lbl">검증된 완료 조건</span></span>
    </div>
  </section>
  <div class="cols">
    <section class="panel">
      <div class="panel-head"><h2>지금 결정할 일</h2><span class="note">해소 행동의 주체가 사용자인 차단 이유</span></div>
      ${todos.length ? `<ul class="todo-list">${todos.map(({ id, w }) => `<li class="todo-item">
        <span><span class="what">${chip(WAIT[w.type] ?? w.type, w.type === 'approval' ? 'user' : 'fail')} <span class="tid">${id}</span> ${esc(nameOf(id))}</span><br>
        <span class="why">${esc(w.action.text)} · ${esc(when(w.raised_at))}부터</span></span>
        <a class="btn primary" href="${waitHref(id, w)}">${esc(w.action.screen)} 열기</a></li>`).join('')}</ul>` : '<p class="notice">지금 사용자가 결정할 일은 없습니다.</p>'}
    </section>
    <section class="panel">
      <div class="panel-head"><h2>뒤를 막고 있는 Task</h2><span class="note">인수되지 않은 슬롯 때문에 착수하지 못하는 후행 Task 수</span></div>
      ${blockers.length ? `<ul class="plain-list">${blockers.map(([src, n]) => `<li class="todo-item">
        <span><span class="what"><span class="tid">${src}</span> ${esc(nameOf(src))}</span> ${chip(RM.card(m, src).rep)}<br>
        <span class="why">후행 ${n}개를 막음: ${blockedBy(src).map(t => `${t} ${esc(nameOf(t))}`).join(', ')}</span></span>
        <a class="btn" href="#task-${src}">열기</a></li>`).join('')}</ul>` : '<p class="notice">막고 있는 Task가 없습니다.</p>'}
    </section>
  </div>
  <section class="panel">
    <div class="panel-head"><h2>상태별 Task</h2><span class="note">WBS 깊이와 관계없이 모든 Task를 바로 보여 줍니다.</span></div>
    ${[...byRep].filter(([, v]) => v.length).map(([k, v]) => `<div class="group-title">${chip(k)}<span class="note num">${v.length}</span></div>${v.map(rowCard).join('')}`).join('')}
  </section>`;
}

// ---------------- 화면: WBS 계층별 공정표 ----------------
function viewWbs(id) {
  const m = M();
  if (id && node(id)?.kind !== 'summary') id = undefined;
  const { children, edges, external } = RM.edgesAt(m, id, S.showClosed);
  const kids = children.map(c => node(c)).sort((a, b) => a.order - b.order);
  const items = kids.map(n => n.kind === 'summary'
    ? { id: n.id, h: 150, cls: 'summary', attrs: `href="#wbs-${n.id}"`, html: summaryBox(n.id, external.get(n.id)) }
    : { id: n.id, h: 150, cls: RM.CLOSED.includes(n.lifecycle) ? 'closed' : '', attrs: `href="#task-${n.id}"`,
        html: taskBox(n.id, external.get(n.id) ? ` · 범위 밖 선행 ${external.get(n.id).in} · 후행 ${external.get(n.id).out}` : '') });
  const drawn = [];
  for (const e of edges) {
    const back = edges.find(x => x.from === e.to && x.to === e.from);
    if (back && e.from > e.to) continue;
    const lbl = x => `${nameOf(x.from)} → ${nameOf(x.to)} ${x.count}개(인수 ${x.accepted})`;
    if (back) drawn.push({ from: e.from, to: e.to, cls: 'e-agg', both: true, label: `${lbl(e)} · ${lbl(back)} — 양방향 묶음, 순환 아님` });
    else drawn.push({ from: e.from, to: e.to, cls: e.aggregated ? 'e-agg' : 'e-leaf', label: e.aggregated ? `의존 ${e.count}개 · 인수 ${e.accepted}` : `슬롯 ${e.accepted}/${e.count} 인수` });
  }
  const title = id ? nameOf(id) : M().project.name;
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(title)} 하위 공정표</h2><span class="note">하위 항목 ${kids.length}개 · 요약 노드는 하위 Task를 집계한 값입니다.</span>
      <span class="actions"><a class="btn" href="#dag${id ? `-${id}` : ''}">이 범위 Task 전체 펼치기</a></span></div>
    ${legend('<span>점선 테두리: 집계 엣지로 서로 오가는 노드 묶음</span>')}
    ${items.length ? graph(items, edges, drawn, { groupLabel: '서로 얽힌 묶음 · 배치 순서 없음' }) : '<p class="notice">하위 항목이 없습니다.</p>'}
  </section>`;
}

// ---------------- 화면: Dependency DAG ----------------
function viewDag(id) {
  const m = M();
  if (id && node(id)?.kind !== 'summary') id = undefined;
  const ids = RM.tasksUnder(m, id).sort((a, b) => a.localeCompare(b));
  const set = new Set(ids);
  const edges = RM.taskEdges(m, ids);
  const sel = set.has(S.dagSel) ? S.dagSel : null;
  const rel = sel ? RM.relations(m, sel) : null;
  const relOf = t => !sel ? '' : t === sel ? 'sel' : rel.ancestors.has(t) ? 'rel-up' : rel.descendants.has(t) ? 'rel-down' : 'rel-ind';
  const items = ids.map(t => ({ id: t, h: 150, tag: 'button', cls: relOf(t), attrs: `type="button" data-sel="${t}" aria-pressed="${t === sel}"`, html: taskBox(t) }));
  const onPath = e => sel && ((e.to === sel || rel.ancestors.has(e.to)) && (rel.ancestors.has(e.from)) || (e.from === sel || rel.descendants.has(e.from)) && rel.descendants.has(e.to));
  const drawn = edges.map(e => ({ from: e.from, to: e.to, cls: `e-leaf${sel ? (onPath(e) ? ' e-hi' : ' e-dim') : ''}`, label: `슬롯 ${e.accepted}/${e.count} 인수` }));
  const ready = ids.filter(t => RM.card(m, t).rep === '착수 가능');
  const info = sel ? `<div class="notice"><strong><span class="tid">${sel}</span> ${esc(nameOf(sel))}</strong> 선택됨 — 선행 ${rel.ancestors.size} · 후행 ${rel.descendants.size} · 독립(함께 진행 가능) ${ids.length - 1 - rel.ancestors.size - rel.descendants.size}
      &nbsp;<a class="btn" href="#task-${sel}">Task 상세 열기</a> <a class="btn" href="#agent-${sel}">Agent Graph</a></div>`
    : `<div class="notice">Task를 고르면 선행·후행·독립(병렬로 진행 가능) Task를 구분해 보여 줍니다. 판단은 원본 의존으로만 합니다.</div>`;
  return `<section class="panel">
    <div class="panel-head"><h2>${esc(id ? nameOf(id) : M().project.name)} 의존 관계</h2>
      <span class="note">Task ${ids.length}개 · 지금 착수 가능: ${ready.length ? ready.map(t => `${t}`).join(', ') : '없음'}</span>
      <span class="actions">${id ? `<a class="btn" href="#wbs-${id}">하위 공정표로</a>` : ''}</span></div>
    ${info}
    ${legend(`<span><span class="sw" style="border-color:var(--wait)"></span>선행</span><span><span class="sw" style="border-color:var(--run)"></span>후행</span><span><span class="sw" style="border-color:var(--ready)"></span>독립(병렬 가능)</span>`)}
    ${graph(items, edges, drawn)}
  </section>`;
}

// ---------------- 화면: Task 상세 ----------------
function viewTask(id) {
  const m = M();
  const n = node(id);
  if (!n || n.kind !== 'task') return `<p class="notice">찾을 수 없는 Task입니다.</p>`;
  if (RM.CLOSED.includes(n.lifecycle)) return `<section class="panel"><h2><span class="tid">${id}</span> ${esc(n.name)}</h2><p>${chip(n.lifecycle)} ${esc(n.closedReason ?? '')}</p><p class="notice">닫힌 Task는 기본 화면에서 숨깁니다. 기록은 이 ID에 남습니다.</p></section>`;
  const c = m.contracts.get(id);
  if (!c) return `<section class="panel"><h2><span class="tid">${id}</span> ${esc(n.name)}</h2><p>${chip('계획 중')} 계약이 아직 확정되지 않았습니다.</p></section>`;
  const p = cardParts(id);
  const openAppr = [...m.approvals.values()].filter(a => a.task === id && !a.decision);
  const runs = [...m.runs.values()].filter(r => r.task === id).sort((a, b) => a.attempt - b.attempt);
  const subs = [...m.submissions.values()].filter(s => s.task === id);
  const evOf = cond => [...m.evidence.values()].filter(e => e.task === id && e.condition_id === cond);
  const cost = m.usage.filter(u => u.task === id).reduce((s, u) => s + u.cost, 0);
  const condRows = c.conditions.map(cd => {
    const evs = evOf(cd.condition_id);
    const last = evs[evs.length - 1];
    const st = RM.conditionState(m, id, cd.condition_id);
    return `<tr><td class="mono">${esc(cd.condition_id)}</td><td>${esc(cd.description)}</td><td class="mono">${esc(cd.slot ?? 'Task 전체')}</td>
      <td>${cd.method === 'auto' ? '자동 검사' : '사람 승인'}</td><td>${chip(st)}</td>
      <td>${last ? `${chip(last.result)} <span class="mono">${esc(last.evidence_id)}</span> ${rawBtn(last.raw_log_ref, `${last.evidence_id} 검사 로그`, '로그')}${evs.length > 1 ? ` <span class="note">(시도 ${evs.length}회)</span>` : ''}` : cd.method === 'auto' ? '증거 없음' : '승인으로 확인'}</td></tr>`;
  }).join('');
  const inputs = c.input_slots.map(s => {
    const d = m.deps.find(x => x.to.task_id === id && x.to.slot === s.name);
    if (!d) return `<tr><td class="mono">${esc(s.name)}</td><td>공급자 없음</td><td>${chip('대기', 'wait')}</td></tr>`;
    if (d.from.external_ref) return `<tr><td class="mono">${esc(s.name)}</td><td>사람이 등록한 초기 입력 ${rawBtn(d.from.external_ref, `${s.name} 초기 입력`)}</td><td>${chip('사용 가능', 'ok')}</td></tr>`;
    const ok = m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`);
    return `<tr><td class="mono">${esc(s.name)}</td><td><a href="#task-${d.from.task_id}"><span class="tid">${d.from.task_id}</span> ${esc(nameOf(d.from.task_id))}</a> · <span class="mono">${esc(d.from.slot)}</span></td><td>${chip(ok ? '인수됨' : '인수 전', ok ? 'ok' : 'wait')}</td></tr>`;
  }).join('');
  const outputs = c.output_slots.map(s => {
    const users = m.deps.filter(x => x.from.task_id === id && x.from.slot === s.name).map(x => `<a href="#task-${x.to.task_id}"><span class="tid">${x.to.task_id}</span> ${esc(nameOf(x.to.task_id))}</a>`);
    const ok = m.slotAccepted.has(`${id}/${s.name}`);
    return `<tr><td class="mono">${esc(s.name)}</td><td>${users.join(', ') || '후행 Task 없음'}</td><td>${chip(ok ? '인수됨' : '인수 전', ok ? 'ok' : 'muted')}</td></tr>`;
  }).join('');
  const rw = new Map(RM.rework(m, id).map(x => [x.run_id, x]));
  const runHtml = runs.map(r => {
    const logs = m.nodeLog.filter(x => x.run === r.id);
    const wf = m.workflows.get(id);
    const x = rw.get(r.id);
    return `<div><div class="panel-head"><h3><span class="mono">${esc(r.id)}</span> · 시도 ${r.attempt}</h3>${chip(r.state)}${r.reason ? `<span class="note">${esc(r.reason)}</span>` : ''}
      <span class="note">Agent ${x.round}회차${x.round > 1 ? ` · 수정 반복 ${x.round - 1}회` : ''}${x.failed.length ? ` · 통과 못 한 검사: ${x.failed.map(f => `${esc(f.condition_id)} ${esc(f.result)}(${esc(f.evidence_id)})`).join(', ')}` : ''}</span></div>
      <div class="tbl-wrap"><table><thead><tr><th>노드</th><th>단계</th><th>회차</th><th>수행</th><th>시작–끝</th><th>결과</th></tr></thead><tbody>
      ${logs.map(l => `<tr><td>${esc(wf.nodes.get(l.node).name)}</td><td><span class="stage">${esc(wf.nodes.get(l.node).stage)}</span></td><td class="num">${l.iteration}</td>
        <td>${esc(l.actor.role ?? '')} <span class="mono">${esc(l.actor.instance)}</span>${l.profile ? ` <span class="note">${esc(profText(l.profile))}</span>` : ''}</td><td class="mono">${hm(l.started)}–${l.finished ? hm(l.finished) : '진행 중'}</td><td>${l.result ? chip(l.result) : chip('실행 중', 'run')}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }).join('') || '<p class="notice">아직 Run이 없습니다.</p>';
  const subHtml = subs.map(s => `<tr><td class="mono">${esc(s.submission_id)}</td><td>${esc(m.workflows.get(id).nodes.get(s.node_id).name)} ${s.iteration}회차</td><td class="mono">${when(s.at)}</td>
    <td>${s.slots.map(sl => `<span class="mono">${esc(sl.output_slot)}</span>${sl.artifact_ref ? ' ' + rawBtn(sl.artifact_ref, `${s.submission_id} · ${sl.output_slot}`, '원문') : ''}`).join(', ')}</td>
    <td>${chip(s.scope_check === '통과' ? '통과' : '거부')}</td><td>${rawBtn(s.diff_ref, `${s.submission_id} 변경 내용`, '변경 내용')}</td></tr>`).join('');
  return `<section class="panel">
    <div class="panel-head"><h2><span class="tid">${id}</span> ${esc(n.name)}</h2>${n.phase ? `<span class="phase-tag">${esc(phaseName(n.phase))}</span>` : ''}
      <span class="actions"><a class="btn primary" href="#agent-${id}">Agent Graph</a>${openAppr.map(a => `<a class="btn" href="#approval-${a.approval_id}">승인 ${esc(a.approval_id)} 열기</a>`).join('')}<a class="btn" href="#dag">의존 관계에서 보기</a></span></div>
    <dl class="bigcard">
      <dt>작업 상태</dt><dd>${p.state}</dd>
      <dt>검증된 완료 조건</dt><dd>${p.conds}</dd>
      <dt>차단 이유</dt><dd>${p.c.waits.length ? p.c.waits.map(w => `<div>${chip(WAIT[w.type] ?? w.type, w.action.actor === '사용자' ? 'user' : 'wait')} ${esc(w.resolve)} <span class="note">· ${esc(w.issuer)}${w.raised_at ? ` · ${esc(when(w.raised_at))}부터` : ''}</span></div>`).join('') : '없음'}</dd>
      <dt>해소 행동</dt><dd>${p.c.waits.length ? p.c.waits.map(w => `<div>${esc(w.action.actor)}: ${esc(w.action.text)} — <a href="${waitHref(id, w)}">${esc(w.action.screen)}</a></div>`).join('') : '—'}</dd>
    </dl>
    <div class="trio">
      <div><span class="k">실행 상태 (최신 Run)</span>${chip(p.c.exec === '없음' ? 'Run 없음' : p.c.exec)}</div>
      <div><span class="k">인수 상태 (Task 전체)</span>${chip(p.c.acceptance === '미인수' ? '미인수' : p.c.acceptance, p.c.acceptance === '미인수' ? 'muted' : undefined)}</div>
      <div><span class="k">활성 실행 단계</span>${p.c.stages.length ? p.c.stages.map(s => `<span class="stage">${esc(s)}</span>`).join(' ') : '없음'}</div>
    </div>
  </section>
  <section class="panel"><h2>완료 조건과 증거</h2><div class="tbl-wrap"><table><thead><tr><th>ID</th><th>조건</th><th>슬롯</th><th>방법</th><th>상태</th><th>근거</th></tr></thead><tbody>${condRows}</tbody></table></div></section>
  <section class="panel"><h2>슬롯과 의존</h2>
    <h3>입력 슬롯</h3><div class="tbl-wrap"><table><thead><tr><th>슬롯</th><th>공급</th><th>상태</th></tr></thead><tbody>${inputs || '<tr><td colspan="3">입력 없음</td></tr>'}</tbody></table></div>
    <h3>출력 슬롯</h3><div class="tbl-wrap"><table><thead><tr><th>슬롯</th><th>쓰는 Task</th><th>상태</th></tr></thead><tbody>${outputs}</tbody></table></div></section>
  <section class="panel"><h2>실행 기록</h2>${runHtml}</section>
  <section class="panel"><h2>제출 기록</h2>${subHtml ? `<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>만든 단계</th><th>시각</th><th>슬롯</th><th>쓰기 범위</th><th>원문</th></tr></thead><tbody>${subHtml}</tbody></table></div>` : '<p class="notice">제출 기록이 없습니다.</p>'}</section>
  <section class="panel"><h2>계약</h2><dl class="kv"><dt>목표</dt><dd>${esc(c.goal)}</dd><dt>전문</dt><dd>${rawBtn(c.contract_ref, `${id} 계약 전문`, '계약 전문 보기')}</dd><dt>사용량</dt><dd class="num">$${cost.toFixed(2)} (추정값)</dd></dl></section>`;
}

// ---------------- 화면: Agent Graph ----------------
function viewAgent(id) {
  const m = M();
  const n = node(id);
  const wf = m.workflows.get(id);
  if (!n || !wf) return `<p class="notice">Agent Graph가 없는 Task입니다.</p>`;
  const g = RM.agentGraph(m, id);
  const run = g.run;
  const sel = wf.nodes.has(S.agentNode) ? S.agentNode : (g.nodes.find(x => run?.active.has(x.node_id)) ?? g.nodes[0]).node_id;
  const items = g.nodes.map(gn => ({ id: gn.node_id, h: gn.profiles.length ? 130 : 112, tag: 'button', cls: `${gn.status === '실행 중' ? 'active-node' : ''} ${gn.node_id === sel ? 'sel' : ''}`,
    attrs: `type="button" data-wnode="${esc(gn.node_id)}" aria-pressed="${gn.node_id === sel}"`,
    html: `<span class="l1"><span class="stage">${esc(gn.stage)}</span>${esc({ agent: 'Agent', code: '검사 코드', human: '사람' }[gn.executor])}${gn.role ? ` · ${esc(gn.role)}` : ''}</span>
      <span class="nm">${esc(gn.name)}</span><span class="ln">${chip(gn.status, gn.status === '시작 전' ? 'muted' : undefined)}${gn.runs > 1 ? ` <span class="num">${gn.runs}회</span>` : ''}</span>
      <span class="ln"><b>수행</b>${gn.instances.length ? gn.instances.map(w => `<span class="mono">${esc(w)}</span>`).join(', ') : '—'}</span>
      ${gn.profiles.length ? `<span class="ln" title="${esc(gn.profiles.map(profText).join(', '))}"><b>실행</b>${gn.profiles.map(p => esc(profText(p))).join(', ')}</span>` : ''}` }));
  const flow = wf.edges.filter(e => e.kind !== '반복');
  const drawn = g.edges.map(e => ({ from: e.from, to: e.to, cls: e.kind === '반복' ? 'e-back' : 'e-leaf',
    label: e.kind === '반복' ? `반복 ${e.loops}회` : ['분기', '합류'].includes(e.kind) ? e.kind : '' }));
  const wn = wf.nodes.get(sel);
  const { logs: nlogs, acts, subs, evs, approvals: appr, cost: usage } = RM.nodeActivity(m, id, sel);
  const timeline = [
    ...nlogs.map(l => ({ at: l.started, html: `<span class="who">${esc(l.actor.role ?? '')} <span class="mono">${esc(l.actor.instance)}</span>${l.profile ? ` · ${esc(profText(l.profile))}` : ''}</span>${l.iteration}회차 시작${l.finished ? ` · ${hm(l.finished)}에 ${esc(l.result)}` : ' · 진행 중'}`, cls: '' })),
    ...acts.map(a => ({ at: a.at, cls: a.source === 'Agent 보고' ? 'agent-report' : '',
      html: `<span class="who">${esc(a.actor.role ?? '')} <span class="mono">${esc(a.actor.instance)}</span> · ${esc(a.kind)}${a.to_instance ? ` → <span class="mono">${esc(a.to_instance)}</span>` : ''} <span class="src ${a.source === 'Agent 보고' ? 'src-agent' : 'src-sys'}">${esc(a.source)}${a.source === 'Agent 보고' ? ' · 증거 아님' : ''}</span></span>${esc(a.summary)} ${rawBtn(a.raw_ref, `${a.actor.instance} 활동 원문`)}` })),
    ...subs.map(s => ({ at: s.at, cls: '', html: `<span class="who">Catena · 제출 기록</span><span class="mono">${esc(s.submission_id)}</span> 고정 ${rawBtn(s.diff_ref, `${s.submission_id} 변경 내용`, '변경 내용')}` })),
    ...evs.map(e => ({ at: e.at, cls: '', html: `<span class="who">검사 코드 · 증거 <span class="src src-sys">시스템 기록</span></span>${esc(e.condition_id)} ${chip(e.result)} ${rawBtn(e.raw_log_ref, `${e.evidence_id} 검사 로그`, '로그')}` })),
    ...appr.map(a => ({ at: a.requested, cls: '', html: `<span class="who">승인 요청</span><a href="#approval-${a.approval_id}">${esc(a.approval_id)}</a> · ${a.decision ? `${chip(a.decision)} ${esc(a.comment ?? '')}` : chip('결정 전', 'user')}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return `<section class="panel">
    <div class="panel-head"><h2><span class="tid">${id}</span> ${esc(n.name)} · Agent Graph</h2>
      ${run ? `<span class="note"><span class="mono">${esc(run.id)}</span> · 시도 ${run.attempt} · ${esc(run.state)}${run.reason ? ` (${esc(run.reason)})` : ''}</span>` : '<span class="note">아직 Run이 없어 정의만 보여 줍니다.</span>'}
      <span class="actions"><a class="btn" href="#task-${id}">Task 상세</a></span></div>
    <div class="legend"><span>단계 종류: 계획 · 구현 · 검증 · 승인 (Project Phase와 다름)</span><span><svg width="44" height="10"><path d="M2,5 L40,5" class="e e-back"/></svg>반복(수정 루프, 지금까지 돈 횟수)</span><span>파란 테두리: 지금 실행 중인 노드</span></div>
    ${graph(items, flow, drawn, { w: 230, gx: 60, backArcs: true })}
  </section>
  <section class="panel">
    <div class="panel-head"><h2>${esc(wn.name)} 활동 기록</h2><span class="note">${esc(wn.stage)} 단계 · ${esc({ agent: 'Agent', code: '검사 코드', human: '사람' }[wn.executor])}${usage ? ` · 사용량 $${usage.toFixed(2)} (추정값)` : ''}</span></div>
    <p class="notice">점선 항목은 Agent가 스스로 보고한 내용입니다. 증거가 아니며, 검사 결과와 다를 수 있습니다.</p>
    ${timeline.length ? `<ul class="acts">${timeline.map(t => `<li class="${t.cls}"><span class="t">${hm(t.at)}</span><span>${t.html}</span></li>`).join('')}</ul>` : '<p class="notice">아직 기록이 없습니다.</p>'}
  </section>`;
}

// ---------------- 화면: 승인 ----------------
function viewApproval(aid) {
  const m = M();
  const a = m.approvals.get(aid);
  if (!a) return `<p class="notice">이 재생 위치에는 승인 ${esc(aid)}이 없습니다.</p>`;
  const s = m.submissions.get(a.submission_id);
  const c = m.contracts.get(a.task);
  const evs = [...m.evidence.values()].filter(e => e.submission_id === a.submission_id);
  const diff = s ? S.files.get(s.diff_ref.id.slice(7))?.text ?? '' : '';
  const diffHtml = diff.split('\n').map(l => `<span class="${l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l)}</span>`).join('\n');
  return `<section class="panel">
    <div class="panel-head"><h2>승인 <span class="mono">${esc(aid)}</span> · <a href="#task-${a.task}"><span class="tid">${a.task}</span> ${esc(nameOf(a.task))}</a></h2>${a.decision ? chip(a.decision) : chip('결정 전', 'user')}</div>
    <dl class="kv"><dt>종류</dt><dd>${esc(a.kind)} 승인</dd><dt>요청</dt><dd>${esc(when(a.requested))}</dd>
      <dt>승인할 조건</dt><dd>${a.condition_ids.map(cid => `<div><span class="mono">${esc(cid)}</span> ${esc(c.conditions.find(x => x.condition_id === cid)?.description)}</div>`).join('')}</dd>
      <dt>대상</dt><dd>제출 기록 <span class="mono">${esc(a.submission_id)}</span> — 승인은 이 제출 기록에만 적용됩니다.</dd>
      ${a.decision ? `<dt>결정</dt><dd>${esc(a.decision)} · ${esc(when(a.decided))} · ${esc(a.comment ?? '')}</dd>` : ''}</dl>
    <div class="panel-head"><span class="actions" style="margin-left:0"><button class="btn primary" disabled>승인</button><button class="btn" disabled>반려</button></span>
      <span class="note">Product MVP는 읽기 전용입니다. 승인 처리는 Integrated MVP부터 동작합니다.</span></div>
  </section>
  <section class="panel"><h2>같은 제출 기록의 증거</h2>
    ${evs.length ? `<div class="tbl-wrap"><table><thead><tr><th>증거</th><th>조건</th><th>결과</th><th>검증 정의</th><th>로그</th></tr></thead><tbody>${evs.map(e => `<tr><td class="mono">${esc(e.evidence_id)}</td><td class="mono">${esc(e.condition_id)}</td><td>${chip(e.result)}</td>
      <td>${e.verifier_ref ? rawBtn(e.verifier_ref, '검증 정의') : '<span class="note">이 데이터에는 검증 정의 참조가 없어 계약과 일치하는지 확인할 수 없음</span>'}</td><td>${rawBtn(e.raw_log_ref, `${e.evidence_id} 검사 로그`, '로그')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="notice">이 제출 기록에는 자동 검사 증거가 없습니다. 사람 승인 조건만 있습니다.</p>'}
  </section>
  <section class="panel"><h2>변경 내용 <span class="mono">${esc(a.submission_id)}</span></h2><pre class="raw-text">${diffHtml}</pre></section>`;
}

// ---------------- 화면: Phase, Milestone ----------------
function viewPhase() {
  const m = M();
  const ids = RM.tasksUnder(m);
  const phaseOf = id => node(id).phase;
  const between = new Map();
  for (const d of m.deps) {
    if (d.from.external_ref) continue;
    const a = phaseOf(d.from.task_id), b = phaseOf(d.to.task_id);
    if (!a || !b || a === b) continue;
    const k = `${a}>${b}`;
    const x = between.get(k) ?? { a, b, n: 0, acc: 0 };
    x.n++; if (m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)) x.acc++;
    between.set(k, x);
  }
  const mini = id => {
    const p = cardParts(id);
    const wbs = RM.path(m, id).slice(0, -1).map(nameOf).join(' / ') || '최상위';
    return `<a class="mini" href="#task-${id}"><span class="path">${esc(wbs)}</span><span><span class="tid">${id}</span> <strong>${esc(nameOf(id))}</strong></span><span>${p.state}</span><span>${p.conds}</span><span>${p.block}</span></a>`;
  };
  return `<section class="panel">
    <div class="panel-head"><h2>Phase별 공정</h2><span class="note">Phase는 Task의 속성이며 WBS 계층이 아닙니다. 같은 Workstream의 Task가 여러 Phase에 나뉩니다.</span></div>
    <div class="phase-grid">${m.project.phases.map(ph => {
      const ts = ids.filter(id => phaseOf(id) === ph.phase_id);
      const a = aggregate(ts);
      return `<div class="phase-col"><header><strong>${esc(ph.name)}</strong> <span class="note num">Task ${ts.length} · 완료 조건 ${a.acc}/${a.tot}</span><div>${countsHtml(a.counts)}</div></header>${ts.map(mini).join('')}</div>`;
    }).join('')}</div>
    <h3>Phase 묶음 사이의 의존 (집계 엣지)</h3>
    <ul class="plain-list">${[...between.values()].map(x => {
      const back = between.get(`${x.b}>${x.a}`);
      return `<li>${esc(phaseName(x.a))} → ${esc(phaseName(x.b))}: 의존 ${x.n}개 · 인수 ${x.acc}${back ? ' <span class="note">(반대 방향도 있음 — 하위 Task 의존을 묶은 것이며 순환 아님)</span>' : ''}</li>`;
    }).join('')}</ul>
  </section>`;
}

function viewMilestone() {
  const m = M();
  return [...m.milestones.values()].map(ms => {
    const done = it => it.slot ? m.slotAccepted.has(`${it.task_id}/${it.slot}`) : m.taskAccepted.has(it.task_id);
    const k = ms.items.filter(done).length;
    return `<section class="panel">
      <div class="panel-head"><h2>${esc(ms.name)}</h2><span class="note num">${k} / ${ms.items.length} 도달</span><span class="dots" aria-hidden="true">${ms.items.map(it => `<i class="${done(it) ? 'on' : ''}"></i>`).join('')}</span></div>
      <p class="notice">Milestone은 날짜가 아니라 인수되어야 할 항목의 목록입니다.</p>
      <ul class="todo-list">${ms.items.map(it => {
        const c = RM.card(m, it.task_id);
        const w = c.waits[0];
        return `<li class="todo-item"><span><span class="what">${chip(done(it) ? '인수됨' : '남음', done(it) ? 'ok' : 'muted')} <span class="tid">${it.task_id}</span> ${esc(nameOf(it.task_id))}${it.slot ? ` · 슬롯 <span class="mono">${esc(it.slot)}</span>` : ''}</span><br>
          <span class="why">${done(it) ? '도달' : `${esc(c.rep)}${w ? ` · ${esc(WAIT[w.type] ?? w.type)}: ${esc(w.resolve)} → ${esc(w.action.actor)}: ${esc(w.action.text)}` : ''}`}</span></span>
          <a class="btn" href="#task-${it.task_id}">열기</a></li>`;
      }).join('')}</ul></section>`;
  }).join('');
}

// ---------------- 원문 보기, 클릭 ----------------
function openRaw(hex, title) {
  const f = S.files.get(hex);
  $('raw-title').textContent = title;
  $('raw-hash').textContent = f?.ok ? `sha256:${hex.slice(0, 12)}… · 해시 확인됨${sim() ? ' · 시뮬레이션 원문' : ''}` : (f?.err ?? '원문 없음');
  const text = f?.text ?? '';
  $('raw-text').innerHTML = text.split('\n').map(l => `<span class="${/^(\+\+\+|---|@@)/.test(l) ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}">${esc(l)}</span>`).join('\n');
  $('raw').hidden = false;
  $('raw-close').focus();
}
document.addEventListener('click', e => {
  const raw = e.target.closest('[data-raw]');
  if (raw) { openRaw(raw.dataset.raw, raw.dataset.title); return; }
  const sel = e.target.closest('[data-sel]');
  if (sel) { S.dagSel = S.dagSel === sel.dataset.sel ? null : sel.dataset.sel; render(); return; }
  const wn = e.target.closest('[data-wnode]');
  if (wn) { S.agentNode = wn.dataset.wnode; render(); return; }
  if (e.target.closest('[data-crumbs]')) { S.crumbsOpen = true; $('crumbs').innerHTML = crumbsHtml(); return; }
  if (e.target.id === 'raw' || e.target.id === 'raw-close') $('raw').hidden = true;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('raw').hidden = true; });

load();
