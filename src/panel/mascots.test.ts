import { assert, test } from 'orca/testing'
import { gatewayLine, LIVE_AT, liveReport } from '../../test/crew'
import { EMPTY_SNAPSHOT, type CrewView, type Snapshot } from '../shared/types'
import { crewLive, SEAT_SCHEMA, type HardwareOf } from '../worker/crew/live'
import { parseCrewReport, parseGatewayReport } from '../worker/crew/parse'
import { stable } from './diff'
import { BURST_MS } from './mascots'
import { INITIAL_UI, render, renderCrew, type UiState } from './render'
import { CSS } from './styles'

const RUNNING = '1125-1012-ab12'
const TWIN = '1125-1100-cd34'

/** The crew view from the recorded report; `edit` changes the raw report first. */
function view(now: number, opts: { keep?: (id: string) => boolean; hw?: HardwareOf; edit?: (d: any) => void } = {}): CrewView {
  const d = liveReport()
  opts.edit?.(d)
  const r = parseCrewReport(JSON.stringify(d))
  const tasks = opts.keep ? r.tasks.filter((t) => opts.keep!(t.id)) : r.tasks
  const g = parseGatewayReport(gatewayLine(), now)
  return { host: 'agnx', at: now - 5000, reachable: true, error: null, ...r, tasks, gateway: { at: now - 5000, reachable: true, error: null, ...g }, live: crewLive(tasks, r.lines, now, opts.hw) }
}
const snap = (crew: CrewView | null): Snapshot => ({ ...EMPTY_SNAPSHOT, at: LIVE_AT, crew })
const crewHtml = (c: CrewView, now = LIVE_AT, ui: UiState = INITIAL_UI) => renderCrew(snap(c), ui, now)

/** One task's card, from its opening tag to its close. */
function card(html: string, id: string): string {
  const at = html.indexOf(`data-k="task:${id}"`)
  assert.ok(at > 0, `no card for ${id}`)
  const start = html.lastIndexOf('<article', at)
  return html.slice(start, html.indexOf('</article>', at) + '</article>'.length)
}
const strip = (h: string) => /<div class="live-strip"[\s\S]*?<\/div>/.exec(h)![0]
const rows = (h: string) => [...h.matchAll(/<div class="mascot m-(\w+)" data-k="seat:([^:"]+):\w+">/g)].map((m) => `${m[2]}:${m[1]}`)

/** A second running task beside the first: its leader is done, its helper still writes. */
function twin(d: any) {
  d.tasks.push({ ...d.tasks.find((t: any) => t.id === RUNNING), id: TWIN, prompt: 'Another package', updated: '2026-11-25T10:15:11+00:00' })
  d.status.text += `${TWIN}  running      stage=build   attempts=1  /w/y  Another package\n`
  for (const e of d.events.filter((e: any) => e.task === RUNNING)) d.events.push({ ...e, task: TWIN })
  d.events.push({ schema: SEAT_SCHEMA, seat_event: 'stop', ts: '2026-11-25T10:15:05+00:00', task: TWIN, stage: 'build', attempt: 1, seat: 'leader', slot: '', output: 'leader-build-1.out', seconds: 83, exit: 0, timed_out: false })
}

const MODELS: HardwareOf = (seat) =>
  seat === 'leader' ? { card: 'R9700', host: 'agni1', tempC: null, vramGb: null } : seat === 'helper' ? { card: 'RX 9070 XT', host: 'agni1', tempC: null, vramGb: null } : seat === 'reviewer' ? { card: 'RTX 5060', host: 'agni2', tempC: null, vramGb: null } : null

test('nesting: the mascots sit inside the running task\'s own card, not under the task that waits on the owner', () => {
  const html = crewHtml(view(LIVE_AT))
  assert.equal((html.match(/<div class="live"/g) ?? []).length, 1)
  const running = card(html, RUNNING)
  assert.ok(running.includes(`<div class="live" data-k="live:${RUNNING}"`), 'inside the running card')
  // The task that waits on the owner is a line above, with no mascots of its own.
  const owner = html.indexOf('data-k="task:1124-2056-0510"')
  assert.ok(owner > 0 && owner < html.indexOf(`data-k="task:${RUNNING}"`))
  assert.ok(!/data-k="task:1124-2056-0510"[^>]*>[\s\S]*?class="live"[\s\S]*?<\/article>[\s\S]*data-k="task:1125/.test(html))
})

test('one card per task: the prompt, stage bar, mascots and stages, nothing said twice', () => {
  const c = card(crewHtml(view(LIVE_AT)), RUNNING)
  assert.equal((c.match(/<article/g) ?? []).length, 1)
  assert.equal((c.match(/>1125-1012-ab12</g) ?? []).length, 1, 'the id shows once')
  assert.ok(c.includes('class="prompt small"') && c.includes('class="strip"'))
  // The stage list is folded while the task runs: a count and the stage at work, no rows.
  assert.ok(c.includes('data-key-x="crewstages:1125-1012-ab12" data-open="0" aria-expanded="false"'))
  assert.ok(c.includes('3 stages · <span class="sub-t">build</span>'))
  assert.ok(!c.includes('sheet-row'))
  // Opening it shows the run sheet.
  const open = card(crewHtml(view(LIVE_AT), LIVE_AT, { ...INITIAL_UI, expanded: { 'crewstages:1125-1012-ab12': true } }), RUNNING)
  assert.equal((open.match(/class="sheet-row/g) ?? []).length, 3)
})

test('the strip: one line of faces; the working ones move and say their word, the rest are dimmed with no text', () => {
  const s = strip(card(crewHtml(view(LIVE_AT)), RUNNING))
  const on = [...s.matchAll(/<span class="st on m-(\w+)"><span class="face bob" aria-hidden="true">\S+<\/span><b>(\w+)<\/b><\/span>/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(on, ['qwen writing', 'gemma writing'])
  const dim = [...s.matchAll(/<span class="st dim st-(\w+)" title="([^"]+)" aria-hidden="true">(\S+)<\/span>/g)].map((m) => [m[1], m[2], m[3]])
  assert.deepEqual(dim, [
    ['waiting', 'Tests waiting', '🧪'],
    ['waiting', 'Inkling waiting', '🐙'],
    ['waiting', 'Jev waiting', '🦉']
  ])
  assert.ok(!s.includes('▸') && !s.includes(RUNNING) && !s.includes('data-since'), 'no separators, task id or clock')
  assert.ok(s.includes('aria-label="Qwen writing, Gemma writing, Tests waiting, Inkling waiting, Jev waiting"'))
  assert.ok(/\.live-strip \{[^}]*white-space: nowrap; overflow: hidden;/.test(CSS))
})

test('no duplicated words: the bubble is the output file and its size; the action word shows once per seat', () => {
  const live = /<div class="live"[\s\S]*<\/div>/.exec(card(crewHtml(view(LIVE_AT)), RUNNING))![0]
  assert.ok(live.includes('<span class="bubble ell" title="leader-build-1.out · 18 kB">leader-build-1.out · 18 kB</span>'))
  assert.ok(live.includes('>helper-author-1.out · 6 kB<'))
  const visible = live.replace(/<[^>]*>/g, ' ')
  assert.equal((visible.match(/writing/g) ?? []).length, 2, visible)
})

test('idle fold: only working seats get a row; the rest fold into one dimmed row with 💤', () => {
  const c = card(crewHtml(view(LIVE_AT)), RUNNING)
  assert.deepEqual(rows(c), [`${RUNNING}:qwen`, `${RUNNING}:gemma`])
  const fold = /<div class="fold"[\s\S]*?<\/div>/.exec(c)![0]
  assert.ok(fold.includes('aria-label="Tests waiting, Inkling waiting, Jev waiting"'))
  assert.ok(fold.includes('<span class="fold-zz">') && fold.includes('💤'))
  assert.equal((fold.match(/class="fold-m"/g) ?? []).length, 3)
  // A seat that starts gets its row, and leaves the fold.
  const later = view(LIVE_AT + 1000, {
    edit: (d) => d.events.push({ schema: SEAT_SCHEMA, seat_event: 'start', ts: '2026-11-25T10:15:12+00:00', task: RUNNING, stage: 'review', attempt: 1, seat: 'reviewer', slot: '', output: 'review-1.md', seconds: 0 })
  })
  const c2 = card(crewHtml(later, LIVE_AT + 1000), RUNNING)
  assert.deepEqual(rows(c2), [`${RUNNING}:qwen`, `${RUNNING}:gemma`, `${RUNNING}:inkling`])
  assert.ok(!/<div class="fold"[\s\S]*?<\/div>/.exec(c2)![0].includes('Inkling'))
})

test('idle only: a running task with nobody at work shows the strip and the fold, no rows', () => {
  const c = view(LIVE_AT, {
    edit: (d) => {
      d.events = d.events.filter((e: any) => !('seat_event' in e))
      d.tasks = d.tasks.map((t: any) => (t.id === RUNNING ? { ...t, stage: 'ask_owner' } : t))
      d.status.text = d.status.text.replace('stage=build', 'stage=ask_owner')
    }
  })
  const h = card(crewHtml(c), RUNNING)
  assert.deepEqual(rows(h), [])
  assert.ok(!h.includes('class="mascots"') && !h.includes('face bob'))
  assert.ok(h.includes('class="fold"') && h.includes('💤'))
  assert.ok(!h.includes('class="live-strip"'), 'the fold already shows everyone')
})

test('several running tasks: each card has its own mascots, keyed by task and seat', () => {
  const html = crewHtml(view(LIVE_AT, { edit: twin }))
  assert.equal((html.match(/<div class="live"/g) ?? []).length, 2)
  const a = card(html, RUNNING)
  const b = card(html, TWIN)
  assert.deepEqual(rows(a), [`${RUNNING}:qwen`, `${RUNNING}:gemma`])
  assert.deepEqual(rows(b), [`${TWIN}:gemma`])
  assert.ok(/<div class="fold"[\s\S]*?<\/div>/.exec(b)![0].includes('Qwen done'))
})

test('no empty data: no dashes; the card name alone until figures arrive, and no card without a config', () => {
  const none = card(crewHtml(view(LIVE_AT)), RUNNING)
  assert.ok(!none.includes('—') && !none.includes('VRAM') && !none.includes('°C') && !none.includes('tok/s') && !none.includes('class="hw"'))
  const named = card(crewHtml(view(LIVE_AT, { hw: MODELS })), RUNNING)
  assert.ok(named.includes('<span class="hw" title="R9700 on agni1"><span class="hw-card">R9700</span></span>'))
  assert.ok(!named.includes('—') && !named.includes('°C') && !named.includes(' GB'))
})

test('card figures when the host answers: temperature amber at 85 °C, red at 95 °C, VRAM in GB, tok/s if sent', () => {
  const hw =
    (t: number): HardwareOf =>
    (seat) =>
      seat === 'leader' ? { card: 'R9700', host: 'agni1', tempC: t, vramGb: { used: 28.66, total: 31.86 } } : seat === 'helper' ? { card: 'RX 9070 XT', host: 'agni1', tempC: 61.4, vramGb: null } : null
  const cool = card(crewHtml(view(LIVE_AT, { hw: hw(63) })), RUNNING)
  assert.ok(cool.includes('<span class="hw-card">R9700</span><span class="hw-t">63°C</span><span>28.7/32 GB</span>'))
  assert.ok(cool.includes('<span class="hw-card">RX 9070 XT</span><span class="hw-t">61°C</span></span>'), 'no VRAM, no VRAM field')
  assert.ok(card(crewHtml(view(LIVE_AT, { hw: hw(85) })), RUNNING).includes('<span class="hw-t t-warn">85°C</span>'))
  assert.ok(card(crewHtml(view(LIVE_AT, { hw: hw(96.2) })), RUNNING).includes('<span class="hw-t t-bad">96°C</span>'))
  const c = view(LIVE_AT)
  c.live[0].mascots[0] = { ...c.live[0].mascots[0], card: 'R9700', tokensPerSec: 41.6 }
  assert.ok(card(crewHtml(c), RUNNING).includes('<span class="tps">42 tok/s</span>'))
})

test('the hand-off plays once, soon after it happens', () => {
  const at = Date.parse('2026-11-25T10:13:43Z')
  const soon = card(crewHtml(view(at + 2000), at + 2000), RUNNING)
  assert.ok(soon.includes(`data-once="ho:${RUNNING}:qwen:gemma:${at}"`))
  assert.ok(soon.includes('Qwen hands over to Gemma'))
  assert.ok(!card(crewHtml(view(at + BURST_MS + 1000), at + BURST_MS + 1000), RUNNING).includes('class="handoff"'))
})

test('merge-ready: the task\'s own card opens with 🎉 and its stages; failure: 💥 Stopped short', () => {
  const end = Date.parse('2026-11-24T20:55:54Z')
  const html = crewHtml(view(end + 3000, { keep: (id) => id === '1124-2051-8e7f' }), end + 3000)
  const ok = card(html, '1124-2051-8e7f')
  assert.ok(ok.includes('class="confetti" data-once="fin:1124-2051-8e7f:ok"'))
  // The pill says Merge-ready; the 🎉 leads the fold, its word for screen readers only.
  assert.ok(ok.includes('<span class="fin-face" aria-hidden="true">🎉</span><span class="sr">Merge-ready</span>'))
  assert.ok(!ok.includes('class="live-strip"'), 'nobody at work: no strip, the fold shows everyone')
  assert.ok(ok.includes('class="sheet-row"'), 'stages open once it stops running')
  assert.ok(/<div class="fold"[\s\S]*?Tests done: tests pass · test-1\.txt/.test(ok))
  const later = card(crewHtml(view(end + 120_000, { keep: (id) => id === '1124-2051-8e7f' }), end + 120_000), '1124-2051-8e7f')
  assert.ok(!later.includes('confetti') && later.includes('🎉') && later.includes('Merge-ready'))
  const stop = Date.parse('2026-11-24T21:01:05Z')
  const bad = card(crewHtml(view(stop + 3000, { keep: (id) => id === '1124-2056-0510' }), stop + 3000), '1124-2056-0510')
  assert.ok(bad.includes('class="boom"') && bad.includes('💥') && bad.includes('<b>Stopped short</b>'))
  // Folded by the owner, it is a line again.
  const folded = crewHtml(view(stop + 3000, { keep: (id) => id === '1124-2056-0510' }), stop + 3000, { ...INITIAL_UI, expanded: { 'crew:1124-2056-0510': false } })
  assert.ok(!folded.includes('class="live"') && folded.includes('class="line crew-line"'))
})

test('reduced motion and hidden panels: every moving part is inside .live, stilled or paused', () => {
  const html = crewHtml(view(Date.parse('2026-11-24T20:55:57Z'), { keep: (id) => id === '1124-2051-8e7f' }), Date.parse('2026-11-24T20:55:57Z')) + crewHtml(view(LIVE_AT))
  for (const cls of ['face bob', 'confetti', 'fold-zz']) assert.ok(html.includes(`class="${cls}"`), cls)
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.live, \.live \* \{ animation: none !important; transition: none !important; \}/.test(CSS))
  assert.ok(CSS.includes('.paused .live, .paused .live * { animation-play-state: paused !important; }'))
  // Under reduced motion the meaning is still there in words.
  assert.ok(html.includes('<b>writing</b>') && html.includes('Merge-ready') && html.includes('Tests waiting'))
  // No phase in the markup: main.ts sets it on each face it inserts, so a redraw changes nothing.
  assert.ok(!html.includes('--ph'))
})

test('no re-render storm: a later render that only moves the clocks has the same stable markup; a new seat does not', () => {
  // The same answer from agnx (same read time), drawn 7 s later.
  const read = (now: number) => ({ ...view(now), at: LIVE_AT - 5000 })
  const a = render(snap(read(LIVE_AT)), INITIAL_UI, LIVE_AT).crew
  const b = render(snap(read(LIVE_AT + 7000)), INITIAL_UI, LIVE_AT + 7000).crew
  assert.notEqual(a, b, 'the clocks moved')
  assert.equal(stable(a), stable(b))
  const c = render(snap(view(LIVE_AT + 7000, { edit: (d) => d.events.push({ schema: SEAT_SCHEMA, seat_event: 'start', ts: '2026-11-25T10:15:14+00:00', task: RUNNING, stage: 'review', attempt: 1, seat: 'reviewer', slot: '', output: 'review-1.md', seconds: 0 }) })), INITIAL_UI, LIVE_AT + 7000).crew
  assert.notEqual(stable(a), stable(c))
})

test('unreachable: no mascots, the quiet line only', () => {
  const c = { ...view(LIVE_AT), reachable: false, error: 'unreachable', tasks: [], seats: [], live: [] }
  const html = crewHtml(c)
  assert.ok(html.includes('Crew unreachable'))
  assert.ok(!html.includes('class="live') && !html.includes('mascot'))
})

test('nothing running: the crew naps and says what it did last', () => {
  const at = Date.parse('2026-11-25T12:00:00Z')
  const c = view(at, { keep: (id) => id !== RUNNING })
  assert.deepEqual(c.live, [])
  const html = crewHtml(c, at)
  assert.ok(html.includes('Crew asleep · last <code>1124-2056-0510</code> waiting'))
  assert.ok(!html.includes('bob'))
})

test('everything in the mascot view is escaped', () => {
  const c = view(LIVE_AT)
  c.live = [{ ...c.live[0], mascots: c.live[0].mascots.map((m) => ({ ...m, bubble: '<b>x</b>', role: '"><i>', action: m.action && '<s>', card: '<u>', host: '"x' })) }]
  const html = crewHtml(c)
  assert.ok(!html.includes('<b>x</b>') && !html.includes('"><i>') && !html.includes('<s>') && !html.includes('<u>'))
})
