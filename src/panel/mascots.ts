// The crew as mascots: who is working, in the Crew section. Pure HTML from the snapshot, like
// render.ts. Motion is CSS only (styles.ts), off under prefers-reduced-motion, and every animated
// face or effect has a word beside it, so nothing is said by motion alone.
import { fmtDuration } from '../shared/format'
import type { CrewLiveView, CrewMascotView, CrewTaskView, CrewView } from '../shared/types'
import { esc } from './render'

/** One-shot effects (hand-off, confetti) show only this soon after the moment; main.ts plays each once. */
export const BURST_MS = 30_000

/** All looping motion shares this period. Each redraw starts it at the wall clock's phase, so faces never jump. */
const LOOP_MS = 2400

const STRIP_WORD: Record<CrewMascotView['state'], string> = { active: '', done: 'done', failed: 'failed', waiting: 'waiting', idle: 'idle' }

function stripWord(m: CrewMascotView): string {
  if (m.state === 'active') return `<b>${esc(m.action ?? 'working')}…</b>`
  if (m.id === 'tests' && m.state === 'waiting') return '—'
  return esc(STRIP_WORD[m.state])
}

/** `🐉 planning… ▸ 🦊 waiting ▸ 🐙 idle ▸ 🧪 —   task <id> · 3m12s` */
function strip(l: CrewLiveView, now: number): string {
  const steps = l.mascots.map((m) => `<span class="st st-${m.state}"><span aria-hidden="true">${esc(m.name.slice(0, 1))}</span> ${stripWord(m)}</span>`).join('<span class="st-sep" aria-hidden="true">▸</span>')
  const said = l.mascots.map((m) => `${m.name} ${m.state === 'active' ? m.action : m.state}`).join(', ')
  const clock = l.startedAt ? ` · <span data-since="${l.startedAt}">${esc(fmtDuration(now - l.startedAt))}</span>` : ''
  return `<div class="live-strip" role="group" aria-label="${esc(said)}">${steps}<span class="live-task muted">task <code>${esc(l.taskId)}</code>${clock}</span></div>`
}

function hardware(m: CrewMascotView): string {
  if (!m.card) return ''
  const t = m.tempC === null ? '—' : `${Math.round(m.tempC)}°C`
  const v = m.vramGb === null ? '—' : `${m.vramGb.used.toFixed(1)}/${Math.round(m.vramGb.total)} GB`
  const why = m.tempC === null && m.vramGb === null ? ': no read-only source for these yet' : ''
  return `<span class="hw muted" title="${esc(`${m.card} temperature and VRAM${why}`)}">${esc(m.card)} · ${esc(t)} · VRAM ${esc(v)}</span>`
}

function row(m: CrewMascotView, now: number): string {
  const face = m.state === 'active' ? `<span class="face bob" aria-hidden="true">${esc(m.name.slice(0, 1))}</span>` : m.state === 'idle' || m.state === 'waiting' ? `<span class="face sleepy" aria-hidden="true">${esc(m.name.slice(0, 1))}<i class="zz">·</i></span>` : `<span class="face" aria-hidden="true">${esc(m.name.slice(0, 1))}</span>`
  const act =
    m.state === 'active'
      ? `<span class="act">${esc(m.action ?? 'working')}</span>${m.tokensPerSec !== null ? `<span class="tps">${esc(Math.round(m.tokensPerSec))} tok/s</span>` : ''}${m.since ? `<span class="muted small" data-since="${m.since}">${esc(fmtDuration(now - m.since))}</span>` : ''}`
      : `<span class="m-state m-${m.state}">${esc(m.state)}</span>`
  const bubble = m.bubble ? `<span class="bubble ell" title="${esc(m.bubble)}">${esc(m.bubble)}</span>` : '<span class="ell"></span>'
  return `<div class="mascot m-${esc(m.id)} is-${m.state}">
  ${face}
  <div class="m-main"><div class="row"><b class="m-name">${esc(m.name)}</b><span class="muted small ell">${esc(m.role)}</span>${act}</div>
  <div class="row small m-say">${bubble}${hardware(m)}</div></div>
</div>`
}

function handoff(l: CrewLiveView, now: number): string {
  const h = l.handoff
  if (!h || now - h.at > BURST_MS || now < h.at - 60_000) return ''
  const by = (id: string) => l.mascots.find((m) => m.id === id)
  const from = by(h.from)
  const to = by(h.to)
  if (!from || !to) return ''
  return `<div class="handoff" data-once="${esc(`ho:${l.taskId}:${h.from}:${h.to}:${h.at}`)}" role="status"><span aria-hidden="true">${esc(from.name)}</span><span class="parcel" aria-hidden="true">→</span><span aria-hidden="true">${esc(to.name)}</span><span class="small sub-t">${esc(from.name)} hands over to ${esc(to.name)}</span></div>`
}

const CONFETTI = ['·', '·', '·', '·']

function finale(l: CrewLiveView, now: number): string {
  const f = l.finale
  if (!f) return ''
  const ok = f.kind === 'merge_ready'
  const fresh = now - f.at <= BURST_MS && now >= f.at - 60_000
  // The burst plays once; the line stays for everyone, motion or not.
  const burst = fresh
    ? ok
      ? `<span class="confetti" data-once="${esc(`fin:${l.taskId}:ok`)}" aria-hidden="true">${CONFETTI.map((c, i) => `<i style="--i:${i}">${c}</i>`).join('')}</span>`
      : `<span class="boom" data-once="${esc(`fin:${l.taskId}:bad`)}" aria-hidden="true">×</span>`
    : ''
  const word = ok ? 'merge-ready' : l.status === 'waiting' ? 'stopped short' : l.status
  return `<div class="finale ${ok ? 'fin-ok' : 'fin-bad'}" role="status">${burst}<span aria-hidden="true">${ok ? '✓' : '×'}</span> <b>${esc(l.taskId)}</b> ${esc(word)}</div>`
}

/** The task in action as mascots. Empty when the crew has nothing live. */
export function renderLive(c: CrewView, now: number): string {
  const l = c.live
  if (!l) return asleep(c.tasks, now)
  const phase = `--ph:-${Math.floor(((now % LOOP_MS) + LOOP_MS) % LOOP_MS)}ms`
  const via = l.source === 'seats' ? 'per-seat events' : 'stage events'
  return `<div class="live" style="${phase}" title="${esc(`Drawn from the crew's ${via}`)}">${strip(l, now)}${handoff(l, now)}${finale(l, now)}<div class="mascots">${l.mascots.map((m) => row(m, now)).join('')}</div></div>`
}

/** Nothing running: the crew naps, and says what it did last. */
function asleep(tasks: CrewTaskView[], now: number): string {
  if (!tasks.length) return ''
  const last = [...tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  const when = last.updatedAt ? ` <span data-ago="${last.updatedAt}">${esc(fmtDuration(now - last.updatedAt))}</span> ago` : ''
  return `<div class="live asleep"><span class="small sub-t">No active Crew task reported · last <code>${esc(last.id)}</code> ${esc(last.status.replace(/_/g, '-'))}${when}</span></div>`
}
