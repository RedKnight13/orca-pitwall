// Crew mode: the whole sidebar becomes the Crew operations console. It leads with what is true now
// (freshness of the last read, the running task, who works, seat contention), then what needs the
// owner (cause, last good stage, next step), then the orchestrator map with its run sheet and an
// explicit replay, then backend health and run history. Pure HTML from the snapshot, like render.ts.
import { fmtDuration } from '../shared/format'
import type { CrewMascotView, CrewStageView, CrewTaskView, CrewView, Snapshot } from '../shared/types'
import { crewReplay, deckTask } from './crewReplay'
import { finale, handoff } from './mascots'
import { crewCard, crewHint, crewLine, crewPill, esc, fmtSecs, type UiState } from './render'

/** The crew host is read every 15 s; past this a reading counts as stale even if the last one succeeded. */
export const CREW_STALE_MS = 45_000

/** Crew mode owns the sidebar whenever the Crew setting is on (demo mode keeps the standard view). */
export function crewMode(s: Snapshot): boolean {
  return !!s.crew && !s.demo
}

const ago = (at: number, now: number) => `<span data-ago="${at}">${esc(fmtDuration(now - at))}</span>`
const since = (at: number, now: number) => `<span data-since="${at}">${esc(fmtDuration(now - at))}</span>`
const words = (s: string) => esc(s.replace(/_/g, ' '))

export type Freshness = 'live' | 'stale' | 'unreachable' | 'connecting'

export function freshness(c: CrewView, now: number): Freshness {
  if (!c.reachable) return c.error ? 'unreachable' : 'connecting'
  return c.at !== null && now - c.at > CREW_STALE_MS ? 'stale' : 'live'
}

function bar(c: CrewView, now: number): string {
  const f = freshness(c, now)
  const read =
    f === 'connecting'
      ? `connecting to ${esc(c.host)}…`
      : f === 'unreachable'
        ? c.at
          ? `unreachable · ${ago(c.at, now)}`
          : 'never reached'
        : `${f} · ${ago(c.at ?? now, now)} ago`
  return `<header class="cm-bar">
  <button class="cm-back" data-action="crew" title="Leave Crew mode and return to the standard Pitwall view (stops reading the crew)">‹ Pitwall</button>
  <span class="cm-title">Crew</span>
  <span class="cm-fresh f-${f}" title="When ${esc(c.host)} last answered. Pitwall reads it every 15 s over SSH.">${f === 'live' ? '<i class="cm-dot" aria-hidden="true"></i>' : ''}${read}</span>
</header>`
}

/** The last stage that passed, for a task that stopped: where it got to. */
function lastGood(t: CrewTaskView): CrewStageView | undefined {
  return [...t.stages].reverse().find((x) => x.tone === 'pass')
}

function latest(t: CrewTaskView): CrewStageView | undefined {
  return t.stages[t.stages.length - 1]
}

function working(c: CrewView, t: CrewTaskView): CrewMascotView[] {
  return c.live && c.live.taskId === t.id ? c.live.mascots.filter((m) => m.state === 'active') : []
}

function hw(m: CrewMascotView): string {
  const bits = [m.tempC !== null ? `${Math.round(m.tempC)}°C` : '', m.vramGb ? `${m.vramGb.used.toFixed(1)}/${Math.round(m.vramGb.total)} GB` : '', m.tokensPerSec !== null ? `${Math.round(m.tokensPerSec)} tok/s` : ''].filter(Boolean)
  return bits.length ? `<span class="cm-hw">${esc(bits.join(' · '))}</span>` : ''
}

/** Real moments only: a hand-off between seats, or a task that just finished. Each plays once. */
function events(c: CrewView, now: number): string {
  const l = c.live
  if (!l) return ''
  const html = handoff(l, now) + finale(l, now)
  return html ? `<div class="cm-events">${html}</div>` : ''
}

function nowRunning(c: CrewView, t: CrewTaskView, now: number): string {
  const started = c.live?.taskId === t.id && c.live.startedAt ? c.live.startedAt : t.createdAt
  const last = latest(t)
  const who = working(c, t)
  const crew = who.length
    ? who.map((m) => `<li><b class="m-${esc(m.id)}">${esc(m.name)}</b> <span>${esc(m.bubble ?? m.action ?? 'working')}</span>${m.since ? ` <span class="cm-t">${since(m.since, now)}</span>` : ''}${hw(m)}</li>`).join('')
    : `<li class="cm-quiet">No seat reports generating right now</li>`
  const progress = last
    ? `<b>${words(last.stage)}</b> ${words(last.outcome || 'done')} in ${esc(fmtSecs(last.seconds))} · ${ago(last.at, now)} ago`
    : 'No stage has finished yet'
  const seat = t.waitingOn
    ? `<div class="cm-wait" role="status"><b>Queued</b> for the ${esc(t.waitingOn.seat)} seat · held by <code>${esc(t.waitingOn.holder)}</code></div>`
    : ''
  return `<section class="cm-now run" aria-label="Running task">
  <div class="cm-kicker"><span>Running</span><code>${esc(t.id)}</code>${t.attempts > 1 ? `<span>attempt ${esc(t.attempts)}</span>` : ''}</div>
  <div class="cm-stage"><h1>${words(t.stage ?? 'starting')}</h1>${started ? `<span class="cm-elapsed" title="Elapsed since the task started">${since(started, now)}</span>` : ''}</div>
  <p class="cm-prompt" title="${esc(t.prompt)}">${esc(t.prompt)}</p>
  ${seat}${events(c, now)}
  <dl class="cm-facts"><dt>Latest</dt><dd>${progress}</dd><dt>Working</dt><dd><ul class="cm-who">${crew}</ul></dd></dl>
</section>`
}

function nowIdle(c: CrewView, now: number): string {
  const last = [...c.tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  const ended = last
    ? `<p class="cm-last">Last run <code>${esc(last.id)}</code> ${crewPill(last)}${last.updatedAt ? ` · ended ${ago(last.updatedAt, now)} ago` : ''}</p>`
    : '<p class="cm-last">No crew tasks yet.</p>'
  return `<section class="cm-now idle" aria-label="No task running">
  <div class="cm-kicker"><span>Idle</span></div>
  <div class="cm-stage"><h1>No task running</h1></div>
  ${events(c, now)}${ended}
</section>`
}

function nowOff(c: CrewView, now: number): string {
  if (!c.error)
    return `<section class="cm-now off"><div class="cm-kicker"><span>Connecting</span></div><p class="cm-last">Reading the crew on ${esc(c.host)}…</p></section>`
  return `<section class="cm-now off" role="alert"><div class="cm-kicker"><span>Unknown</span></div>
  <div class="cm-stage"><h1>Crew unreachable</h1></div>
  <p class="cm-last">ssh ${esc(c.host)}: ${esc(c.error)}. ${c.at ? `Last answered ${ago(c.at, now)} ago; what the crew does now is unknown.` : 'It has not answered since Crew mode started.'} Pitwall retries every 15 s.</p>
</section>`
}

const OWNER_TITLE: Record<string, string> = { test_command: 'Needs a test command', stuck: 'Stopped short' }
const STATUS_TITLE: Record<string, string> = { failed: 'Failed', interrupted: 'Interrupted', waiting: 'Stopped short', needs_owner: 'Needs you' }

/** Tasks that wait on the owner, newest first: cause, how far it got, what to do next. */
function incidents(c: CrewView, ui: UiState, now: number): string {
  const open = c.tasks.filter((t) => t.owner).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (!open.length) return ''
  const all = !!ui.expanded['crew:incidents']
  const shown = all ? open : open.slice(0, 2)
  const cards = shown
    .map((t) => {
      const good = lastGood(t)
      const at = latest(t)
      return `<article class="cm-incident">
  <div class="cm-inc-head"><b>${esc(t.owner === 'test_command' ? OWNER_TITLE.test_command : (STATUS_TITLE[t.status] ?? OWNER_TITLE.stuck))}</b><code>${esc(t.id)}</code>${t.updatedAt ? `<span class="cm-t">${ago(t.updatedAt, now)} ago</span>` : ''}</div>
  <dl class="cm-facts">
    <dt>Cause</dt><dd>${t.detail ? esc(t.detail) : at ? `${words(at.stage)} ended ${words(at.outcome || 'without an outcome')}` : 'Not recorded'}</dd>
    <dt>Reached</dt><dd>${good ? `${words(good.stage)} passed` : 'No stage passed'}${at && at !== good ? `; stopped at ${words(at.stage)}` : ''}</dd>
    <dt>Next</dt><dd>${crewHint(t)}</dd>
  </dl>
</article>`
    })
    .join('')
  const more = open.length > 2 ? `<button class="cm-link" data-action="expand" data-key-x="crew:incidents" aria-expanded="${all}">${all ? 'Show fewer' : `Show all ${open.length}`}</button>` : ''
  return `<section class="cm-block cm-needs" aria-label="Needs you"><h2>Needs you <span>${open.length}</span></h2>${cards}${more}</section>`
}

const SEAT_WORD: Record<string, string> = { up: 'up', down: 'down', busy: 'busy' }

/** Seat and gateway health: one line each, and the gateway only when it has a problem to report. */
function health(c: CrewView, now: number): string {
  const seats = c.seats
    .map((x) => `<li class="s-${x.state}" title="${esc(`${x.role} ${x.model} on ${x.where}: ${x.state}${x.holder ? ', held by ' + x.holder : ''}`)}"><i aria-hidden="true"></i><b>${esc(x.role)}</b> ${esc(x.model)} <span>${SEAT_WORD[x.state] ?? esc(x.state)}</span></li>`)
    .join('')
  const g = c.gateway
  const bad = g.keys.filter((k) => k.tone === 'bad')
  const gate = !g.reachable && g.error
    ? `LiteLLM gateway unreachable (${esc(g.error)})${g.at ? `, last read ${ago(g.at, now)} ago` : ''}`
    : bad.length
      ? `LiteLLM: ${bad.map((k) => `<code>${esc(k.alias)}</code> ${k.pct !== null && k.pct >= 100 ? 'out of budget' : 'expired or expiring'}`).join(', ')}`
      : ''
  const notes = [c.agni1Only ? 'agni2 off: agni1-only mode' : '', c.seats.length && !c.lockDeployed ? 'seat lock not deployed: holders unknown' : '', gate].filter(Boolean)
  if (!seats && !notes.length) return ''
  return `<section class="cm-block cm-health" aria-label="Seats"><h2>Seats</h2>${seats ? `<ul class="cm-seats">${seats}</ul>` : ''}${notes.map((n) => `<p class="cm-note">${n}</p>`).join('')}</section>`
}

function history(c: CrewView, ui: UiState, now: number): string {
  if (!c.tasks.length) return ''
  const open = !!ui.expanded.crewhistory
  const records = [...c.tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  const rows = open ? records.map((t) => (ui.expanded['crew:' + t.id] ? `<div class="inline-card">${crewCard(t, ui, now, true)}</div>` : crewLine(t, now))).join('') : ''
  const older = open && c.more ? `<p class="cm-note">${esc(c.more)} older not listed</p>` : ''
  return `<section class="cm-block cm-history"><button class="cm-fold" data-action="expand" data-key-x="crewhistory" aria-expanded="${open}"><h2>Run history</h2><span>${records.length} runs ${open ? '−' : '+'}</span></button>${rows}${older}</section>`
}

export function renderCrewConsole(s: Snapshot, ui: UiState, now: number): { header: string; crew: string } {
  const c = s.crew!
  const running = c.reachable ? c.tasks.find((t) => t.id === c.live?.taskId && t.status === 'running') ?? c.tasks.find((t) => t.status === 'running') : undefined
  const head = !c.reachable ? nowOff(c, now) : running ? nowRunning(c, running, now) : nowIdle(c, now)
  const deck = c.reachable && deckTask(c, ui.playback) ? crewReplay(c, ui.playback, running?.id ?? null) : ''
  const body = `${head}${c.reachable ? incidents(c, ui, now) : ''}${deck}${health(c, now)}${history(c, ui, now)}`
  return { header: bar(c, now), crew: `<main class="crew-console" aria-label="Crew operations">${body}</main>` }
}
