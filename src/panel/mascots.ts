// The crew as mascots, inside each running task's card. Pure HTML from the snapshot, like render.ts.
// A narrow sidebar gets one line of faces (the working ones move and say what they do), a full row
// only for each seat at work, and one small dimmed row for everyone else. Motion is CSS only
// (styles.ts): off under prefers-reduced-motion, paused while the panel is hidden, and every moving
// face has its word beside it, so nothing is said by motion alone.
import { fmtDuration } from '../shared/format'
import type { CrewLiveView, CrewMascotView, CrewTaskView } from '../shared/types'
import { esc } from './render'

/** One-shot effects (hand-off, confetti) show only this soon after the moment; main.ts plays each once. */
export const BURST_MS = 30_000

/** Amber from here, red from TEMP_BAD_C (the lab cuts power at 100 °C). Kept in step with worker/crew/gpu.ts. */
export const TEMP_WARN_C = 85
export const TEMP_BAD_C = 95

const STATE_WORD: Record<CrewMascotView['state'], string> = { active: 'working', done: 'done', failed: 'failed', waiting: 'waiting', idle: 'sitting out' }

/** What a mascot is doing, in words, for titles and screen readers. */
function said(m: CrewMascotView): string {
  return `${m.name} ${m.state === 'active' ? (m.action ?? 'working') : STATE_WORD[m.state]}`
}

/** One line of faces in pipeline order. Working ones move and carry their action word; the rest are dimmed, without text. */
function strip(l: CrewLiveView): string {
  const faces = l.mascots
    .map((m) =>
      m.state === 'active'
        ? `<span class="st on m-${esc(m.id)}"><span class="face bob" aria-hidden="true">${m.face}</span><b>${esc(m.action ?? 'working')}</b></span>`
        : `<span class="st dim st-${m.state}" title="${esc(said(m))}" aria-hidden="true">${m.face}</span>`
    )
    .join('')
  return `<div class="live-strip" role="group" aria-label="${esc(l.mascots.map(said).join(', '))}">${faces}</div>`
}

function tempTone(c: number): string {
  return c >= TEMP_BAD_C ? ' t-bad' : c >= TEMP_WARN_C ? ' t-warn' : ''
}

/** The card's figures that have data; nothing at all when none has. */
function hardware(m: CrewMascotView): string {
  if (!m.card) return ''
  const bits = [`<span class="hw-card">${esc(m.card)}</span>`]
  const tips = [`${m.card}${m.host ? ' on ' + m.host : ''}`]
  if (m.tempC !== null) {
    bits.push(`<span class="hw-t${tempTone(m.tempC)}">${esc(Math.round(m.tempC))}°C</span>`)
    tips.push(`${Math.round(m.tempC)} °C (edge sensor; amber from ${TEMP_WARN_C}, red from ${TEMP_BAD_C})`)
  }
  if (m.vramGb !== null) {
    bits.push(`<span>${esc(m.vramGb.used.toFixed(1))}/${esc(Math.round(m.vramGb.total))} GB</span>`)
    tips.push(`VRAM ${m.vramGb.used.toFixed(1)} of ${Math.round(m.vramGb.total)} GB`)
  }
  if (m.tokensPerSec !== null) bits.push(`<span class="tps">${esc(Math.round(m.tokensPerSec))} tok/s</span>`)
  return `<span class="hw" title="${esc(tips.join(' · '))}">${bits.join('')}</span>`
}

/** A seat at work: name and role, how long, then its output file and size, and its card. */
function row(l: CrewLiveView, m: CrewMascotView, now: number): string {
  const clock = m.since ? `<span class="m-clock" data-since="${m.since}">${esc(fmtDuration(now - m.since))}</span>` : ''
  const bubble = m.bubble ? `<span class="bubble ell" title="${esc(m.bubble)}">${esc(m.bubble)}</span>` : ''
  const hw = hardware(m)
  const say = bubble || hw ? `<div class="m-say">${bubble}${hw}</div>` : ''
  return `<div class="mascot m-${esc(m.id)}" data-k="seat:${esc(l.taskId)}:${esc(m.id)}"><span class="face" aria-hidden="true">${m.face}</span><div class="m-main"><div class="m-head"><b class="m-name">${esc(m.name)}</b><span class="m-role ell">${esc(m.role)}</span>${clock}</div>${say}</div></div>`
}

const MARK: Partial<Record<CrewMascotView['state'], string>> = { done: '<i class="mk ok" aria-hidden="true">✓</i>', failed: '<i class="mk bad" aria-hidden="true">✕</i>' }

/** Everyone not at work, small and dimmed in one row: ✓ or ✕ for a turn had, 💤 for those still to come; first, how it ended. */
function fold(l: CrewLiveView, end: string): string {
  const rest = l.mascots.filter((m) => m.state !== 'active')
  if (!rest.length && !end) return ''
  const had = rest.filter((m) => m.state === 'done' || m.state === 'failed')
  const asleep = rest.filter((m) => m.state === 'waiting' || m.state === 'idle')
  const one = (m: CrewMascotView) => `<span class="fold-m" title="${esc(said(m) + (m.bubble ? ': ' + m.bubble : ''))}"><span aria-hidden="true">${m.face}</span>${MARK[m.state] ?? ''}</span>`
  const zz = asleep.length ? `<span class="fold-zz">${asleep.map(one).join('')}<span class="zz" aria-hidden="true">💤</span></span>` : ''
  return `<div class="fold" data-k="fold:${esc(l.taskId)}" aria-label="${esc(rest.map(said).join(', '))}">${end}${had.map(one).join('')}${zz}</div>`
}

function handoff(l: CrewLiveView, now: number): string {
  const h = l.handoff
  if (!h || now - h.at > BURST_MS || now < h.at - 60_000) return ''
  const by = (id: string) => l.mascots.find((m) => m.id === id)
  const from = by(h.from)
  const to = by(h.to)
  if (!from || !to) return ''
  return `<div class="handoff" data-once="${esc(`ho:${l.taskId}:${h.from}:${h.to}:${h.at}`)}" role="status"><span aria-hidden="true">${from.face}</span><span class="parcel" aria-hidden="true">📦</span><span aria-hidden="true">${to.face}</span><span class="small sub-t">${esc(from.name)} hands over to ${esc(to.name)}</span></div>`
}

const CONFETTI = ['🎉', '✨', '🎊', '⭐', '✨', '🎉', '🎊', '✨']

/** The pill already says how it ended; a word shows only when it says more (a waiting task stopped short). */
const PILL_SAYS = new Set(['merge_ready', 'failed', 'interrupted'])

function finale(l: CrewLiveView, now: number): string {
  const f = l.finale
  if (!f) return ''
  const ok = f.kind === 'merge_ready'
  const fresh = now - f.at <= BURST_MS && now >= f.at - 60_000
  // The burst plays once; the face and the word stay for everyone, motion or not.
  const burst = fresh
    ? ok
      ? `<span class="confetti" data-once="${esc(`fin:${l.taskId}:ok`)}" aria-hidden="true">${CONFETTI.map((c, i) => `<i style="--i:${i}">${c}</i>`).join('')}</span>`
      : `<span class="boom" data-once="${esc(`fin:${l.taskId}:bad`)}" aria-hidden="true">💥</span>`
    : ''
  const word = ok ? 'Merge-ready' : l.status === 'waiting' ? 'Stopped short' : l.status === 'interrupted' ? 'Interrupted' : 'Failed'
  const shown = PILL_SAYS.has(l.status) ? `<span class="sr">${esc(word)}</span>` : `<b>${esc(word)}</b>`
  return `<span class="finale ${ok ? 'fin-ok' : 'fin-bad'}" role="status">${burst}<span class="fin-face" aria-hidden="true">${ok ? '🎉' : '💥'}</span>${shown}</span>`
}

/** The mascot part of one task's card. The card around it carries the task id, clock and stages. */
export function liveBlock(l: CrewLiveView, now: number): string {
  const active = l.mascots.filter((m) => m.state === 'active')
  const via = l.source === 'seats' ? 'per-seat events' : 'stage events'
  // The strip is for who is at work; with nobody at work the fold already shows everyone.
  return `<div class="live" data-k="live:${esc(l.taskId)}" title="${esc(`Drawn from the crew's ${via}`)}">${active.length ? strip(l) : ''}${handoff(l, now)}${active.length ? `<div class="mascots">${active.map((m) => row(l, m, now)).join('')}</div>` : ''}${fold(l, finale(l, now))}</div>`
}

/** Nothing running: the crew naps, and says what it did last. */
export function asleep(tasks: CrewTaskView[], now: number): string {
  if (!tasks.length) return ''
  const last = [...tasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  const when = last.updatedAt ? ` <span data-ago="${last.updatedAt}">${esc(fmtDuration(now - last.updatedAt))}</span> ago` : ''
  return `<div class="live asleep"><span class="fold-m" aria-hidden="true">🐉🦊🐙🧪</span><span class="zz" aria-hidden="true">💤</span> <span class="small sub-t">Crew asleep · last <code>${esc(last.id)}</code> ${esc(last.status.replace(/_/g, '-'))}${when}</span></div>`
}
