// Playback reads only the selected task's observations. A replay never issues a worker command.
import type { AgentView, CrewView, CrewTaskView } from '../shared/types'
import { circuit } from './circuit'
import { esc, fmtSecs } from './render'

export interface Playback {
  task: string
  index: number
  playing: boolean
}

export function deckTask(c: CrewView, playback?: Playback): CrewTaskView | undefined {
  const id = playback?.task ?? c.live?.taskId
  return c.tasks.find(t => t.id === id) ?? [...c.tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
}

export function crewReplay(c: CrewView, agents: AgentView[], playback?: Playback): string {
  const t = deckTask(c, playback)
  if (!t) return ''
  const replay = playback?.task === t.id && t.stages.length > 0
  const index = replay ? Math.min(playback.index, t.stages.length - 1) : t.stages.length - 1
  const event = t.stages[index]
  const stage = (replay ? event?.stage : t.stage) || 'runner'
  const status = replay ? event.outcome || 'recorded' : t.status
  const moving = replay ? !!playback.playing : status === 'running'
  const active = !replay && c.live?.taskId === t.id ? c.live.mascots.filter(m => m.state === 'active') : []
  const heading = !replay && status === 'waiting' ? (t.detail.includes('helper handoff') ? 'Handoff blocked' : 'Awaiting operator') : stage
  const title = replay ? 'Recorded replay' : status === 'running' ? 'Live task' : 'Last task'
  const text = (s: string) => esc(s.replace(/_/g, ' '))
  const engaged = new Set(c.seats.filter(s => active.some(m => m.name.toLowerCase() === s.model.toLowerCase())).map(s => s.id))
  // For stage-only recordings show the documented stage owner. A build event alone
  // cannot establish whether the optional second author also ran.
  if (replay && ['plan', 'intake', 'build'].includes(stage)) engaged.add('leader')
  if (replay && stage === 'review') engaged.add(c.agni1Only ? 'helper' : 'reviewer')
  const blocked = ['stop','waiting','failed','needs_owner','interrupted','stopped'].includes(status)
  const rows = t.stages.slice(Math.max(0, index - 2), index + 1).map((x,i,a) =>
    `<button data-action="deck-step" data-key="${esc(t.id)}" data-key-x="${index - a.length + 1 + i}" class="deck-event${i === a.length - 1 ? ' current' : ''}"><b>${text(x.stage)}</b><span>${text(x.outcome)}</span><time>${fmtSecs(x.seconds)}</time></button>`
  ).join('')
  const files = [...new Set(t.stages.slice(0, index + 1).flatMap(s => s.evidence ?? []))]
  const sessions = agents.filter(a => a.state !== 'done').map(a => `<div class="deck-session"><b>${esc(a.agentKind)}</b><span>${esc(a.state)}</span></div>`).join('')
  const control = t.stages.length ? `<button data-action="deck-play" data-key="${esc(t.id)}">${replay && playback.playing ? 'Pause' : replay && index < t.stages.length - 1 ? 'Resume' : '↻ Replay'}</button>` : ''
  return `<article class="crew-deck${blocked ? ' held' : ''}${moving && !blocked ? ' moving' : ''}" aria-label="Crew task monitor">
    <header><span><i></i> AGNI / CREW</span><small>${title}</small></header>
    <div class="deck-screen"><div class="deck-label">${esc(c.host)} · ${esc(t.id)}</div>
    <h2>${text(heading)}</h2><strong>${text(status)}</strong>
    <p>${esc(t.prompt)}</p>${circuit(c.host,c.seats,engaged,blocked)}</div>
    ${!replay && t.detail ? `<div class="deck-detail">${esc(t.detail)}</div>` : ''}
    <div class="deck-tools"><b>RUN SHEET</b>${control}${replay ? '<button data-action="deck-live">Exit replay</button>' : ''}</div>
    ${rows || '<small>Waiting for the first stage event.</small>'}
    ${files.length ? `<div class="deck-files"><b>.crew/</b> ${files.map(esc).join(' · ')}</div>` : ''}
    ${sessions ? `<aside class="deck-sessions"><b>ORCA SESSIONS · NOW</b>${sessions}</aside>` : ''}
  </article>`
}
