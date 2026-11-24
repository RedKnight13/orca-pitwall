import { assert, test } from 'orca/testing'
import { gatewayLine, LIVE_AT, liveLine } from '../../test/crew'
import { EMPTY_SNAPSHOT, type CrewView, type Snapshot } from '../shared/types'
import { crewLive } from '../worker/crew/live'
import { parseCrewReport, parseGatewayReport } from '../worker/crew/parse'
import { BURST_MS, renderLive } from './mascots'
import { INITIAL_UI, render, renderCrew } from './render'
import { CSS } from './styles'

function view(now: number, keep?: (id: string) => boolean): CrewView {
  const r = parseCrewReport(liveLine())
  const tasks = keep ? r.tasks.filter((t) => keep(t.id)) : r.tasks
  const g = parseGatewayReport(gatewayLine(), now)
  return { host: 'agnx', at: now - 5000, reachable: true, error: null, ...r, tasks, gateway: { at: now - 5000, reachable: true, error: null, ...g }, live: crewLive(tasks, r.lines, now) }
}
const snap = (crew: CrewView | null): Snapshot => ({ ...EMPTY_SNAPSHOT, at: LIVE_AT, crew })

test('the stage strip: mascots in pipeline order with their word, then the task and its clock', () => {
  const html = renderLive(view(LIVE_AT), LIVE_AT)
  const strip = /<div class="live-strip"[\s\S]*?<\/div>/.exec(html)![0]
  const words = [...strip.matchAll(/<span class="st st-(\w+)"><span aria-hidden="true">(\S+)<\/span> (.*?)<\/span>/g)].map((m) => `${m[2]} ${m[3].replace(/<\/?b>/g, '')}`)
  assert.deepEqual(words, ['Q writing…', 'G writing…', 'T —', 'I waiting', 'J waiting'])
  assert.equal((strip.match(/▸/g) ?? []).length, 4)
  assert.ok(strip.includes('task <code>1125-1012-ab12</code> · <span data-since="' + Date.parse('2026-11-25T10:12:00Z') + '">3m12s</span>'))
  // The strip reads out in words for a screen reader.
  assert.ok(strip.includes('aria-label="Qwen writing, Gemma writing, Tests waiting, Inkling waiting, Jev waiting"'))
})

test('one row per mascot: a bouncing face while generating, asleep while idle, action, bubble and card', () => {
  const html = renderLive(view(LIVE_AT), LIVE_AT)
  const rows = [...html.matchAll(/<div class="mascot m-(\w+) is-(\w+)">([\s\S]*?)\n<\/div>/g)]
  assert.deepEqual(rows.map((r) => [r[1], r[2]]), [
    ['qwen', 'active'],
    ['gemma', 'active'],
    ['tests', 'waiting'],
    ['inkling', 'waiting'],
    ['jev', 'waiting']
  ])
  const qwen = rows[0][3]
  assert.ok(qwen.includes('class="face bob"') && qwen.includes('>Q</span>'))
  assert.ok(qwen.includes('<span class="act">writing</span>'))
  assert.ok(qwen.includes(`data-since="${Date.parse('2026-11-25T10:13:42Z')}">1m30s<`))
  assert.ok(qwen.includes('<span class="bubble ell" title="writing · leader-build-1.out · 18 kB">'))
  // No read-only source for temperature or VRAM yet: a dash, and the tooltip says why.
  assert.ok(qwen.includes('R9700 · — · VRAM —'))
  assert.ok(qwen.includes('no read-only source for these yet'))
  assert.ok(!qwen.includes('tok/s'), 'no rate when the crew sends none')
  const tests = rows[2][3]
  assert.ok(tests.includes('class="face sleepy"') && tests.includes('>·</i>'))
  assert.ok(!tests.includes('hw muted'), 'the test runner has no card of its own')
  assert.ok(rows[1][3].includes('RX 9070 XT'))
})

test('tokens per second, temperature and VRAM show when the view has them', () => {
  const c = view(LIVE_AT)
  c.live!.mascots[0] = { ...c.live!.mascots[0], tokensPerSec: 41.6, tempC: 63.4, vramGb: { used: 18.24, total: 32 } }
  const html = renderLive(c, LIVE_AT)
  assert.ok(html.includes('<span class="tps">42 tok/s</span>'))
  assert.ok(html.includes('R9700 · 63°C · VRAM 18.2/32 GB'))
})

test('the hand-off plays once, soon after it happens', () => {
  const at = Date.parse('2026-11-25T10:13:43Z')
  const soon = renderLive(view(at + 2000), at + 2000)
  assert.ok(soon.includes(`data-once="ho:1125-1012-ab12:qwen:gemma:${at}"`))
  assert.ok(soon.includes('Qwen hands over to Gemma'))
  assert.ok(soon.includes('class="parcel"'))
  assert.ok(!renderLive(view(at + BURST_MS + 1000), at + BURST_MS + 1000).includes('class="handoff"'))
})

test('🎉 confetti at merge-ready, 💥 on failure; the words stay after the burst', () => {
  const end = Date.parse('2026-11-24T20:55:54Z')
  const ok = renderLive(view(end + 3000, (id) => id === '1124-2051-8e7f'), end + 3000)
  assert.ok(ok.includes('class="confetti" data-once="fin:1124-2051-8e7f:ok"'))
  assert.ok(ok.includes('<b>1124-2051-8e7f</b> merge-ready'))
  const later = renderLive(view(end + 120_000, (id) => id === '1124-2051-8e7f'), end + 120_000)
  assert.ok(!later.includes('confetti') && later.includes('✓') && later.includes('merge-ready'))
  const stop = Date.parse('2026-11-24T21:01:05Z')
  const bad = renderLive(view(stop + 3000, (id) => id === '1124-2056-0510'), stop + 3000)
  assert.ok(bad.includes('class="boom"') && bad.includes('×'))
  assert.ok(bad.includes('<b>1124-2056-0510</b> stopped short'))
})

test('reduced motion: every moving part is inside .live, which the reduce block stills', () => {
  const html = renderLive(view(Date.parse('2026-11-24T20:55:57Z'), (id) => id === '1124-2051-8e7f'), Date.parse('2026-11-24T20:55:57Z')) + renderLive(view(LIVE_AT), LIVE_AT)
  for (const cls of ['face bob', 'face sleepy', 'confetti']) assert.ok(html.includes(`class="${cls}"`), cls)
  // Each view is one .live root: nothing animated sits outside it.
  assert.ok(html.startsWith('<div class="live"') && html.endsWith('</div></div>'))
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.live, \.live \* \{ animation: none !important; transition: none !important; \}/.test(CSS))
  // Under reduced motion the meaning is still there in words: the action, the asleep state, the finale.
  assert.ok(html.includes('<span class="act">writing</span>'))
  assert.ok(html.includes('class="m-state m-waiting">waiting<') && html.includes('<i class="zz">·</i>'))
  assert.ok(html.includes('merge-ready'))
  // Loops start at the wall clock's phase, so a redraw never makes a face jump.
  assert.ok(new RegExp(`--ph:-${LIVE_AT % 2400}ms`).test(html))
})

test('unreachable: no mascots, the quiet line only', () => {
  const c = { ...view(LIVE_AT), reachable: false, error: 'unreachable', tasks: [], seats: [], live: null }
  const html = renderCrew(snap(c), INITIAL_UI, LIVE_AT)
  assert.ok(html.includes('Crew unreachable'))
  assert.ok(!html.includes('class="live') && !html.includes('mascot'))
})

test('nothing running: the crew naps and says what it did last', () => {
  const c = view(Date.parse('2026-11-25T12:00:00Z'), (id) => id !== '1125-1012-ab12')
  assert.equal(c.live, null)
  const html = renderLive(c, Date.parse('2026-11-25T12:00:00Z'))
  assert.ok(html.includes('No active Crew task reported · last <code>1124-2056-0510</code> waiting'))
  assert.ok(!html.includes('bob'))
})

test('in Crew mode, what needs the owner comes before the orchestrator map', () => {
  const html = render(snap(view(LIVE_AT)), INITIAL_UI, LIVE_AT).crew
  const owner = html.indexOf('cm-incident')
  const map = html.indexOf('class="crew-deck')
  assert.ok(owner > 0 && map > owner, `${owner} ${map}`)
})

test('everything in the mascot view is escaped', () => {
  const c = view(LIVE_AT)
  c.live = { ...c.live!, taskId: '<img src=x>', mascots: c.live!.mascots.map((m) => ({ ...m, bubble: '<b>x</b>', role: '"><i>', action: m.action && '<s>' })) }
  const html = renderLive(c, LIVE_AT)
  assert.ok(!html.includes('<img') && !html.includes('<b>x</b>') && !html.includes('"><i>') && !html.includes('<s>'))
})
