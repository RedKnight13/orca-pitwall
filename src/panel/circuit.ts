import type { CrewSeatView } from '../shared/types'
import type { RoleLine, RoleTone } from './crewStory'
import { esc } from './render'

const insignia: Record<string, string> = {
  leader: 'M-10 7 0-11 10 7 0 2Z M0-6V2',
  helper: 'M-4-7-11 0-4 7 M4-7 11 0 4 7 M2-10-2 10',
  reviewer: 'M0-11 9-7v7Q9 6 0 11-9 6-9 0v-7Z M-5 0-1 4 5-4',
  cavalry: 'M-9 9H9 M-7 5l3-9-5 2-2-4 8-5 4-3 1 5Q11-5 8 5Z',
  referee: 'M0-10V9 M-7 9H7 M-10-5H10 M-7-5-11 2h8Z M7-5 3 2h8Z',
  escalation: 'M-10 7 0-10 10 7 M-6 9 0-1 6 9'
}
const reserves: Record<string,string> = { cavalry:'Codex', referee:'Jev', escalation:'Venice' }

const TINT: Record<RoleTone, string> = { ok: '#8bd7a8', bad: '#ff956e', warn: '#f2c26b', run: '#8bffd4', quiet: '#85c1db', idle: '#7d8b96' }

/** The routing map. Each node's caption is its story word (assigned, rejected, called ×2), never a file name. */
export function circuit(host: string, seats: CrewSeatView[], roles: string[], engaged: Set<string>, said: RoleLine[]): string {
  const word = new Map(said.map((r) => [r.id as string, r]))
  const runner = word.get('runner')
  const roster = [
    ...seats.map(s => ({ id:s.id, name:s.model || s.id, role:s.role, reserve:false })),
    ...roles.filter(id => reserves[id]).map(id => ({ id, name:reserves[id], role:id, reserve:true }))
  ]
  const lines: string[] = []
  const nodes = roster.map((s,i) => {
    const x = 54 + 100 * (i % 3)
    const row = Math.floor(i / 3)
    const y = row === 0 ? 57 : 201 + (row-1)*104
    const link = row === 0 ? `M154 120 Q${x} 105 ${x} 78` : `M154 146 Q${x} 157 ${x} ${y-23}`
    const active = engaged.has(s.id)
    const r = word.get(s.id)
    const tint = active ? TINT.run : r ? TINT[r.tone] : s.reserve ? '#bea4ef' : TINT.quiet
    lines.push(`<path class="route-base${s.reserve ? ' reserve' : ''}" d="${link}"/>`)
    if(active) lines.push(`<path class="signal" d="${link}" stroke="${tint}"/>`)
    const detail = r?.word ?? (s.reserve ? 'not called' : '')
    return `<g transform="translate(${x} ${y})" style="--ink:${tint}" data-node="${esc(s.id)}"><title>${esc(s.role)} · ${esc(s.name)}${r ? ` · ${esc(r.says)}` : ''}</title>
      <circle r="23" class="role-orbit"/><path d="M-22-12a25 25 0 0 1 18-13 M22 12a25 25 0 0 1-18 13" class="orbit-tick"/>
      <circle r="17" class="role-core"/><path class="insignia" d="${insignia[s.id] ?? 'M-6 0H6 M0-6V6'}"/>
      <text y="-39" class="role-label">${esc(s.role.toUpperCase())}</text>
      <text y="-26" class="role-name">${esc(s.name)}</text>
      <text y="36" class="role-detail">${esc(detail)}</text></g>`
  }).join('')
  return `<svg class="command-map" viewBox="0 0 308 ${roster.length>3 ? 249+Math.max(0,Math.ceil(roster.length/3)-2)*104 : 161}" role="img" aria-label="Agent assignments and configured reserve roles">
    <defs><pattern id="crew-grid" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="#374754"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#crew-grid)"/>${lines.join('')}
    <path class="command-hub${runner ? ` hub-${runner.tone}` : ''}" d="M105 116h98l6 6v20l-6 6h-98l-6-6v-20z"><title>Crew runner${runner ? `: ${esc(runner.says)}` : ''}</title></path>
    <text class="hub-name" x="154" y="130">Crew runner</text><text class="hub-route" x="154" y="141">${esc(host)} / LiteLLM</text>
    ${nodes}</svg>`
}
