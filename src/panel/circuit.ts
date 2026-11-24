// Side elevation and die traces are schematic. Activity comes from the observed run.
import { esc } from './render'
import type { CrewSeatView } from '../shared/types'

function die(x: number, y: number, seat: CrewSeatView, hot: boolean): string {
  const device = seat.id === 'leader' ? 'R9700' : seat.id === 'helper' ? 'RX 9070 XT' : seat.where
  const ribs = Array.from({length: 7}, (_, i) => {
    const a = -27 + i * 7
    return `<path d="M${a} -1l9 -5 9 4 10 -5" />`
  }).join('')
  return `<g transform="translate(${x} ${y})" class="silicon${hot ? ' lit' : ''}">
    <path class="shadow" d="M-48 8l38 -20 57 23 -39 22z"/>
    <path class="edge" d="M-44 -1l36 -18 52 21v8L9 29l-53 -22z"/>
    <path class="plate" d="M-44 -1l36 -18 52 21L9 21z"/>
    <path class="edge" d="M-35 -7l28 -14 42 17v7L7 18l-42 -17z"/>
    <path class="lid" d="M-35 -7l28 -14 42 17L7 11z"/>
    <g class="ribs">${ribs}</g>
    <path class="die-core" d="M-15 -8l13 -7 18 7 -13 7z"/>
    <circle class="pilot" cx="34" cy="6" r="2"/>
    <text y="45" class="chip-name">${esc(seat.model || seat.id)}</text>
    <text y="57" class="chip-card">${esc(device)}</text></g>`
}

export function circuit(host: string, seats: CrewSeatView[], engaged: Set<string>, blocked: boolean): string {
  const width = 320
  const height = Math.max(178, 115 + Math.ceil(seats.length / 2) * 98)
  const wiring: string[] = []
  const chips = seats.map((seat, i) => {
    const x = i % 2 ? 232 : 86
    const y = 124 + Math.floor(i / 2) * 98
    const route = `M160 78 V${y-37} L${x} ${y-14} V${y}`
    wiring.push(`<path class="trace" d="${route}"/>`)
    if (engaged.has(seat.id)) wiring.push(`<path class="signal" d="${route}"/>`)
    return die(x, y, seat, engaged.has(seat.id))
  }).join('')
  return `<svg class="circuit-board${blocked ? ' halted' : ''}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Crew compute topology for ${esc(host)}">
    <defs><pattern id="pcb-grid" width="24" height="14" patternUnits="userSpaceOnUse"><path d="M0 7L12 0l12 7-12 7z" fill="none" stroke="#274958" stroke-width=".5"/></pattern></defs>
    <rect width="320" height="${height}" fill="url(#pcb-grid)" opacity=".55"/>
    <path class="trace" d="M160 40v17"/>
    ${engaged.size ? '<path class="signal" d="M160 40v17"/>' : ''}
    <g class="board-wires">${wiring.join('')}</g>
    <path class="socket" d="M104 13h103l8 8v16l-8 7H111l-8-7z"/><text class="host-label" x="160" y="32">${esc(host.toUpperCase())} / RUNNER</text>
    <rect class="socket" x="105" y="57" width="110" height="22" rx="2"/><text x="160" y="72" class="host-label">LiteLLM</text>
    ${chips}${blocked ? '<g class="gate-stop"><path d="M218 22l8 8m-8 0l8-8"/><text x="232" y="30">HOLD</text></g>' : ''}
    </svg>`
}
