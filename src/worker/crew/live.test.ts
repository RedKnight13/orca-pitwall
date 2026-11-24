import { assert, test } from 'orca/testing'
import { liveLine, liveReport, LIVE_AT } from '../../../test/crew'
import type { CrewMascotView } from '../../shared/types'
import { crewLive, FINALE_MS, parseLiveLine, safeBubble, SEAT_SCHEMA } from './live'
import { parseCrewReport } from './parse'

const byId = (ms: CrewMascotView[]) => Object.fromEntries(ms.map((m) => [m.id, m]))

/** The recorded merge-ready task, replayed as if still running at `stage`, with the lines before it. */
function replay(stage: string, upTo: string[]) {
  const d = liveReport()
  const id = '1124-2051-8e7f'
  d.tasks = d.tasks.filter((t: any) => t.id === id).map((t: any) => ({ ...t, status: 'running', stage }))
  d.status.text = `${id}  running      stage=${stage}   attempts=1  /w/x  Fix it\n`
  d.events = d.events.filter((e: any) => e.task === id && upTo.includes(e.stage))
  const r = parseCrewReport(JSON.stringify(d))
  return crewLive(r.tasks, r.lines, LIVE_AT)!
}

test('stage lines: each running stage lights its mascot with its action word', () => {
  const cases: [string, string[], string, string][] = [
    ['intake', ['admit'], 'qwen', 'reading'],
    ['plan', ['admit', 'intake'], 'qwen', 'planning'],
    ['build', ['admit', 'intake', 'plan'], 'qwen', 'writing'],
    ['grade', ['admit', 'intake', 'plan', 'build'], 'tests', 'testing'],
    ['review', ['admit', 'intake', 'plan', 'build', 'grade'], 'inkling', 'reviewing'],
    ['decide', ['admit', 'intake', 'plan', 'build', 'grade', 'review'], 'jev', 'thinking'],
    ['advise', ['admit', 'intake', 'plan', 'build', 'grade', 'review', 'decide'], 'venice', 'thinking'],
    ['cavalry', ['admit', 'intake', 'plan', 'build', 'grade', 'review', 'decide'], 'codex', 'writing']
  ]
  for (const [stage, before, who, action] of cases) {
    const l = replay(stage, before)
    assert.equal(l.source, 'stages', stage)
    const active = l.mascots.filter((m) => m.state === 'active')
    assert.deepEqual(active.map((m) => [m.id, m.action]), [[who, action]], stage)
    // It started when the stage before it ended.
    assert.ok(active[0].since !== null && active[0].since > 0, stage)
  }
})

test('stage lines: a solo plan leaves Gemma asleep; done, waiting and the hand-off follow the pipeline', () => {
  const l = replay('review', ['admit', 'intake', 'plan', 'build', 'grade'])
  const m = byId(l.mascots)
  assert.deepEqual(l.mascots.map((x) => x.id), ['qwen', 'gemma', 'tests', 'inkling', 'jev'])
  assert.equal(m.gemma.state, 'idle')
  assert.equal(m.gemma.bubble, 'sitting this one out')
  assert.equal(m.qwen.state, 'done')
  assert.equal(m.qwen.bubble, 'committed attempt 1')
  assert.equal(m.tests.state, 'done')
  assert.equal(m.tests.bubble, 'tests pass')
  assert.equal(m.inkling.state, 'active')
  assert.equal(m.jev.state, 'waiting')
  assert.deepEqual(l.handoff && [l.handoff.from, l.handoff.to], ['tests', 'inkling'])
  // No read-only source for card figures: they stay empty, never guessed.
  for (const x of l.mascots) assert.ok(x.tempC === null && x.vramGb === null && x.tokensPerSec === null)
})

test('seat lines (agni.crew.seat_event/1): open runs are active, with file names and the hand-off', () => {
  const r = parseCrewReport(liveLine())
  const l = crewLive(r.tasks, r.lines, LIVE_AT)!
  assert.equal(l.taskId, '1125-1012-ab12')
  assert.equal(l.source, 'seats')
  const m = byId(l.mascots)
  assert.equal(m.qwen.state, 'active')
  assert.equal(m.qwen.action, 'writing')
  assert.equal(m.qwen.since, Date.parse('2026-11-25T10:13:42Z'))
  assert.equal(m.qwen.bubble, 'writing · leader-build-1.out · 18 kB')
  assert.equal(m.gemma.state, 'active')
  assert.equal(m.gemma.bubble, 'writing · helper-author-1.out · 6 kB')
  assert.equal(m.tests.state, 'waiting')
  assert.equal(m.inkling.state, 'waiting')
  assert.deepEqual(l.handoff, { from: 'qwen', to: 'gemma', at: Date.parse('2026-11-25T10:13:43Z') })
  // Seat lines never reach the run sheet.
  const t = r.tasks.find((x) => x.id === '1125-1012-ab12')!
  assert.deepEqual(t.stages.map((s) => s.stage), ['intake', 'plan'])
})

test('seat lines: a stop closes the run; a failing exit or timeout marks the mascot failed', () => {
  const d = liveReport()
  const at = '2026-11-25T10:15:00+00:00'
  d.events.push({ schema: SEAT_SCHEMA, seat_event: 'stop', ts: at, task: '1125-1012-ab12', stage: 'author', attempt: 1, seat: 'helper', slot: 'helper_', output: 'helper-author-1.out', seconds: 77, exit: 124, timed_out: true })
  const r = parseCrewReport(JSON.stringify(d))
  const m = byId(crewLive(r.tasks, r.lines, LIVE_AT)!.mascots)
  assert.equal(m.qwen.state, 'active')
  assert.equal(m.gemma.state, 'failed')
  assert.equal(m.gemma.bubble, 'author timed out · helper-author-1.out')
})

test('version check: seat lines of any other schema are ignored, and the stage lines carry on', () => {
  const d = liveReport()
  d.events = d.events.map((e: any) => ('seat_event' in e ? { ...e, schema: 'agni.crew.seat_event/2' } : e))
  d.events.push({ seat_event: 'start', ts: '2026-11-25T10:14:00+00:00', task: '1125-1012-ab12', stage: 'review', attempt: 1, seat: 'reviewer' })
  const r = parseCrewReport(JSON.stringify(d))
  const l = crewLive(r.tasks, r.lines, LIVE_AT)!
  assert.equal(l.source, 'stages')
  // From the stage lines: build is running, and the split plan puts Gemma beside Qwen.
  assert.deepEqual(l.mascots.filter((m) => m.state === 'active').map((m) => m.id), ['qwen', 'gemma'])
  assert.equal(parseLiveLine({ schema: 'agni.crew.seat_event/2', seat_event: 'start', ts: '2026-11-25T10:00:00Z', task: 't', stage: 'build', seat: 'leader' }), null)
})

test('no code in bubbles: only fixed phrases, outcome words and file names get through', () => {
  const code = ['def f(): return 1', 'x = 1; rm -rf /', '<script>alert(1)</script>', 'const a = `${b}`', 'import os\nos.system("x")']
  const d = liveReport()
  const id = '1125-1012-ab12'
  d.events.push(
    { ts: '2026-11-25T10:14:30+00:00', task: id, stage: 'decide', attempt: 1, outcome: code[1], gate: code[0], decision: code[3], verdict: code[2], evidence: [...code, '../../etc/passwd', 'src/app/test-1.txt', 'C:\\w\\review-1.md'] },
    { schema: SEAT_SCHEMA, seat_event: 'start', ts: '2026-11-25T10:14:31+00:00', task: id, stage: 'review', attempt: 1, seat: 'reviewer', slot: '', output: code[4], seconds: 0 },
    { ts: '2026-11-25T10:14:32+00:00', task: id, stage: code[0], attempt: 1, outcome: 'ok' }
  )
  const r = parseCrewReport(JSON.stringify(d))
  const l = crewLive(r.tasks, r.lines, LIVE_AT)!
  const text = JSON.stringify(l.mascots.map((m) => m.bubble))
  for (const c of code) for (const bit of ['def ', 'rm -rf', '<script', 'alert', '${', 'os.system', 'return']) assert.ok(!text.includes(bit), `${bit} in ${text}`)
  assert.ok(!text.includes('passwd') && !text.includes('src/app') && !text.includes('C:'), text)
  // The file names survive as names.
  const decide = r.lines.get(id)!.find((x) => x.kind === 'stage' && x.stage === 'decide')
  assert.deepEqual(decide && decide.kind === 'stage' ? decide.evidence : null, ['test-1.txt', 'review-1.md'])
  // The last guard refuses anything that reads as code.
  assert.equal(safeBubble(['tests pass', 'def x()']), null)
  assert.equal(safeBubble(['a{b}']), null)
  assert.equal(safeBubble(['tests pass', 'test-1.txt']), 'tests pass · test-1.txt')
})

test('finale: 🎉 for a merge-ready task, 💥 for one that stopped, for ten minutes', () => {
  const r = parseCrewReport(liveLine())
  const tasks = r.tasks.filter((t) => t.status !== 'running')
  const ok = tasks.find((t) => t.id === '1124-2051-8e7f')!
  const end = Date.parse('2026-11-24T20:55:54Z')
  const l = crewLive([ok], r.lines, end + 30_000)!
  assert.deepEqual(l.finale, { kind: 'merge_ready', at: end })
  assert.equal(l.handoff, null)
  assert.ok(l.mascots.every((m) => m.state !== 'active'))
  assert.equal(byId(l.mascots).jev.bubble, 'merge-ready · test-1.txt, review-1.md')
  assert.equal(byId(l.mascots).tests.bubble, 'tests pass · test-1.txt')
  assert.equal(byId(l.mascots).inkling.bubble, 'PASS · read 3.7k tokens · review-1.md')
  assert.equal(crewLive([ok], r.lines, end + FINALE_MS + 1000), null)
  const stopped = tasks.find((t) => t.id === '1124-2056-0510')!
  const s = crewLive([stopped], r.lines, Date.parse('2026-11-24T21:02:00Z'))!
  assert.equal(s.finale?.kind, 'failed')
  const m = byId(s.mascots)
  assert.equal(m.qwen.state, 'failed')
  assert.equal(m.qwen.bubble, 'finished: waiting')
  assert.equal(m.gemma.state, 'failed', 'the split build stopped')
  // A running task wins over a finale.
  assert.equal(crewLive(r.tasks, r.lines, end + 30_000)!.taskId, '1125-1012-ab12')
})
