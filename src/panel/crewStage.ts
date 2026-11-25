import type { CrewMascotId, CrewView } from '../shared/types'
import { esc } from './render'

// Original role artwork from the Crew visual prototype.
const SPRITES = {
  Planner: { pal: { a: "#ee5d4c",b: "#7a2a22",c: "#ffb39f",e: "#161a33",w: "#ffffff" }, px: [
    ".......bb...",
    "......baab..",
    "..b..bawea..",
    ".bab.baaaab.",
    ".baabaaccc..",
    "..baaaacc...",
    "...aaaaaa...",
    "..aaccaaa...",
    "..aaccaab..b",
    "...aaaaabbab",
    "...a..a..bb.",
    "..bb.bb....."]},
  Coder: { pal: { a: "#f2c14e",b: "#7a5714",c: "#fff1c9",e: "#161a33",w: "#ffffff" }, px: [
    ".b.......b..",
    ".ab.....ba..",
    ".aab...baa..",
    ".aaaaaaaaa..",
    ".awaaaaawa..",
    ".aeaccccea..",
    "..aacbbcaa..",
    "...aaccaa...",
    "..aaaaaaaa.a",
    "..aaccccaaaa",
    "..aaccccaaa.",
    "..bb....bb.."]},
  Reviewer: { pal: { a: "#c774e8",b: "#5d2a73",c: "#f0c8ff",e: "#161a33",w: "#ffffff" }, px: [
    "....bbbb....",
    "..baaaaaab..",
    ".baaaaaaaab.",
    ".aawaaaawaa.",
    ".aaeaaaaeaa.",
    ".aaaaccaaaa.",
    ".aaaaaaaaaa.",
    ".a.aa.aa.aa.",
    ".a.aa.aa.a..",
    "aa.a..a..aa.",
    "a..aa.aa..a.",
    "............"]},
  Cavalry: { pal: { a: "#d9dcea",b: "#5d6283",c: "#ffffff",e: "#161a33",w: "#ffffff" }, px: [
    "........bb..",
    ".......baab.",
    "......baawe.",
    "......baaaab",
    ".....baaab..",
    "b...baaaa...",
    "bbaaaaaaa...",
    ".baaaaaaa...",
    "..aaccccaa..",
    "..a.a..a.a..",
    "..a.a..a.a..",
    "..b.b..b.b.."]},
  Jev: { pal: { a: "#d89753", b: "#85562e", c: "#fbe6a4", e: "#161a33", w: "#ffffff" }, px: [
    "..b......b..",
    "..ab....ba..",
    "..aaaaaaaa..",
    ".aaccccccaa.",
    ".acweccewca.",
    ".acccccccca.",
    ".baaccccaab.",
    ".baaaaaaaab.",
    "..baaaaaab..",
    "...babbab...",
    "...bb..bb...",
    "............"] },
  Venice: { pal: { a: "#61d9d4", b: "#2b6380", c: "#c8fff7", e: "#182242", w: "#ffffff" }, px: [
    "............",
    ".bb......bb.",
    ".aaabbbbaaa.",
    ".aaaaaaaaaa.",
    ".aeeaaaeeaa.",
    "..aacaaacaa.",
    "...aaaaaa...",
    "....aaaa....",
    ".....aa.....",
    "......ba....",
    ".......b....",
    "............"] },
  Tests: { pal: { a: "#69e279", b: "#328754", c: "#caf5dd", e: "#234746", w: "#ffffff" }, px: [
    "....bbbb....",
    "....cccc....",
    ".....cc.....",
    ".....cc.....",
    "....c..c....",
    "...c....c...",
    "...caabac...",
    "..caaaaaac..",
    "..caaeaabc..",
    "..caaaaaac..",
    "...cccccc...",
    "............"] },
}

type Sprite = keyof typeof SPRITES

function pixelArt(sprite: Sprite): string {
  const { pal, px } = SPRITES[sprite]
  const tiles = px.flatMap((row, y) => Array.from(row, (pixel, x) => {
    const color = pal[pixel as keyof typeof pal]
    return color ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>` : ''
  })).join('')
  return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${tiles}</svg>`
}

const ROSTER: ReadonlyArray<{ sprite: Sprite; label: string; seat: string; actor: CrewMascotId }> = [
  { sprite: 'Planner', label: 'Lead', seat: 'leader', actor: 'qwen' },
  { sprite: 'Coder', label: 'Helper', seat: 'helper', actor: 'gemma' },
  { sprite: 'Reviewer', label: 'Review', seat: 'reviewer', actor: 'inkling' },
  { sprite: 'Cavalry', label: 'Cavalry', seat: 'cavalry', actor: 'codex' },
  { sprite: 'Jev', label: 'Jev', seat: 'referee', actor: 'jev' },
  { sprite: 'Venice', label: 'Venice', seat: 'escalation', actor: 'venice' },
  { sprite: 'Tests', label: 'Tests', seat: 'tests', actor: 'tests' }
]
const ART = new Map(ROSTER.map(({ sprite }) => [sprite, pixelArt(sprite)]))

export function crewStage(c: CrewView, runningId: string | undefined, now: number): string {
  const activity = c.reachable && runningId && c.live?.taskId === runningId ? c.live.mascots : []
  const actors = ROSTER.map(({ sprite, label, seat, actor }) => {
    const signal = activity.find((m) => m.id === actor)
    const host = c.seats.find((s) => s.id === seat || (seat === 'reviewer' && s.id === 'inkling'))
    const reserved = (c.reserveRoles ?? []).includes(seat)
    const standby = reserved ? 'Configured' : host || seat === 'tests' ? 'Standby' : 'Unconfirmed'
    const state = signal?.state === 'active' ? signal.action ?? 'Working'
      : signal && signal.state !== 'idle' ? signal.state
      : host?.state === 'down' ? 'Unavailable' : host?.state === 'busy' ? 'Seat in use'
      : standby
    const active = signal?.state === 'active'
    const model = host?.model || signal?.name
    const displayLabel = model && ['leader', 'helper', 'reviewer'].includes(seat) ? `${model} – ${label}` : label
    const detail = model || (actor === 'jev' ? 'Referee via OpenRouter' : label)
    const dim = host?.state === 'down' || state === 'Unconfirmed'
    const busy = host?.state === 'busy'
    const tone = active ? 'active' : dim ? 'dim' : busy ? 'held' : 'ready'
    return `<div class="crew-actor ${tone}" role="group" aria-label="${esc(`${displayLabel}, ${state}`)}" title="${esc(`${detail} · ${state}`)}">
      <div class="crew-pedestal"><div class="crew-pixel${active ? ' bob' : ''}">${ART.get(sprite)}</div></div>
      <b>${esc(displayLabel)}</b>${active ? `<span>${esc(state)}</span>` : ''}
    </div>`
  }).join('')
  const summary = runningId ? 'Run in progress' : 'Standing by'
  return `<section class="live crew-stage" aria-label="Crew lineup" style="--ph:-${Math.floor(now % 2400)}ms">
    <div class="crew-stage-title"><b>Crew</b><span class="${runningId ? 'on' : ''}">${summary}</span></div>
    <div class="crew-roster">${actors}</div>
  </section>`
}
