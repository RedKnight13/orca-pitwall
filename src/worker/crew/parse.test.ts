import { assert, test } from 'orca/testing'
import { agnxLine, agnxReport, gatewayLine, RECORDED_AT, rootsLine, rootsReport } from '../../../test/crew'
import { keyTone, outcomeTone, parseCrewReport, parseGatewayReport, parseStatusList } from './parse'

const DAY = 86_400_000

test('crew status list: rows, a seat wait and the seat lock lines', () => {
  const l = parseStatusList(
    [
      '1124-1020-3645  waiting      stage=finish  attempts=2  /w/crew-1124-1020-3645  Fix the cache package.',
      '1124-1120-46a7  running      stage=build   attempts=1 wait=reviewer holder=bench/7  /w/x  Fix it',
      '1124-1200-0000  needs_owner  stage=-       attempts=0  /w/y  No test',
      'seat leader  holder=crew/1124-1120-46a7  priority=crew',
      'garbage line',
      ''
    ].join('\n')
  )
  assert.equal(l.tasks.size, 3)
  assert.deepEqual(l.tasks.get('1124-1020-3645'), { id: '1124-1020-3645', status: 'waiting', stage: 'finish', attempts: 2, wait: null, cavalry: false })
  assert.deepEqual(l.tasks.get('1124-1120-46a7')!.wait, { seat: 'reviewer', holder: 'bench/7' })
  assert.equal(l.tasks.get('1124-1200-0000')!.stage, null)
  assert.deepEqual(l.leases, [{ seat: 'leader', holder: 'crew/1124-1120-46a7', priority: 'crew' }])
})

test('outcome tones follow the Replay: pass, fail, else wait', () => {
  const cases: [string, string][] = [
    ['ok', 'pass'],
    ['tests_pass', 'pass'],
    ['PASS', 'pass'],
    ['merge_ready', 'pass'],
    ['committed', 'pass'],
    ['tests_fail', 'fail'],
    ['FAIL', 'fail'],
    ['malformed', 'fail'],
    ['no_test_command', 'fail'],
    ['retry', 'wait'],
    ['stop', 'wait'],
    ['waiting', 'wait'],
    ['', 'wait']
  ]
  for (const [outcome, tone] of cases) assert.equal(outcomeTone(outcome), tone, outcome)
})

test('recorded agnx report: the crew list wins over the task record, owner tasks first', () => {
  const r = parseCrewReport(agnxLine())
  assert.equal(r.tasks.length, 9)
  assert.equal(r.more, 0)
  // Five tasks the record calls merge_ready show as waiting in `crew status` (no sealed result).
  const byId = new Map(r.tasks.map((t) => [t.id, t]))
  assert.equal(byId.get('1124-0856-a58b')!.status, 'waiting')
  assert.equal(byId.get('1124-1105-e46c')!.status, 'merge_ready')
  // Waiting and failed tasks wait on the owner and sort first; then the running one; then merge-ready.
  const order = r.tasks.map((t) => (t.owner ? 'owner' : t.status))
  assert.deepEqual(order, ['owner', 'owner', 'owner', 'owner', 'owner', 'owner', 'running', 'merge_ready', 'merge_ready'])
  const failed = byId.get('1124-1112-2380')!
  assert.equal(failed.owner, 'stuck')
  assert.equal(failed.detail, 'the leader did not write a well-formed .crew/task.md')
  const stuck = byId.get('1124-1020-3645')!
  assert.equal(stuck.detail, 'tests exit 1 · review PASS · 2 attempts')
  assert.equal(byId.get('1124-1120-46a7')!.owner, null)
})

test('recorded agnx report: stage timeline in order with seconds per stage', () => {
  const r = parseCrewReport(agnxLine())
  const t = r.tasks.find((x) => x.id === '1124-1105-e46c')!
  assert.deepEqual(
    t.stages.map((s) => s.stage),
    ['intake', 'plan', 'build', 'grade', 'review', 'decide', 'finish']
  )
  const review = t.stages.find((s) => s.stage === 'review')!
  assert.equal(review.seconds, 60.02)
  assert.equal(review.outcome, 'PASS')
  assert.equal(review.tone, 'pass')
  assert.ok(Math.abs(t.totalSeconds - t.stages.reduce((n, s) => n + s.seconds, 0)) < 1e-9)
  for (let i = 1; i < t.stages.length; i++) assert.ok(t.stages[i].at >= t.stages[i - 1].at)
  // A retried task keeps both attempts.
  const retried = r.tasks.find((x) => x.id === '1124-1020-3645')!
  assert.ok(retried.stages.some((s) => s.attempt === 2))
  assert.ok(retried.stages.some((s) => s.outcome === 'tests_fail' && s.tone === 'fail'))
})

test('recorded agnx report: seats up, the leader busy under the seat lock', () => {
  const r = parseCrewReport(agnxLine())
  assert.equal(r.lockDeployed, true)
  assert.equal(r.agni1Only, false)
  assert.deepEqual(
    r.seats.map((s) => [s.id, s.model, s.state, s.holder]),
    [
      ['leader', 'Qwen', 'busy', 'crew/1124-1120-46a7'],
      ['helper', 'Gemma', 'up', null],
      ['reviewer', 'Inkling', 'up', null]
    ]
  )
})

test('reviewer :8093 silent means agni2 off, agni1-only mode; a down seat is never busy', () => {
  const d = agnxReport()
  d.seats = d.seats.map((s: { seat: string }) => (s.seat === 'reviewer' ? { ...s, health: null } : s.seat === 'leader' ? { ...s, health: 503 } : s))
  const r = parseCrewReport(JSON.stringify(d))
  assert.equal(r.agni1Only, true)
  assert.equal(r.seats.find((s) => s.id === 'reviewer')!.state, 'down')
  const leader = r.seats.find((s) => s.id === 'leader')!
  assert.equal(leader.state, 'down')
  assert.equal(leader.holder, null)
})

test('a task without a test command needs the owner; no seat lock deployed', () => {
  const d = agnxReport()
  d.tasks = [{ id: '1124-1300-aaaa', status: 'needs_owner', stage: 'intake', attempts: 0, prompt: 'p', created: '2026-11-24T13:00:00+00:00', updated: '2026-11-24T13:01:00+00:00', has_test_command: false, error: null, waiting_on_seat: null, result: {} }]
  d.status = { exit: 0, text: '1124-1300-aaaa  needs_owner  stage=intake  attempts=0  /w  p\n' }
  d.lock = { deployed: false, seats: [] }
  d.total = 30
  const r = parseCrewReport(JSON.stringify(d))
  assert.equal(r.tasks[0].owner, 'test_command')
  assert.match(r.tasks[0].detail, /test command/)
  assert.equal(r.more, 29)
  assert.equal(r.lockDeployed, false)
  assert.equal(r.seats.find((s) => s.id === 'leader')!.state, 'up')
})

test('output that is not the script\'s throws', () => {
  assert.throws(() => parseCrewReport('Welcome to agnx\n'))
  assert.throws(() => parseCrewReport(JSON.stringify({ schema: 'other' })))
  assert.throws(() => parseGatewayReport('{}', 0))
  assert.throws(() => parseGatewayReport(JSON.stringify({ schema: 'pitwall.gateway/1', error: 'http_401' }), 0), /http_401/)
})

test('recorded gateway report: spend against budget and expiry', () => {
  const g = parseGatewayReport(gatewayLine(), RECORDED_AT)
  assert.deepEqual(g.missing, [])
  assert.deepEqual(
    g.keys.map((k) => [k.alias, k.budgetUsd, k.tone]),
    [
      ['agni-crew-jev', 5, ''],
      ['agni-crew-claude', 100, '']
    ]
  )
  const jev = g.keys[0]
  assert.ok(Math.abs(jev.pct! - (0.002020326 / 5) * 100) < 1e-9)
  assert.equal(new Date(jev.expiresAt!).toISOString().slice(0, 10), '2026-12-24')
})

test('key tones: amber at 80% or 7 days, red at 100% or 1 day', () => {
  const now = RECORDED_AT
  const cases: [number | null, number | null, string][] = [
    [0, 30, ''],
    [79.9, 8, ''],
    [80, 30, 'warn'],
    [99.9, 30, 'warn'],
    [100, 30, 'bad'],
    [140, 30, 'bad'],
    [10, 7, 'warn'],
    [10, 1.5, 'warn'],
    [10, 1, 'bad'],
    [10, -2, 'bad'],
    [null, null, ''],
    [null, 3, 'warn']
  ]
  for (const [pct, days, tone] of cases) assert.equal(keyTone(pct, days === null ? null : now + days * DAY, now), tone, `${pct}% ${days}d`)
  // A key without a budget shows spend but no share of it.
  const g = parseGatewayReport(JSON.stringify({ schema: 'pitwall.gateway/1', keys: [{ alias: 'a', spend: 3, max_budget: null, expires: null }], missing: ['agni-crew-claude'] }), now)
  assert.equal(g.keys[0].pct, null)
  assert.equal(g.keys[0].tone, '')
  assert.deepEqual(g.missing, ['agni-crew-claude'])
})

// ---- Several state roots -------------------------------------------------------------------

test('every state root: tasks keep their root, and only the default root is read against crew status', () => {
  const r = parseCrewReport(rootsLine())
  assert.deepEqual(r.sources.map((s) => [s.root, s.primary]), [
    ['agni-crew-79-qual', false],
    ['agni-crew-fallback-qual', false],
    ['agni-crew-graph', false],
    ['agni-crew-three-seat', true]
  ])
  const qual = r.tasks.find((t) => t.id === '1124-2200-c1ac')!
  assert.equal(qual.root, 'agni-crew-79-qual')
  assert.equal(qual.primary, false)
  assert.equal(qual.key, 'agni-crew-79-qual/1124-2200-c1ac')
  assert.equal(qual.status, 'merge_ready', 'as recorded: crew status has no row for this root')
  assert.ok(qual.stages.length > 0 && qual.stages.every((s) => s.at > 0))
  // A default-root task the list calls legacy keeps the list's word.
  assert.equal(r.tasks.find((t) => t.id === '1124-0856-a58b')!.status, 'legacy')
})

test('the same id in two roots stays two tasks; a repeated root/id is dropped', () => {
  const d = rootsReport()
  const t = d.tasks.find((x: any) => x.id === '1124-2056-0510')
  d.tasks.push({ ...t, root: 'agni-crew-graph' }, { ...t })
  const r = parseCrewReport(JSON.stringify(d))
  assert.deepEqual(r.tasks.filter((x) => x.id === '1124-2056-0510').map((x) => x.root).sort(), ['agni-crew-graph', 'agni-crew-three-seat'])
  // The graph copy has no events of its own: stages never cross roots.
  assert.equal(r.tasks.find((x) => x.key === 'agni-crew-graph/1124-2056-0510')!.stages.length, 0)
})

test('durations: receipts for the plan, the ownership stop and cavalry eligibility', () => {
  const t = parseCrewReport(rootsLine()).tasks.find((x) => x.id === '1124-2056-0510')!
  assert.deepEqual(t.assignments, { leader: ['parse.py'], helper: ['fmt.py'], reviewer: [] })
  assert.equal(t.decision, 'helper_assignment_rejected')
  assert.equal(t.cavalryEligible, true, 'crew status names crew cavalry for it')
  const plan = t.stages.find((s) => s.stage === 'plan')!
  assert.deepEqual([plan.mode, plan.gate, plan.decision, plan.refereeCalls], ['helper', 'jev', 'safe_helper', 2])
  assert.equal(t.stages.find((s) => s.stage === 'build')!.reason, 'helper_outside_assignment')
  assert.equal(t.detail, 'The ownership check stopped the build: the second author edited files outside its assignment.')
  assert.ok(!t.stages.some((s) => s.stage === 'grade' || s.stage === 'review'))
})

test('the three ownership-gate stops, and who crossed which assignment', () => {
  const r = parseCrewReport(rootsLine())
  const why = (id: string) => r.tasks.find((t) => t.id === id)!.stages.find((s) => s.stage === 'build' && s.reason)!.reason
  assert.equal(why('1124-1141-97aa'), 'helper_outside_assignment')
  assert.equal(why('1124-1153-5cb2'), 'leader_edited_helper_file')
  assert.equal(why('1124-2056-0510'), 'helper_outside_assignment')
})

test('a seat lease with no matching task is reported, never read as no activity', () => {
  const d = rootsReport()
  d.lock = { deployed: true, seats: [{ seat: 'helper', holder: 'issue42/ux-eval', priority: 'benchmark' }, { seat: 'leader', holder: 'crew/1124-2200-c1ac', priority: 'crew' }] }
  const r = parseCrewReport(JSON.stringify(d))
  assert.deepEqual(r.orphanLeases, [{ seat: 'helper', holder: 'issue42/ux-eval', priority: 'benchmark' }])
})

test('a report from a crew host before multi-root reads: every task is in the default root', () => {
  const r = parseCrewReport(agnxLine())
  assert.deepEqual(r.sources, [])
  assert.ok(r.tasks.every((t) => t.primary && t.root === 'agni-crew-three-seat'))
})
