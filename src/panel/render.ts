// Pure rendering: snapshot + UI state + clock -> HTML strings, one per section. No DOM access,
// so it runs in Node tests. Every value from the snapshot goes through esc().
import { fmtClock, fmtDuration, fmtTokens, fmtUntil, fmtUsd, modelLabel, pct } from '../shared/format'
import { VERSION } from '../shared/version'
import type { AgentView, BackgroundView, CrewKeyView, CrewSeatView, CrewTaskView, CrewView, GateEntry, LogEntry, Snapshot, SubagentView, ToolFamily, TurnView } from '../shared/types'

export interface UiState {
  family: ToolFamily | null
  /** Open/closed overrides: `car:<key>` for idle agents, `sub:<key>` for all subagents, `bg:<key>` for all background work, `sec:<name>` for sections. */
  expanded: Record<string, boolean>
  menu: boolean
  /** Show only this agent (its card, tool calls and activity). Asks from other agents still show. */
  only: string | null
}

/** Where Pitwall lives; opened in the browser only on a click. */
export const REPO_URL = 'https://github.com/sonthh/orca-pitwall'

/** The gateway's LiteLLM dashboard; opened in the browser only on a click. */
export const LITELLM_URL = 'https://agni1.tailce14cd.ts.net:4643/ui'

export const INITIAL_UI: UiState = { family: null, expanded: {}, menu: false, only: null }

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

const STATE_LABEL: Record<string, string> = { working: 'Working', blocked: 'Needs you', waiting: 'Waiting', done: 'Idle', unknown: '' }
const SECTION_DEFAULT: Record<string, boolean> = { idle: true, calls: false, log: false }

function since(at: number, now: number): string {
  return `<span data-since="${at}">${esc(fmtDuration(now - at))}</span>`
}

function ago(at: number, now: number): string {
  return `<span data-ago="${at}">${esc(fmtDuration(now - at))}</span>`
}

function until(at: number, now: number): string {
  return `<span data-until="${at}">${esc(fmtUntil(at - now))}</span>`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function isLive(a: AgentView): boolean {
  return a.state === 'working' || a.state === 'blocked'
}

function goButton(s: Snapshot, key: string, label: string, cls = 'go'): string {
  const a = s.agents.find((x) => x.key === key)
  return a?.canFocus ? `<button class="${cls}" data-action="focus" data-key="${esc(key)}" title="Bring its terminal to the front">${label}</button>` : ''
}

function nameOf(s: Snapshot, key: string): string {
  const a = s.agents.find((x) => x.key === key)
  return a ? a.title || a.workspaceName : 'An agent'
}

export function sectionOpen(ui: UiState, name: string): boolean {
  return ui.expanded['sec:' + name] ?? SECTION_DEFAULT[name] ?? true
}

/** The agents the panel shows: one when the person picked it and it still exists, else all. */
export function visibleAgents(s: Snapshot, ui: UiState): AgentView[] {
  if (ui.only && s.agents.some((a) => a.key === ui.only)) return s.agents.filter((a) => a.key === ui.only)
  return s.agents
}

function ctxPct(a: AgentView): number | null {
  return a.ctxWindow ? pct(a.ctxTokens, a.ctxWindow) : null
}

function ctxTone(p: number): string {
  return p >= 90 ? 'bad' : p >= 75 ? 'warn' : ''
}

export function renderHeader(s: Snapshot, ui: UiState): string {
  const scope = s.scope
  const count = (st: string) => s.agents.filter((a) => a.state === st).length
  const parts = [
    count('blocked') ? `<span class="sum warn">${count('blocked')} need you</span>` : '',
    count('working') ? `<span class="sum run">${count('working')} working</span>` : '',
    s.agents.length - count('blocked') - count('working') ? `<span class="sum">${s.agents.length - count('blocked') - count('working')} idle</span>` : '',
    s.agents.some((a) => a.unseen) ? `<span class="sum new" title="Finished while you were elsewhere">${s.agents.filter((a) => a.unseen).length} new</span>` : ''
  ].filter(Boolean)
  // A transcript still being read would make the total a partial sum.
  const total = s.agents.some((a) => a.loading) ? 0 : s.agents.reduce((n, a) => n + (a.costUsd ?? 0), 0)
  const only = ui.only ? s.agents.find((a) => a.key === ui.only) : null
  return `<header class="top">
  <span class="title">Pitwall</span>${s.demo ? '<span class="badge">Demo</span>' : ''}
  <div class="seg" role="group" aria-label="Show agents from">
    <button data-action="scope" data-scope="focused" class="${scope === 'focused' ? 'on' : ''}" title="Agents in the focused workspace">This</button>
    <button data-action="scope" data-scope="all" class="${scope === 'all' ? 'on' : ''}" title="Agents in every workspace">All</button>
  </div>
  <button class="icon" data-action="menu" aria-label="More" title="More">⋯</button>
  ${
    ui.menu
      ? `<div class="menu" role="menu">
    <button role="menuitem" data-action="demo">${s.demo ? 'Leave demo mode' : 'Demo mode'}</button>
    ${s.demo ? '' : `<button role="menuitemcheckbox" aria-checked="${s.crew ? 'true' : 'false'}" data-action="crew" title="The Agni crew: tasks, seats and gateway keys, read over SSH">${s.crew ? '✓ ' : ''}Crew</button>`}
    <button role="menuitem" data-action="reset">Clear tool calls and activity</button>
    <div class="menu-sep" role="separator"></div>
    <button role="menuitem" data-action="github" title="${REPO_URL}">★ Star Pitwall on GitHub</button>
  </div>`
      : ''
  }
</header>
${
  only
    ? `<div class="only-bar"><span class="ell">Only <b>${esc(only.title || only.workspaceName)}</b></span><button class="chip-btn" data-action="only" data-key="" title="Show every agent">Show all ×</button></div>`
    : parts.length
      ? `<div class="summary">${parts.join('')}${s.showCost && total > 0 ? `<span class="sum right" title="API list price of all sessions shown">${esc(fmtUsd(total))}</span>` : ''}</div>`
      : ''
}`
}

/** Context share at which a working agent gets a heads-up to compact. */
const CTX_ALERT = 90

export function renderAlerts(s: Snapshot, now: number): string {
  const asking = s.gate.filter((g) => g.state === 'asking')
  const blockedAgents = s.agents.filter((a) => a.state === 'blocked' && !asking.some((g) => g.agentKey === a.key))
  // A working agent close to its window is about to compact and lose detail: say so while there is time.
  const full = s.agents.filter((a) => a.state === 'working' && (ctxPct(a) ?? 0) >= CTX_ALERT)
  const crew = crewAlerts(s.crew, now)
  if (!asking.length && !blockedAgents.length && !full.length && !crew.length) return ''
  const rows = [
    ...asking.map(
      (g) =>
        `<div class="alert"><div class="row"><span class="badge-warn">Needs you</span><span class="ell"><b>${esc(nameOf(s, g.agentKey))}</b> wants <code>${esc(g.tool)}</code></span><span class="right sub-t">${since(g.at, now)}</span></div>${g.summary ? `<div class="what" title="${esc(g.summary)}">${esc(g.summary)}</div>` : ''}<div class="alert-foot"><span class="hint">Answer in its terminal.</span>${goButton(s, g.agentKey, 'Go to terminal ↗')}</div></div>`
    ),
    ...blockedAgents.map(
      (a) =>
        `<div class="alert"><div class="row"><span class="badge-warn">Needs you</span><span class="ell"><b>${esc(a.title || a.workspaceName)}</b> is waiting for you</span><span class="right sub-t">${since(a.stateSince, now)}</span></div><div class="alert-foot"><span class="hint">Answer in its terminal.</span>${goButton(s, a.key, 'Go to terminal ↗')}</div></div>`
    ),
    ...full.map(
      (a) =>
        `<div class="alert soft"><div class="row"><span class="pill ${ctxTone(ctxPct(a)!)}">Context ${Math.round(ctxPct(a)!)}%</span><span class="ell"><b>${esc(a.title || a.workspaceName)}</b> will compact soon</span></div><div class="alert-foot"><span class="hint">Run <code>/compact</code> at a good stopping point to keep what matters.</span>${goButton(s, a.key, 'Go ↗', 'go soft')}</div></div>`
    ),
    ...crew
  ]
  return `<section class="alerts" aria-live="polite">${rows.join('')}</section>`
}

function ctxBlock(a: AgentView): string {
  const p = ctxPct(a)
  if (p === null) return ''
  const tone = ctxTone(p)
  const of =
    a.ctxBasis === 'compact'
      ? `the ${fmtTokens(a.ctxWindow)} auto-compact window (model window ${fmtTokens(a.ctxModelWindow)}; Claude Code's status line counts against the model window)`
      : a.ctxBasis === 'setting'
        ? `${fmtTokens(a.ctxWindow)}, the Context window setting${a.ctxModelWindow && a.ctxModelWindow !== a.ctxWindow ? ` (model window ${fmtTokens(a.ctxModelWindow)})` : ''}`
        : `the ${fmtTokens(a.ctxWindow)} model window`
  const tip = `${fmtTokens(a.ctxTokens)} of ${of}${a.compactions ? `, compacted ${a.compactions}×` : ''}${a.cacheHitPct !== null ? `, ${Math.round(a.cacheHitPct)}% of the latest prompt from cache` : ''}`
  return `<div class="ctx" title="${esc(tip)}">
  <div class="ctx-line"><span class="sub-t">Context</span><span class="ctx-num ${tone}">${Math.round(p)}%</span><span class="muted ell">${esc(fmtTokens(a.ctxTokens))} / ${esc(fmtTokens(a.ctxWindow!))}${a.compactions ? ` · compacted ${a.compactions}×` : ''}</span></div>
  <div class="meter${tone ? ' ' + tone : ''}"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div>
</div>`
}

function turnBlock(t: TurnView | null, last: boolean, showCost: boolean, now: number, a?: AgentView, ui?: UiState): string {
  if (!t) return ''
  const bits = [
    plural(t.tools, 'tool'),
    t.edits ? plural(t.edits, 'edit') : '',
    t.agents
      ? a && ui && !ui.expanded['sub:' + a.key] && !a.subagents.some((x) => x.status === 'running')
        ? `<button class="link inline" data-action="expand" data-key-x="sub:${esc(a.key)}" title="List them">${plural(t.agents, 'subagent')}</button>`
        : plural(t.agents, 'subagent')
      : '',
    t.errors ? `<span class="bad-t">${plural(t.errors, 'error')}</span>` : '',
    showCost && t.costUsd !== null && t.costUsd >= 0.005 ? esc(fmtUsd(t.costUsd)) : ''
  ].filter(Boolean)
  const when = t.endedAt ? esc(fmtDuration(t.endedAt - t.startedAt)) : since(t.startedAt, now)
  return `<div class="block">
  ${t.prompt ? `<div class="prompt" title="${esc(t.prompt)}">${esc(t.prompt)}</div>` : ''}
  <div class="sub-t small">${last ? 'Last turn' : 'This turn'} ${when} · ${bits.join(' · ')}</div>
</div>`
}

function subagentBlock(a: AgentView, ui: UiState, now: number): string {
  const subs = a.subagents
  if (!subs.length) return ''
  const all = !!ui.expanded['sub:' + a.key]
  const running = subs.filter((x) => x.status === 'running')
  // Finished subagents are a count in the turn line; the list shows while some run, or on request.
  if (!running.length && !all) return ''
  const recent = subs.filter((x) => x.status !== 'running' && now - (x.endedAt ?? now) < 30 * 60 * 1000)
  const shown = all ? subs : [...running, ...recent.slice(-Math.max(0, 3 - running.length))]
  const less = all && !running.length ? `<button class="link" data-action="expand" data-key-x="sub:${esc(a.key)}">Hide</button>` : ''
  const total = Math.max(a.subagentTotal, subs.length)
  const rows = shown
    .map((x: SubagentView) => {
      const info = [`${x.type}: ${x.task}`, `${modelLabel(x.model)} · ${x.steps} steps · ${fmtTokens(x.ctxTokens)} context`, x.lastTools.length ? 'last: ' + x.lastTools.join(', ') : ''].filter(Boolean).join('\n')
      const time = x.status === 'running' ? since(x.startedAt, now) : esc(fmtDuration((x.endedAt ?? now) - x.startedAt))
      const mark = x.status === 'running' ? '<span class="dot run"></span>' : x.status === 'error' ? '<span class="mark bad-t">✗</span>' : '<span class="mark ok-t">✓</span>'
      return `<div class="item" title="${esc(info)}">${mark}<span class="ell"><b class="w5">${esc(x.type)}</b> <span class="sub-t">${esc(x.task)}</span></span><span class="muted">${time}</span></div>`
    })
    .join('')
  const more =
    subs.length > shown.length
      ? `<button class="link" data-action="expand" data-key-x="sub:${esc(a.key)}">Show all ${subs.length}</button>`
      : all && subs.length > 3
        ? `<button class="link" data-action="expand" data-key-x="sub:${esc(a.key)}">Show fewer</button>`
        : ''
  return `<div class="block"><div class="block-title">Subagents <span class="muted">${running.length ? `${running.length} running · ` : ''}${total} this session</span></div>${rows}${less || more}</div>`
}

const BG_MARK: Record<BackgroundView['kind'], string> = {
  shell: '<span class="dot run"></span>',
  monitor: '<span class="mark">◉</span>',
  cron: '<span class="mark">↻</span>',
  wakeup: '<span class="mark">◷</span>'
}
const BG_WORD: Record<BackgroundView['kind'], string> = { shell: 'shell', monitor: 'monitor', cron: 'cron', wakeup: 'wakeup' }

function isRunning(x: BackgroundView): boolean {
  return x.kind === 'shell' || x.kind === 'monitor'
}

/** Right-hand side of a background row: how long it has run, or when it runs next. */
function bgWhen(x: BackgroundView, now: number): string {
  if (isRunning(x)) return x.startedAt !== null ? since(x.startedAt, now) : ''
  if (x.overdue) return '<span class="warn-t">due</span>'
  if (x.dueAt === null) return ''
  if (x.dueAt <= now) return 'now'
  // The clock time it runs at; today's also say how long until then.
  const clock = esc(fmtClock(x.dueAt, now))
  return isToday(x.dueAt, now) ? `${clock} · in ${until(x.dueAt, now)}` : clock
  return ''
}

function isToday(at: number, now: number): boolean {
  return new Date(at).toDateString() === new Date(now).toDateString()
}

/** Plain-text detail for a background row's tooltip. */
export function bgTip(x: BackgroundView, now: number): string {
  const lines = [`${BG_WORD[x.kind]}: ${x.label}`]
  if (x.kind === 'shell') lines.push(x.startedAt !== null ? `Running since ${fmtClock(x.startedAt, now)}` : 'Running')
  if (x.kind === 'monitor') lines.push(`Watching${x.startedAt !== null ? ' since ' + fmtClock(x.startedAt, now) : ''}${x.endsAt !== null ? ', stops by ' + fmtClock(x.endsAt, now) : ''}`)
  if (x.kind === 'cron' || x.kind === 'wakeup') {
    const sched = x.kind === 'wakeup' ? '/loop wakeup' : x.recurring ? x.schedule ?? 'Recurring' : `Once${x.schedule ? ' (' + x.schedule + ')' : ''}`
    const next = x.overdue ? 'due now, runs once the agent is idle' : x.dueAt !== null ? `${x.recurring ? 'next' : 'at'} ${fmtClock(x.dueAt, now)}` : ''
    lines.push([sched, next].filter(Boolean).join(' · '))
    if (x.kind === 'cron' && x.recurring && x.endsAt !== null) lines.push(`Expires ${fmtClock(x.endsAt, now)}`)
  }
  if (x.detail) lines.push(x.detail)
  return lines.join('\n')
}

const BG_SHOWN = 4

function backgroundBlock(a: AgentView, ui: UiState, now: number): string {
  const list = a.background
  if (!list.length) return ''
  const all = !!ui.expanded['bg:' + a.key]
  const { running, scheduled } = a.backgroundCount
  const unsent = running + scheduled - list.length
  const head = [running ? `${running} running` : '', scheduled ? `${scheduled} scheduled` : ''].filter(Boolean).join(' · ')
  const shown = all ? list : list.slice(0, BG_SHOWN)
  const more =
    list.length > BG_SHOWN
      ? `<button class="link" data-action="expand" data-key-x="bg:${esc(a.key)}">${all ? 'Show fewer' : `Show all ${a.backgroundCount.running + a.backgroundCount.scheduled}`}</button>`
      : ''
  const rows = shown
    .map((x) => `<div class="item bg-row" title="${esc(bgTip(x, now))}">${BG_MARK[x.kind]}<span class="ell"><b class="w5">${BG_WORD[x.kind]}</b> <span class="sub-t">${esc(x.label)}</span></span><span class="muted">${bgWhen(x, now)}</span></div>`)
    .join('')
  const rest = all && unsent > 0 ? `<div class="muted small">${unsent} more not listed</div>` : ''
  return `<div class="block"><div class="block-title">Background <span class="muted">${head}</span></div>${rows}${rest}${more}</div>`
}

/** One pill on an idle row: when the next schedule runs, else how many run in the background. */
function bgPill(a: AgentView, now: number): string {
  const list = a.background
  if (!list.length) return ''
  const tip = list.map((x) => bgTip(x, now).split('\n').slice(0, 2).join(' · ')).join('\n')
  const next = list.find((x) => !isRunning(x) && (x.overdue || x.dueAt !== null))
  const running = a.backgroundCount.running
  const text = next ? `◷ ${next.overdue ? 'due' : next.dueAt! <= now ? 'now' : until(next.dueAt!, now)}` : running ? `▶ ${running}` : `◷ ${list.length}`
  return `<span class="pill${next?.overdue ? ' warn' : ''}" title="${esc(tip)}">${text}</span>`
}

const STATE_WORD: Record<GateEntry['state'], string> = { running: 'running', asking: 'asking you', ok: 'done', error: 'failed', denied: 'denied' }
const STATE_ICON: Record<GateEntry['state'], string> = { running: '•', asking: '?', ok: '✓', error: '✗', denied: '⊘' }

/** File calls lead with the file name, so a narrow panel cuts the folder, not the name. */
function callText(e: GateEntry): string {
  const m = e.family === 'file' ? /^(.*\/)([^/\s]+)$/.exec(e.summary) : null
  return m ? `${esc(m[2])} <span class="muted">${esc(m[1].replace(/\/$/, ''))}</span>` : esc(e.summary)
}

function callRow(e: GateEntry, now: number, who: string | null): string {
  const tip = `${e.tool}${e.summary ? ': ' + e.summary : ''} (${STATE_WORD[e.state]}${e.sub ? ', subagent' : ''}${who ? ', ' + who : ''})`
  return `<div class="call s-${e.state}" title="${esc(tip)}"><span class="ico">${STATE_ICON[e.state]}</span><code>${esc(e.tool)}</code><span class="sub-t ell">${callText(e)}</span><span class="muted">${ago(e.at, now)}</span></div>`
}

function recentCalls(a: AgentView, s: Snapshot, now: number): string {
  const mine = s.gate.filter((g) => g.agentKey === a.key).slice(-4).reverse()
  if (!mine.length) return ''
  return `<div class="block"><div class="block-title">Recent tool calls</div>${mine.map((e) => callRow(e, now, null)).join('')}</div>`
}

function stateBadge(a: AgentView, now: number): string {
  return `<span class="state ${esc(a.state)}">${esc(STATE_LABEL[a.state] ?? a.state)} ${since(a.stateSince, now)}</span>`
}

function onlyButton(a: AgentView, ui: UiState): string {
  if (ui.only === a.key) return ''
  return `<button class="icon small-icon" data-action="only" data-key="${esc(a.key)}" title="Show only this agent" aria-label="Show only this agent">◎</button>`
}

function agentCard(a: AgentView, s: Snapshot, ui: UiState, now: number, collapsible: boolean): string {
  const name = a.title || a.workspaceName
  const second = s.scope === 'all' ? a.workspaceName : a.branch
  const meta = [a.model ? modelLabel(a.model) : a.agentKind, a.effort ?? '', s.showCost && a.costUsd !== null ? fmtUsd(a.costUsd) : ''].filter(Boolean)
  const head = `<div class="card-head${collapsible ? ' clickable' : ''}"${collapsible ? ` data-action="expand" data-key-x="car:${esc(a.key)}" title="Collapse" tabindex="0" role="button"` : ''}>
    <div class="name clamp" title="${esc(name)}">${collapsible ? '<span class="chev">▾</span>' : ''}${esc(name)}</div>
    <div class="row sub-t small">${stateBadge(a, now)}<span class="ell">${[second && second !== name ? second : '', ...meta].filter(Boolean).map(esc).join(' · ')}</span></div>
  </div>`
  const unknown = a.formatUnknown
    ? `<div class="block small bad-t">Pitwall does not recognise this transcript's format, so context, cost and turns may be missing. Update Pitwall.</div>`
    : ''
  const body =
    unknown +
    (a.source === 'transcript'
      ? [ctxBlock(a), turnBlock(a.turn, false, s.showCost, now, a, ui) || turnBlock(a.lastTurn, true, s.showCost, now, a, ui), subagentBlock(a, ui, now), backgroundBlock(a, ui, now), recentCalls(a, s, now)].join('')
      : `<div class="block sub-t small">${a.loading ? 'Reading its transcript…' : a.agentKind === 'claude' ? 'Waiting for its transcript…' : 'State and tool calls only: Pitwall reads Claude Code transcripts today.'}</div>${recentCalls(a, s, now)}`)
  return `<article class="agent card ${esc(a.state)}"><div class="card-tools">${a.canFocus ? `<button class="icon small-icon" data-action="focus" data-key="${esc(a.key)}" title="Go to its terminal" aria-label="Go to its terminal">↗</button>` : ''}${onlyButton(a, ui)}${collapsible ? `<button class="icon small-icon" data-action="expand" data-key-x="car:${esc(a.key)}" title="Close details" aria-label="Close details">×</button>` : ''}</div>${head}${body}</article>`
}

function idleRow(a: AgentView, s: Snapshot, ui: UiState, now: number): string {
  const name = a.title || a.workspaceName
  const p = ctxPct(a)
  const tone = p === null ? '' : ctxTone(p)
  const second = s.scope === 'all' ? a.workspaceName : null
  // The whole row opens its details in place (like the section heads); going to the terminal is its own
  // always-visible button, so a click never switches tabs by surprise.
  return `<article class="agent line ${esc(a.state)}" data-action="expand" data-key-x="car:${esc(a.key)}" title="Show details" tabindex="0" role="button" aria-expanded="false">
  <span class="chev">▸</span>${a.unseen ? '<span class="new-dot" title="Finished while you were elsewhere" aria-label="new"></span>' : ''}
  <span class="ell"><span class="name">${esc(name)}</span>${second && second !== name ? ` <span class="muted">${esc(second)}</span>` : ''}</span>
  <span class="hover-tools">${onlyButton(a, ui)}</span>
  ${bgPill(a, now)}
  ${p !== null ? `<span class="pill ${tone}" title="Context ${esc(fmtTokens(a.ctxTokens))} / ${esc(fmtTokens(a.ctxWindow!))}">${Math.round(p)}%</span>` : ''}
  <span class="muted time">${since(a.stateSince, now)}</span>
  ${a.canFocus ? `<button class="icon go-icon" data-action="focus" data-key="${esc(a.key)}" title="Go to its terminal" aria-label="Go to its terminal">↗</button>` : ''}
</article>`
}

export function renderAgent(a: AgentView, s: Snapshot, ui: UiState, now: number): string {
  if (isLive(a)) return agentCard(a, s, ui, now, false)
  if (ui.expanded['car:' + a.key] || ui.only === a.key) return agentCard(a, s, ui, now, ui.only !== a.key)
  return idleRow(a, s, ui, now)
}

function sectionHead(name: string, title: string, extra: string, ui: UiState): string {
  const open = sectionOpen(ui, name)
  return `<button class="sec-head" data-action="expand" data-key-x="sec:${name}" aria-expanded="${open}"><span class="chev">${open ? '▾' : '▸'}</span><span class="sec-title">${title}</span><span class="right sub-t small">${extra}</span></button>`
}

export function renderAgents(s: Snapshot, ui: UiState, now: number): string {
  if (!s.agents.length) return renderEmpty(s)
  const shown = visibleAgents(s, ui)
  const active = shown.filter((a) => isLive(a) || ui.only === a.key)
  // Just finished and not looked at first, then the most recent: the list answers "what needs a look?".
  const idle = shown.filter((a) => !active.includes(a)).sort((x, y) => Number(y.unseen) - Number(x.unseen) || y.stateSince - x.stateSince)
  const cards = active.map((a) => renderAgent(a, s, ui, now)).join('')
  // An opened idle agent stays where it was in the list, so the reader does not lose their place.
  const idleList = idle.length
    ? `<section class="sec">${sectionHead('idle', 'Idle', String(idle.length), ui)}${sectionOpen(ui, 'idle') ? `<div class="lines">${idle.map((a) => (ui.expanded['car:' + a.key] ? `<div class="inline-card">${agentCard(a, s, ui, now, true)}</div>` : idleRow(a, s, ui, now))).join('')}</div>` : ''}</section>`
    : ''
  return `${cards ? `<div class="cards">${cards}</div>` : ''}${idleList}`
}

const FAMILIES: ToolFamily[] = ['file', 'shell', 'web', 'mcp', 'agent', 'other']

export function renderGate(s: Snapshot, ui: UiState, now: number): string {
  const keys = new Set(visibleAgents(s, ui).map((a) => a.key))
  const g = s.gate.filter((e) => keys.has(e.agentKey) || !s.agents.some((a) => a.key === e.agentKey) && !ui.only)
  if (!g.length) return ''
  const counts = { running: 0, asking: 0, ok: 0, error: 0, denied: 0 }
  for (const e of g) counts[e.state]++
  const tally = [
    counts.running ? `${counts.running} running` : '',
    counts.asking ? `${counts.asking} asking` : '',
    counts.ok ? `${counts.ok} done` : '',
    counts.error ? `<span class="bad-t">${counts.error} failed</span>` : '',
    counts.denied ? `<span class="bad-t">${counts.denied} denied</span>` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  const head = sectionHead('calls', 'Tool calls', tally, ui)
  if (!sectionOpen(ui, 'calls')) return `<section class="sec gate">${head}</section>`
  const fams = FAMILIES.map((f) => ({ f, n: g.filter((e) => e.family === f).length }))
    .filter((x) => x.n)
    .map((x) => `<button class="fam${ui.family === x.f ? ' on' : ''}" data-action="family" data-family="${x.f}" title="Only ${x.f} calls">${x.f} <span class="muted">${x.n}</span></button>`)
    .join('')
  const multi = keys.size > 1
  const rows = g
    .filter((e) => !ui.family || e.family === ui.family)
    .slice(-10)
    .reverse()
    .map((e) => callRow(e, now, multi ? nameOf(s, e.agentKey) : null))
    .join('')
  return `<section class="sec gate">${head}<div class="sec-body"><div class="fams">${fams}</div><div class="calls">${rows}</div></div></section>`
}

const LOG_ICON: Record<LogEntry['kind'], string> = { prompt: '›', spawn: '+', done: '✓', edit: '✎', error: '✗', denied: '⊘', asking: '?', compact: '↺', turn: '·' }

export function renderLog(s: Snapshot, ui: UiState, now: number): string {
  const keys = new Set(visibleAgents(s, ui).map((a) => a.key))
  // "Turn done" rows repeat what the cards already say; the activity list keeps the events.
  const log = s.log.filter((l) => l.kind !== 'turn' && (keys.has(l.agentKey) || (!ui.only && !s.agents.some((a) => a.key === l.agentKey))))
  if (!log.length) return ''
  const latest = log[log.length - 1]
  const head = sectionHead('log', 'Activity', `latest ${ago(latest.at, now)} ago`, ui)
  if (!sectionOpen(ui, 'log')) return `<section class="sec log">${head}</section>`
  const multi = new Set(log.map((l) => l.agentKey)).size > 1
  let prev = ''
  const rows = log
    .slice(-12)
    .reverse()
    .map((l) => {
      // In a mixed list the agent's name heads each run of its rows instead of repeating on every row.
      const who = multi && l.agentKey !== prev ? `<div class="log-who sub-t ell">${esc(nameOf(s, l.agentKey))}</div>` : ''
      prev = l.agentKey
      return `${who}<div class="log-row k-${l.kind}"><span class="ico">${LOG_ICON[l.kind]}</span><span class="ell" title="${esc(l.text)}">${esc(l.text)}</span><span class="muted">${ago(l.at, now)}</span></div>`
    })
    .join('')
  return `<section class="sec log">${head}<div class="sec-body">${rows}</div></section>`
}

export function renderEmpty(s: Snapshot): string {
  return `<section class="empty">
  <div class="empty-title">${esc(s.note ?? 'No agents yet')}</div>
  <p class="sub-t">Start Claude Code in an Orca terminal and it shows up here: context, cost, subagents, tool calls, and a heads-up when it needs you.</p>
  <p class="muted small">Read-only. Nothing leaves your machine. <button class="quiet-link" data-action="github" title="${REPO_URL}">Pitwall on GitHub ↗</button></p>
  <button class="primary" data-action="demo">Try the demo</button>
</section>`
}

// ---- Agni crew ------------------------------------------------------------------------------

const CREW_STATUS: Record<string, string> = {
  running: 'Running',
  waiting: 'Waiting',
  needs_owner: 'Needs you',
  merge_ready: 'Merge-ready',
  failed: 'Failed',
  interrupted: 'Interrupted',
  stopped: 'Stopped'
}
const OWNER_PHRASE: Record<string, string> = { waiting: 'stopped for you', failed: 'failed', interrupted: 'was interrupted' }
const CREW_TONE: Record<string, string> = { running: 'run', merge_ready: 'pass', needs_owner: 'wait', waiting: 'wait', failed: 'fail', interrupted: 'fail' }

/** Stage seconds: 0.4s, 31s, 2m19s. */
export function fmtSecs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  if (sec < 10) return (Math.round(sec * 10) / 10).toString().replace(/\.0$/, '') + 's'
  return fmtDuration(sec * 1000)
}

function crewPill(t: CrewTaskView): string {
  return `<span class="cpill ${CREW_TONE[t.status] ?? ''}">${esc(CREW_STATUS[t.status] ?? t.status)}</span>`
}

/** The owner's next step for a task that waits on them. Pitwall only says it; it never acts on the crew. */
function crewHint(t: CrewTaskView): string {
  if (t.owner === 'test_command') return `Give it one on agnx: <code>crew resume ${esc(t.id)} --test-command CMD</code>`
  if (t.status === 'interrupted') return `Resume it on agnx: <code>crew resume ${esc(t.id)}</code>`
  return `Inspect <code>crew/${esc(t.id)}</code>. The Codex cavalry could take it from here.`
}

function crewAlerts(c: CrewView | null, now: number): string[] {
  if (!c) return []
  const tasks = c.tasks
    .filter((t) => t.owner)
    .map(
      (t) =>
        `<div class="alert"><div class="row"><span class="badge-warn">Crew</span><span class="ell"><b>${esc(t.id)}</b> ${esc(t.owner === 'test_command' ? 'needs a test command' : (OWNER_PHRASE[t.status] ?? `is ${t.status}`))}</span></div>${t.detail ? `<div class="what" title="${esc(t.detail)}">${esc(t.detail)}</div>` : ''}<div class="alert-foot"><span class="hint">${crewHint(t)}</span></div></div>`
    )
  const keys = c.gateway.keys
    .filter((k) => k.tone === 'bad')
    .map((k) => `<div class="alert"><div class="row"><span class="badge-bad">Gateway</span><span class="ell"><b>${esc(k.alias)}</b> ${esc(keyProblem(k, now))}</span></div><div class="alert-foot"><span class="hint">Raise its budget or renew it in LiteLLM.</span><button class="go" data-action="litellm" title="${LITELLM_URL}">LiteLLM ↗</button></div></div>`)
  // Many stopped tasks would bury the agents: the first few, then a count that opens the section.
  const shown = tasks.length > CREW_ALERTS ? [...tasks.slice(0, CREW_ALERTS - 1), `<div class="alert soft"><div class="row"><span class="badge-soft">Crew</span><span class="ell">${tasks.length - CREW_ALERTS + 1} more tasks wait on you, listed under Crew</span></div></div>`] : tasks
  return [...keys, ...shown]
}

const CREW_ALERTS = 3

const DAY_MS = 86_400_000

function daysLeft(k: CrewKeyView, now: number): number | null {
  return k.expiresAt === null ? null : Math.floor((k.expiresAt - now) / DAY_MS)
}

function keyProblem(k: CrewKeyView, now: number): string {
  const d = daysLeft(k, now)
  if (k.pct !== null && k.pct >= 100) return `has spent its budget (${fmtUsd(k.spendUsd)} of ${fmtUsd(k.budgetUsd)})`
  if (d !== null && d < 0) return 'has expired'
  return `expires in ${d === null ? '?' : d <= 0 ? 'under a day' : plural(d, 'day')}`
}

/** Seconds per stage as one strip, widths by time; a running task adds its open stage. */
function stageStrip(t: CrewTaskView, now: number): string {
  if (!t.stages.length && t.status !== 'running') return ''
  const segs = t.stages.map(
    (x) => `<i class="seg-${x.tone}" style="flex-grow:${Math.max(x.seconds, 1).toFixed(1)}" title="${esc(`${x.stage}${x.attempt > 1 ? ' · attempt ' + x.attempt : ''} · ${x.outcome || 'done'} · ${fmtSecs(x.seconds)}`)}"></i>`
  )
  if (t.status === 'running') {
    const from = t.stages.length ? t.stages[t.stages.length - 1].at : (t.createdAt ?? now)
    segs.push(`<i class="seg-run" style="flex-grow:${Math.max((now - from) / 1000, 1).toFixed(1)}" title="${esc(`${t.stage ?? 'working'} · running`)}"></i>`)
  }
  return `<div class="strip" aria-hidden="true">${segs.join('')}</div>`
}

const SHEET_ROWS = 8

/** The run sheet: one row per event line, as the Agni Crew Replay draws it. */
function runSheet(t: CrewTaskView, ui: UiState, now: number): string {
  const all = !!ui.expanded['crewsheet:' + t.id]
  const rows = all ? t.stages : t.stages.slice(-SHEET_ROWS)
  const lines = rows.map(
    (x) =>
      `<div class="sheet-row"><span class="ell"><b class="w5">${esc(x.stage)}</b>${x.attempt > 1 ? ` <span class="muted">· attempt ${x.attempt}</span>` : ''}</span><span class="opill ${x.tone}">${esc(x.outcome || 'done')}</span><span class="muted secs">${esc(fmtSecs(x.seconds))}</span></div>`
  )
  if (t.status === 'running') {
    const from = t.stages.length ? t.stages[t.stages.length - 1].at : (t.createdAt ?? now)
    lines.push(`<div class="sheet-row current"><span class="ell"><b class="w5">${esc(t.stage ?? 'working')}</b></span><span class="opill run">working</span><span class="muted secs">${since(from, now)}</span></div>`)
  }
  const more = t.stages.length > SHEET_ROWS ? `<button class="link" data-action="expand" data-key-x="crewsheet:${esc(t.id)}">${all ? 'Show fewer' : `Show all ${t.stages.length}`}</button>` : ''
  return lines.length ? `<div class="sheet">${lines.join('')}${more}</div>` : ''
}

function crewCard(t: CrewTaskView, ui: UiState, now: number, collapsible: boolean): string {
  const meta = [t.stage ? `stage ${t.stage}` : '', `attempt ${t.attempts}`, t.totalSeconds ? fmtSecs(t.totalSeconds) + ' so far' : ''].filter(Boolean).join(' · ')
  const wait = t.waitingOn ? `<div class="sub-t small">Waiting for the ${esc(t.waitingOn.seat)} seat, held by ${esc(t.waitingOn.holder)}</div>` : ''
  const head = `<div class="card-head${collapsible ? ' clickable' : ''}"${collapsible ? ` data-action="expand" data-key-x="crew:${esc(t.id)}" title="Collapse" tabindex="0" role="button"` : ''}>
    <div class="row">${collapsible ? '<span class="chev">▾</span>' : ''}<code class="tid">${esc(t.id)}</code>${crewPill(t)}</div>
    <div class="sub-t small">${esc(meta)}</div>
  </div>`
  return `<article class="card crew-card ${esc(CREW_TONE[t.status] ?? '')}">${head}${t.prompt ? `<div class="prompt small" title="${esc(t.prompt)}">${esc(t.prompt)}</div>` : ''}${wait}${t.detail && !t.owner && t.status !== 'running' ? `<div class="sub-t small">${esc(t.detail)}</div>` : ''}${stageStrip(t, now)}${runSheet(t, ui, now)}</article>`
}

function crewLine(t: CrewTaskView, now: number): string {
  const when = t.updatedAt ? `${ago(t.updatedAt, now)} ago` : ''
  return `<article class="line crew-line" data-action="expand" data-key-x="crew:${esc(t.id)}" title="${esc(t.prompt)}" tabindex="0" role="button" aria-expanded="false">
  <span class="chev">▸</span><code class="tid">${esc(t.id)}</code>
  <span class="ell sub-t small">${esc(t.stage ?? '')}${t.totalSeconds ? ' · ' + esc(fmtSecs(t.totalSeconds)) : ''}</span>
  ${crewPill(t)}<span class="muted time">${when}</span>
</article>`
}

const SEAT_WORD: Record<CrewSeatView['state'], string> = { up: 'up', down: 'down', busy: 'busy' }

function seatsBlock(c: CrewView): string {
  if (!c.seats.length) return ''
  const rows = c.seats
    .map(
      (x) =>
        `<div class="seat" title="${esc(`${x.role} ${x.model} on ${x.where}: ${x.state}${x.holder ? ', held by ' + x.holder : ''}`)}"><span class="dot seat-${x.state}"></span><span class="ell"><b class="w5">${esc(x.role)}</b> <span class="sub-t">${esc(x.model)}</span> <span class="muted">${esc(x.where)}</span></span><span class="seat-state seat-${x.state}">${SEAT_WORD[x.state]}</span></div>${x.holder ? `<div class="muted small seat-holder ell">lock: ${esc(x.holder)}</div>` : ''}`
    )
    .join('')
  const mode = c.agni1Only ? '<div class="small warn-t">agni2 off, agni1-only mode</div>' : ''
  const lock = c.lockDeployed ? '' : '<div class="muted small">Seat lock not deployed: holders unknown.</div>'
  return `<div class="block"><div class="block-title">Seats</div>${rows}${mode}${lock}</div>`
}

function gatewayBlock(c: CrewView, now: number): string {
  const g = c.gateway
  const link = `<button class="quiet-link" data-action="litellm" title="${LITELLM_URL}">LiteLLM dashboard ↗</button>`
  if (!g.reachable && !g.keys.length)
    return `<div class="block"><div class="block-title">Gateway</div><div class="muted small">${g.error ? `Gateway unreachable (${esc(g.error)})${g.at ? `, last read ${ago(g.at, now)} ago` : ''}` : 'Reading the crew keys…'}</div>${link}</div>`
  const rows = g.keys
    .map((k) => {
      const p = k.pct
      const d = daysLeft(k, now)
      const tone = k.tone
      const left = d === null ? '' : d < 0 ? 'expired' : `${d}d left`
      return `<div class="key" title="${esc(`${k.alias}: ${fmtUsd(k.spendUsd)} of ${k.budgetUsd === null ? 'no budget' : fmtUsd(k.budgetUsd) + ' per 30 days'}${k.expiresAt ? ', expires ' + new Date(k.expiresAt).toISOString().slice(0, 10) : ''}`)}">
  <div class="row small"><code class="ell">${esc(k.alias)}</code><span class="right ${tone === 'bad' ? 'bad-t' : tone === 'warn' ? 'warn-t' : 'sub-t'}">${esc(fmtUsd(k.spendUsd))}${k.budgetUsd !== null ? ' / ' + esc(fmtUsd(k.budgetUsd)) : ''}${left ? ' · ' + esc(left) : ''}</span></div>
  ${p !== null ? `<div class="meter${tone ? ' ' + tone : ''}"><i style="width:${Math.min(100, Math.max(p, p > 0 ? 1 : 0)).toFixed(1)}%"></i></div>` : ''}
</div>`
    })
    .join('')
  const missing = g.missing.length ? `<div class="muted small">Not on the gateway: ${g.missing.map(esc).join(', ')}</div>` : ''
  const stale = !g.reachable ? `<div class="muted small">Gateway unreachable${g.error ? ` (${esc(g.error)})` : ''}; figures from ${ago(g.at ?? now, now)} ago.</div>` : ''
  return `<div class="block"><div class="block-title">Gateway</div>${rows}${missing}${stale}${link}</div>`
}

const CREW_LINES = 6

export function renderCrew(s: Snapshot, ui: UiState, now: number): string {
  const c = s.crew
  if (!c) return ''
  const owner = c.tasks.filter((t) => t.owner).length
  const running = c.tasks.filter((t) => t.status === 'running').length
  const extra = !c.reachable ? (c.error ? `${esc(c.host)} unreachable` : 'reading…') : [running ? `${running} running` : '', owner ? `${owner} for you` : '', c.at ? `${ago(c.at, now)} ago` : ''].filter(Boolean).join(' · ')
  const head = sectionHead('crew', 'Crew', extra, ui)
  if (!sectionOpen(ui, 'crew')) return `<section class="sec crew">${head}</section>`
  let body: string
  if (!c.reachable) {
    // A quiet line, not an error wall: the rest of Pitwall carries on.
    body = c.error
      ? `<div class="crew-off"><b>Crew unreachable</b><div class="muted small">ssh ${esc(c.host)}: ${esc(c.error)}. ${c.at ? `Last answered ${ago(c.at, now)} ago.` : 'Pitwall tries again every 15 seconds.'}</div></div>`
      : `<div class="crew-off muted small">Reading the crew on ${esc(c.host)}…</div>`
  } else {
    const active = c.tasks.filter((t) => t.status === 'running')
    const rest = c.tasks.filter((t) => t.status !== 'running')
    const all = !!ui.expanded['crewall']
    const shown = all ? rest : rest.slice(0, CREW_LINES)
    const lines = shown.map((t) => (ui.expanded['crew:' + t.id] ? `<div class="inline-card">${crewCard(t, ui, now, true)}</div>` : crewLine(t, now))).join('')
    const more = rest.length > CREW_LINES ? `<button class="link" data-action="expand" data-key-x="crewall">${all ? 'Show fewer' : `Show all ${rest.length}`}</button>` : ''
    const older = c.more ? `<div class="muted small">${c.more} older not listed</div>` : ''
    const tasks = c.tasks.length
      ? `${active.length ? `<div class="cards">${active.map((t) => crewCard(t, ui, now, false)).join('')}</div>` : ''}${lines ? `<div class="lines">${lines}</div>` : ''}${more}${older}`
      : '<div class="muted small">No crew tasks yet.</div>'
    body = `<div class="block-title">Tasks</div>${tasks}${seatsBlock(c)}`
  }
  return `<section class="sec crew">${head}<div class="sec-body crew-body">${body}${gatewayBlock(c, now)}</div></section>`
}

export interface Rendered {
  header: string
  alerts: string
  agents: string
  crew: string
  gate: string
  log: string
  footer: string
}

/** A quiet line at the end of the panel, once there is something above it. */
export function renderFooter(s: Snapshot): string {
  if (!s.agents.length) return ''
  return `<footer class="foot"><span class="ver">Pitwall ${esc(VERSION)}</span><span class="dot-sep">·</span><button class="quiet-link" data-action="github" title="Pitwall is free and open source: a star helps others find it">★ Star on GitHub</button></footer>`
}

export function render(s: Snapshot, ui: UiState, now: number): Rendered {
  return {
    header: renderHeader(s, ui),
    alerts: renderAlerts(s, now),
    agents: renderAgents(s, ui, now),
    crew: renderCrew(s, ui, now),
    gate: renderGate(s, ui, now),
    log: renderLog(s, ui, now),
    footer: renderFooter(s)
  }
}
