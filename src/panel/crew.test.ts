import { assert, test } from 'orca/testing'
import { agnxLine, gatewayLine, LIVE_AT, liveLine, RECORDED_AT } from '../../test/crew'
import { demoSnapshot } from '../worker/demo'
import { EMPTY_SNAPSHOT, type CrewView, type Snapshot } from '../shared/types'
import { crewLive } from '../worker/crew/live'
import { parseCrewReport, parseGatewayReport } from '../worker/crew/parse'
import { CREW_STALE_MS, crewMode, freshness } from './crewConsole'
import { fmtSecs, INITIAL_UI, render, renderCrew, type Rendered } from './render'

const now = RECORDED_AT

function crewView(patch: Partial<CrewView> = {}, line = agnxLine(), at = now): CrewView {
  const r = parseCrewReport(line)
  const g = parseGatewayReport(gatewayLine(), at)
  return { host: 'agnx', at: at - 5000, reachable: true, error: null, ...r, gateway: { at: at - 5000, reachable: true, error: null, ...g }, live: crewLive(r.tasks, r.lines, at), ...patch }
}

const snap = (crew: CrewView | null, at = now): Snapshot => ({ ...EMPTY_SNAPSHOT, at, crew })
const all = (r: Rendered) => Object.values(r).join('')

/** The live fixture with its running task removed: the crew is idle, its last run stopped short. */
function idleView(): CrewView {
  const at = Date.parse('2026-11-25T12:00:00Z')
  const c = crewView({}, liveLine(), at)
  c.tasks = c.tasks.filter((t) => t.id !== '1125-1012-ab12')
  c.live = null
  return c
}

// ---- Mode switching -------------------------------------------------------------------------

test('off: the standard Pitwall, and the menu offers Crew', () => {
  const r = render(snap(null), { ...INITIAL_UI, menu: true }, now)
  assert.equal(r.crew, '')
  assert.ok(!crewMode(snap(null)))
  assert.ok(r.header.includes('class="top"'))
  assert.ok(r.header.includes('data-action="crew"') && r.header.includes('aria-checked="false"'))
  assert.ok(r.agents.length > 0, 'the empty state still shows')
})

test('on: Crew mode owns the whole sidebar; every standard section and the footer are gone', () => {
  const s = { ...demoSnapshot(now, now - 40_000, true), demo: false, crew: crewView() }
  assert.ok(s.agents.length > 0 && s.log.length > 0, 'the fixture has agents and activity to hide')
  const r = render(s, INITIAL_UI, now)
  assert.ok(crewMode(s))
  for (const k of ['agents', 'alerts', 'gate', 'log', 'footer'] as const) assert.equal(r[k], '', k)
  assert.ok(!r.header.includes('class="top"'), 'no standard header')
  assert.ok(r.crew.startsWith('<main class="crew-console"'))
  // One obvious way back: the bar's first control turns Crew mode off.
  assert.ok(/<header class="cm-bar">\s*<button class="cm-back" data-action="crew"[^>]*>‹ Pitwall<\/button>/.test(r.header), r.header)
})

test('leaving Crew mode brings the standard view back unchanged', () => {
  const base = { ...demoSnapshot(now, now - 40_000, true), demo: false }
  const before = render({ ...base, crew: null }, INITIAL_UI, now)
  render({ ...base, crew: crewView() }, INITIAL_UI, now)
  const after = render({ ...base, crew: null }, INITIAL_UI, now)
  assert.deepEqual(after, before)
  assert.ok(after.agents.length > 0 && after.footer.length > 0)
})

test('demo mode keeps the standard view even with the Crew setting on, and hides the Crew item', () => {
  const s = { ...demoSnapshot(now, now - 40_000, true), crew: crewView() }
  const r = render(s, { ...INITIAL_UI, menu: true }, now)
  assert.ok(!crewMode(s))
  assert.equal(r.crew, '')
  assert.ok(r.header.includes('class="top"') && !r.header.includes('data-action="crew"'))
  assert.ok(!r.alerts.includes('Crew'))
  assert.equal(renderCrew(s, INITIAL_UI, now), '')
})

test('LiteLLM stays a routing node; no gateway dashboard link and no key budgets', () => {
  const html = all(render(snap(crewView()), INITIAL_UI, now))
  assert.ok(html.includes('agnx / LiteLLM'), 'the hub names LiteLLM')
  assert.ok(!html.includes('data-action="litellm"') && !html.includes('/ui"') && !html.includes('dashboard'))
  assert.ok(!html.includes('/ $5.00') && !html.includes('/ $100') && !html.includes('class="meter') && !html.includes('d left'))
  assert.ok(!html.includes('agni-crew-jev'), 'healthy keys are not listed')
})

// ---- Live state ------------------------------------------------------------------------------

test('running: the Now panel leads with task, stage, elapsed, latest progress and who works', () => {
  const r = render(snap(crewView({}, liveLine(), LIVE_AT), LIVE_AT), INITIAL_UI, LIVE_AT)
  const nowPanel = /<section class="cm-now run"[\s\S]*?<\/section>/.exec(r.crew)![0]
  assert.ok(r.crew.indexOf('cm-now run') < r.crew.indexOf('crew-deck'), 'live state comes first')
  // The task in words; its id is detail (a tooltip), not the headline.
  assert.ok(nowPanel.includes('class="cm-prompt"') && nowPanel.includes('>Finish the textkit package.</p>'))
  assert.ok(nowPanel.includes('title="Task 1125-1012-ab12 in agni-crew-three-seat"'))
  assert.ok(nowPanel.includes('<h1>build</h1>'))
  assert.ok(/class="cm-elapsed"[^>]*><span data-since="\d+">/.test(nowPanel), 'a ticking elapsed clock')
  assert.ok(nowPanel.includes('<b>plan</b> ok in 1m20s'), 'the last stage that actually finished')
  assert.ok(nowPanel.includes('>Qwen</b>') && nowPanel.includes('>Gemma</b>'), 'the seats generating now')
  // The orchestrator says it is live, and its routes move.
  assert.ok(r.crew.includes('class="crew-deck d-live moving"'))
  assert.ok(r.crew.includes('<span class="deck-mode">Live</span>'))
  assert.ok(r.crew.includes('class="signal"'))
})

test('a running task queued behind a held seat says so', () => {
  const c = crewView({}, liveLine(), LIVE_AT)
  c.tasks = c.tasks.map((t) => (t.id === '1125-1012-ab12' ? { ...t, waitingOn: { seat: 'reviewer', holder: 'crew/1125-0900-zzzz' } } : t))
  const html = renderCrew(snap(c, LIVE_AT), INITIAL_UI, LIVE_AT)
  assert.ok(html.includes('<b>Queued</b> for the reviewer seat · held by <code>crew/1125-0900-zzzz</code>'))
})

test('idle: no task running, and the last run is labelled recorded, not a current incident', () => {
  const c = idleView()
  const at = Date.parse('2026-11-25T12:00:00Z')
  const html = renderCrew(snap(c, at), INITIAL_UI, at)
  assert.ok(html.includes('<section class="cm-now idle"') && html.includes('<h1>No crew run in progress</h1>'))
  assert.ok(html.includes('Last run: Make the durations package correct.'))
  assert.ok(!html.includes('cm-now run'))
  // The map still shows where that run stopped (the blocked hand-off), but still and labelled as the past.
  assert.ok(html.includes('class="crew-deck d-last held"'))
  assert.ok(html.includes('Last run · recorded'))
  assert.ok(!html.includes('moving') && !html.includes('class="signal"'))
  // The map says what happened in words, never a clipped file name.
  assert.ok(html.includes('class="role-detail">rejected</text>') && !html.includes('handoff blocked'))
  assert.ok(!/class="role-detail">[^<]*\.py</.test(html))
})

test('needs you: cause, how far it got and the next step, two at a time', () => {
  const html = renderCrew(snap(crewView()), INITIAL_UI, now)
  const owners = crewView().tasks.filter((t) => t.owner).length
  assert.ok(owners > 2)
  assert.ok(html.includes(`Needs you <span>${owners}</span>`))
  assert.equal((html.match(/<article class="cm-incident">/g) ?? []).length, 2)
  assert.ok(html.includes(`Show all ${owners}`))
  assert.ok(html.includes('<dt>Cause</dt>') && html.includes('<dt>Reached</dt>') && html.includes('<dt>Next</dt>'))
  assert.ok(html.includes('the leader did not write a well-formed .crew/task.md'), 'the recorded cause, verbatim')
  const open = renderCrew(snap(crewView()), { ...INITIAL_UI, expanded: { 'crew:incidents': true } }, now)
  assert.equal((open.match(/<article class="cm-incident">/g) ?? []).length, owners)
})

test('a task without a test command gets the exact resume command', () => {
  const c = crewView()
  c.tasks = [{ ...c.tasks[0], id: '1124-1300-aaaa', status: 'needs_owner', owner: 'test_command', detail: 'No test command' }]
  const html = renderCrew(snap(c), INITIAL_UI, now)
  assert.ok(html.includes('Needs a test command'))
  assert.ok(html.includes('crew resume 1124-1300-aaaa --test-command CMD'))
})

// ---- Freshness -------------------------------------------------------------------------------

test('freshness: live, stale past three missed reads, unreachable, connecting', () => {
  assert.equal(freshness(crewView(), now), 'live')
  assert.equal(freshness(crewView({ at: now - CREW_STALE_MS - 1 }), now), 'stale')
  assert.equal(freshness(crewView({ reachable: false, error: 'timeout' }), now), 'unreachable')
  assert.equal(freshness(crewView({ reachable: false, error: null, at: null }), now), 'connecting')
  const live = render(snap(crewView()), INITIAL_UI, now).header
  assert.ok(live.includes('cm-fresh f-live') && live.includes('class="cm-dot"') && live.includes(`data-ago="${now - 5000}"`))
  const stale = render(snap(crewView({ at: now - 60_000 })), INITIAL_UI, now).header
  assert.ok(stale.includes('cm-fresh f-stale') && !stale.includes('cm-dot'))
})

test('unreachable: what the crew does now is unknown; no tasks, no map', () => {
  const r = render(snap(crewView({ reachable: false, error: 'timeout', at: now - 95_000, tasks: [], seats: [], live: null })), INITIAL_UI, now)
  assert.ok(r.header.includes('cm-fresh f-unreachable') && r.header.includes(`data-ago="${now - 95_000}"`))
  assert.ok(r.crew.includes('Crew unreachable') && r.crew.includes('ssh agnx: timeout') && r.crew.includes('is unknown'))
  assert.ok(!r.crew.includes('crew-deck') && !r.crew.includes('cm-incident'))
})

test('connecting, then never reached: says so plainly', () => {
  const reading = renderCrew(snap(crewView({ reachable: false, error: null, at: null, tasks: [], seats: [] })), INITIAL_UI, now)
  assert.ok(reading.includes('Reading the crew on agnx…') && !reading.includes('unreachable'))
  const never = render(snap(crewView({ reachable: false, error: 'timeout', at: null, tasks: [], seats: [] })), INITIAL_UI, now)
  assert.ok(never.header.includes('never reached'))
  assert.ok(never.crew.includes('It has not answered since Crew mode started'))
})

// ---- Replay, health, history ----------------------------------------------------------------

test('replay is explicit and separate: the Now panel stays live', () => {
  const ui = { ...INITIAL_UI, playback: { task: '1124-2056-0510', index: 1, playing: true } }
  const html = renderCrew(snap(crewView({}, liveLine(), LIVE_AT), LIVE_AT), ui, LIVE_AT)
  assert.ok(html.includes('class="crew-deck d-replay moving"'))
  assert.ok(html.includes('Replay · 2/'))
  assert.ok(html.includes('data-action="deck-live">Exit replay') && html.includes('>Pause<'))
  assert.ok(html.includes('<section class="cm-now run"') && html.includes('Task 1125-1012-ab12'), 'live state unchanged')
  // Each run-sheet row is a labelled control to jump the replay there.
  assert.ok(/<button data-action="deck-step" data-key="1124-2056-0510" data-key-x="0" class="deck-event[^"]*" aria-label="Replay from admit/.test(html))
})

test('seats: health per seat; agni1-only and an unreachable gateway as notes', () => {
  const c = crewView()
  c.agni1Only = true
  c.seats = c.seats.map((s) => (s.id === 'reviewer' ? { ...s, state: 'down' as const } : s))
  c.gateway = { ...c.gateway, reachable: false, error: 'timeout' }
  const html = renderCrew(snap(c), INITIAL_UI, now)
  assert.ok(html.includes('class="s-down"') && html.includes('agni2 off: agni1-only mode'))
  assert.ok(html.includes('LiteLLM gateway unreachable (timeout)'))
})

test('a key out of budget is a gateway issue line, without figures or a link', () => {
  const c = crewView()
  c.gateway.keys = [{ alias: 'agni-crew-claude', spendUsd: 100, budgetUsd: 100, pct: 100, expiresAt: now + 30 * 86_400_000, tone: 'bad' }]
  const html = renderCrew(snap(c), INITIAL_UI, now)
  assert.ok(html.includes('<code>agni-crew-claude</code> out of budget'))
  assert.ok(!html.includes('$100') && !html.includes('litellm"'))
})

test('run history: folded by default; opened, a task shows its run sheet', () => {
  const closed = renderCrew(snap(crewView()), INITIAL_UI, now)
  assert.ok(closed.includes('aria-expanded="false"><h2>Run history</h2>'))
  assert.ok(!closed.includes('crew-line'))
  const html = renderCrew(snap(crewView()), { ...INITIAL_UI, expanded: { crewhistory: true, 'crew:1124-1105-e46c': true } }, now)
  assert.ok((html.match(/<article class="line crew-line/g) ?? []).length >= 6)
  const card = html.slice(html.indexOf('crew-card'))
  assert.ok(card.includes('class="sheet"') && card.includes('>PASS<'))
  assert.ok(card.includes('>1m00s<'), 'review took 60.02 s')
})

test('everything from the crew is escaped', () => {
  const c = crewView()
  c.tasks = c.tasks.map((t, i) => (i === 0 ? { ...t, id: '<img src=x>', prompt: '"><script>x</script>', detail: '<b>d</b>', owner: 'stuck' as const } : t))
  c.seats[0] = { ...c.seats[0], holder: '<i>h</i>', model: '<u>m</u>' }
  c.error = '<s>e</s>'
  const html = all(render(snap(c), { ...INITIAL_UI, expanded: { crewhistory: true, 'crew:<img src=x>': true } }, now)) + renderCrew(snap({ ...c, reachable: false }), INITIAL_UI, now)
  for (const bad of ['<img src=x>', '<script>', '<b>d</b>', '<i>h</i>', '<u>m</u>', '<s>e</s>']) assert.ok(!html.includes(bad), bad)
})

test('stage seconds format', () => {
  const cases: [number, string][] = [
    [0, '0s'],
    [0.01, '0s'],
    [0.4, '0.4s'],
    [9.96, '10s'],
    [31.39, '31s'],
    [139, '2m19s'],
    [-1, '0s']
  ]
  for (const [s, out] of cases) assert.equal(fmtSecs(s), out, String(s))
})
