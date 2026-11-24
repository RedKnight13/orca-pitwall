import { assert, test } from 'orca/testing'
import { agnxLine, gatewayLine, RECORDED_AT } from '../../test/crew'
import { EMPTY_SNAPSHOT, type CrewView, type Snapshot } from '../shared/types'
import { parseCrewReport, parseGatewayReport } from '../worker/crew/parse'
import { fmtSecs, INITIAL_UI, LITELLM_URL, render, renderCrew } from './render'

const now = RECORDED_AT

function crewView(patch: Partial<CrewView> = {}): CrewView {
  const r = parseCrewReport(agnxLine())
  const g = parseGatewayReport(gatewayLine(), now)
  return { host: 'agnx', at: now - 5000, reachable: true, error: null, ...r, gateway: { at: now - 5000, reachable: true, error: null, ...g }, ...patch }
}

const snap = (crew: CrewView | null): Snapshot => ({ ...EMPTY_SNAPSHOT, at: now, crew })

test('off: no Crew section, and the menu offers it', () => {
  const r = render(snap(null), { ...INITIAL_UI, menu: true }, now)
  assert.equal(r.crew, '')
  assert.ok(r.header.includes('data-action="crew"'))
  assert.ok(r.header.includes('aria-checked="false"'))
})

test('on, recorded data: running task as a card with its timeline, seats, gateway and link', () => {
  const r = render(snap(crewView()), { ...INITIAL_UI, menu: true }, now)
  assert.ok(r.header.includes('aria-checked="true"'))
  assert.ok(r.crew.includes('Crew'))
  // The running task is a card with a strip and its open stage.
  assert.equal((r.crew.match(/<article class="card crew-card/g) ?? []).length, 1)
  assert.ok(r.crew.includes('1124-1120-46a7'))
  assert.ok(r.crew.includes('class="strip"'))
  assert.ok(r.crew.includes('seg-run'))
  // The rest fold into lines, six at most until asked.
  assert.equal((r.crew.match(/<article class="line crew-line/g) ?? []).length, 6)
  assert.ok(r.crew.includes('Show all 8'))
  // Seats with the lock holder; both keys with their budgets.
  assert.ok(r.crew.includes('Qwen') && r.crew.includes('Gemma') && r.crew.includes('Inkling'))
  assert.ok(r.crew.includes('lock: crew/1124-1120-46a7'))
  assert.ok(!r.crew.includes('agni1-only'))
  assert.ok(r.crew.includes('agni-crew-jev') && r.crew.includes('/ $5.00'))
  assert.ok(r.crew.includes('agni-crew-claude') && r.crew.includes('/ $100'))
  // Recorded at 16:45 on Nov 24; the keys expire 08:50 on Dec 24: 29 whole days left.
  assert.ok(r.crew.includes('29d left'))
  assert.ok(r.crew.includes('data-action="litellm"') && r.crew.includes(LITELLM_URL))
})

test('an opened task shows its run sheet with seconds per stage', () => {
  const r = renderCrew(snap(crewView()), { ...INITIAL_UI, expanded: { crewall: true, 'crew:1124-1105-e46c': true } }, now)
  const card = r.slice(r.indexOf('1124-1105-e46c') - 400)
  assert.ok(card.includes('class="sheet"'))
  assert.ok(card.includes('>review<') || card.includes('review</b>'))
  assert.ok(card.includes('>PASS<'))
  assert.ok(card.includes('>1m00s<'), 'review took 60.02 s')
})

test('tasks waiting on the owner go to the top as alerts, a few then a count', () => {
  const r = render(snap(crewView()), INITIAL_UI, now)
  assert.equal((r.alerts.match(/badge-warn">Crew/g) ?? []).length, 2)
  assert.ok(r.alerts.includes('4 more tasks wait on you'))
  assert.ok(r.alerts.includes('Codex cavalry'))
  // Owner tasks lead the Crew list too.
  const first = /<article class="line crew-line[\s\S]*?<\/article>/.exec(r.crew)![0]
  assert.ok(/cpill (wait|fail)/.test(first), first)
})

test('a task without a test command gets the exact resume command', () => {
  const c = crewView()
  c.tasks = [{ ...c.tasks[0], id: '1124-1300-aaaa', status: 'needs_owner', owner: 'test_command', detail: 'No test command' }]
  const r = render(snap(c), INITIAL_UI, now)
  assert.ok(r.alerts.includes('needs a test command'))
  assert.ok(r.alerts.includes('crew resume 1124-1300-aaaa --test-command CMD'))
})

test('agnx unreachable: one quiet line, no tasks, no error wall; the gateway still shows', () => {
  const r = render(snap(crewView({ reachable: false, error: 'unreachable', tasks: [], seats: [] })), INITIAL_UI, now)
  assert.ok(r.crew.includes('Crew unreachable'))
  assert.ok(r.crew.includes('agnx unreachable'))
  assert.ok(r.crew.includes('Last answered'))
  assert.ok(!r.crew.includes('crew-card'))
  assert.ok(r.crew.includes('agni-crew-jev'))
  assert.equal(r.alerts, '')
})

test('just turned on: reading, not unreachable; demo mode hides the Crew item', () => {
  const r = renderCrew(snap(crewView({ reachable: false, error: null, at: null, tasks: [], seats: [] })), INITIAL_UI, now)
  assert.ok(r.includes('reading…') && r.includes('Reading the crew on agnx…'))
  assert.ok(!r.includes('unreachable'))
  const demo = render({ ...snap(null), demo: true }, { ...INITIAL_UI, menu: true }, now)
  assert.ok(!demo.header.includes('data-action="crew"'))
})

test('never reached: says so plainly', () => {
  const c = crewView({ reachable: false, error: 'timeout', at: null, tasks: [], seats: [] })
  c.gateway = { at: null, reachable: false, error: 'unreachable', keys: [], missing: [] }
  const r = renderCrew(snap(c), INITIAL_UI, now)
  assert.ok(r.includes('Crew unreachable'))
  assert.ok(r.includes('ssh agnx: timeout'))
  assert.ok(r.includes('Gateway unreachable (unreachable)'))
})

test('agni2 off: the reviewer is down and the section says agni1-only mode', () => {
  const c = crewView()
  c.agni1Only = true
  c.seats = c.seats.map((s) => (s.id === 'reviewer' ? { ...s, state: 'down' as const } : s))
  const r = renderCrew(snap(c), INITIAL_UI, now)
  assert.ok(r.includes('agni2 off, agni1-only mode'))
  assert.ok(r.includes('seat-down'))
})

test('gateway keys: amber in the section, red also at the top', () => {
  const c = crewView()
  c.gateway.keys = [
    { alias: 'agni-crew-jev', spendUsd: 4.2, budgetUsd: 5, pct: 84, expiresAt: now + 30 * 86_400_000, tone: 'warn' },
    { alias: 'agni-crew-claude', spendUsd: 100, budgetUsd: 100, pct: 100, expiresAt: now + 30 * 86_400_000, tone: 'bad' }
  ]
  const r = render(snap(c), INITIAL_UI, now)
  assert.ok(r.crew.includes('meter warn'))
  assert.ok(r.crew.includes('meter bad'))
  assert.ok(r.alerts.includes('badge-bad">Gateway'))
  assert.ok(r.alerts.includes('agni-crew-claude'))
  assert.ok(r.alerts.includes('has spent its budget'))
  assert.ok(!r.alerts.includes('agni-crew-jev'))
})

test('everything from the crew is escaped', () => {
  const c = crewView()
  c.tasks[0] = { ...c.tasks[0], id: '<img src=x>', prompt: '"><script>x</script>', detail: '<b>d</b>' }
  c.seats[0] = { ...c.seats[0], holder: '<i>h</i>' }
  const html = Object.values(render(snap(c), { ...INITIAL_UI, expanded: { ['crew:<img src=x>']: true } }, now)).join('')
  assert.ok(!html.includes('<img src=x>') && !html.includes('<script>') && !html.includes('<b>d</b>') && !html.includes('<i>h</i>'))
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
