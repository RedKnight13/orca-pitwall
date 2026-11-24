// The orchestrator: the crew's roster as a routing map (Crew runner and LiteLLM at the hub) with the
// task's run sheet. It says plainly which of three things it shows: the live task, the last recorded
// run (still, not a current incident), or an explicit replay. A replay reads only the selected task's
// recorded stages and never issues a worker command.
import type { CrewView, CrewTaskView } from '../shared/types'
import { circuit } from './circuit'
import { renderStory, story, taskEnded } from './crewStory'
import { esc, fmtSecs } from './render'

export interface Playback {
  task: string
  index: number
  playing: boolean
}

export function deckTask(c: CrewView, playback?: Playback): CrewTaskView | undefined {
  if (playback) {
    const t = c.tasks.find(t => t.id === playback.task)
    if (t) return t
  }
  const picked = c.focus ? c.tasks.find(t => t.key === c.focus) : undefined
  if (picked) return picked
  const id = c.live?.taskId
  return c.tasks.find(t => t.id === id) ?? [...c.tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
}

const RESERVES: Record<string, string> = { cavalry: 'codex', referee: 'jev', escalation: 'venice' }
const STOPPED = ['stop', 'waiting', 'failed', 'needs_owner', 'interrupted', 'stopped']

/** `liveId`: the task running now, if any. */
export function crewReplay(c: CrewView, playback: Playback | undefined, liveId: string | null, ui: { expanded: Record<string, boolean> } = { expanded: {} }): string {
  const t = deckTask(c, playback)
  if (!t) return ''
  const replay = playback?.task === t.id && t.stages.length > 0
  const live = !replay && t.id === liveId
  const selected = !replay && !live && !!c.focus && t.key === c.focus
  const index = replay ? Math.min(playback.index, t.stages.length - 1) : t.stages.length - 1
  const event = t.stages[index]
  const stage = (replay ? event?.stage : t.stage) || 'runner'
  const status = replay ? event.outcome || 'recorded' : t.status
  const moving = replay ? !!playback.playing : live
  const text = (s: string) => esc(s.replace(/_/g, ' '))
  // Live: the seats the crew reports generating now. Replay: the documented owner of the stage shown.
  // The last recorded run lights nothing: it is not happening.
  const active = live && c.live?.taskId === t.id ? c.live.mascots.filter(m => m.state === 'active') : []
  const engaged = new Set(c.seats.filter(s => active.some(m => m.name.toLowerCase() === s.model.toLowerCase())).map(s => s.id))
  if (replay && ['plan', 'intake', 'build'].includes(stage)) engaged.add('leader')
  if (replay && stage === 'review') engaged.add(c.agni1Only ? 'helper' : 'reviewer')
  for (const [role, id] of Object.entries(RESERVES)) if (active.some(m => m.id === id) || (replay && stage === role)) engaged.add(role)
  const blocked = STOPPED.includes(status)
  const told = replay ? t.stages.slice(0, index + 1) : t.stages
  const ended = (!replay || index === t.stages.length - 1) && taskEnded(t)
  const tale = story(c, t, told, ended, live)
  const mode = replay ? `Replay · ${index + 1}/${t.stages.length}` : live ? 'Live' : selected ? 'Picked run · recorded' : 'Last run · recorded'
  const rows = t.stages.slice(Math.max(0, index - 4), index + 1).map((x, i, a) => {
    const n = index - a.length + 1 + i
    return `<button data-action="deck-step" data-key="${esc(t.id)}" data-key-x="${n}" class="deck-event t-${esc(x.tone)}${i === a.length - 1 ? ' current' : ''}" aria-label="${esc(`Replay from ${x.stage}, ${x.outcome || 'done'}`)}"><b>${text(x.stage)}</b><span>${text(x.outcome || 'done')}</span><time>${fmtSecs(x.seconds)}</time></button>`
  }).join('')
  const play = `<button data-action="deck-play" data-key="${esc(t.id)}">${replay && playback.playing ? 'Pause' : replay && index < t.stages.length - 1 ? 'Resume' : '↻ Replay'}</button>`
  return `<section class="crew-deck d-${replay ? 'replay' : live ? 'live' : 'last'}${blocked ? ' held' : ''}${moving && !blocked ? ' moving' : ''}" aria-label="Orchestrator">
  <header><h2>Orchestrator</h2><span class="deck-mode">${esc(mode)}</span></header>
  ${selected ? '<button class="cm-link deck-back" data-action="crew-focus" data-key="">Back to the latest run</button>' : ''}
  ${t.primary ? '' : `<div class="deck-label"><span class="root-tag" title="Recorded in ${esc(t.root)} on ${esc(c.host)}; crew status does not cover this root">${esc(rootName(t.root))}</span></div>`}
  ${renderStory(tale, t, ui)}
  ${circuit(c.host, c.seats, c.reserveRoles ?? [], engaged, tale.roles)}
  <div class="deck-tools"><b>Run sheet</b>${t.stages.length ? play : ''}${replay ? '<button data-action="deck-live">Exit replay</button>' : ''}</div>
  ${rows || '<p class="cm-note">Waiting for the first stage event.</p>'}
</section>`
}

/** agni-crew-79-qual → "79-qual run root". */
export const rootName = (root: string) => `${root.replace(/^agni-crew-?/, '') || 'base'} run root`
