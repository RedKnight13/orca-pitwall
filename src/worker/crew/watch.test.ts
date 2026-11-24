import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { agnxLine, gatewayLine, LIVE_AT, liveReport, nvidiaSmiSample, rocmSmiSample } from '../../../test/crew'
import type { Snapshot } from '../../shared/types'
import * as main from '../index'
import { crewAttention, statusBarOf } from '../index'
import type { Runner } from './remote'
import { validHost } from './remote'
import { CrewWatch, GPU_POLL_MS, mergeEvents, openRefs, VISIBLE_LEASE_MS } from './watch'

function fakeRunner(answers: Record<string, () => Promise<string>>): { run: Runner; calls: string[] } {
  const calls: string[] = []
  const run: Runner = async (host, script) => {
    calls.push(`${host}:${script.includes('pitwall.crew/1') ? 'crew' : script.includes('pitwall.gpu/1') ? 'gpu' : 'gateway'}`)
    const a = answers[host]
    if (!a) throw new Error('unreachable')
    return a()
  }
  return { run, calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

test('off by default: no reads and no section', async () => {
  const f = fakeRunner({})
  const w = new CrewWatch(f.run, () => {}, () => {})
  assert.equal(w.view(Date.now()), null)
  await w.pollCrew()
  await w.pollGateway()
  assert.deepEqual(f.calls, [])
})

test('on: reads agnx and agni1, then off stops and forgets', async () => {
  const f = fakeRunner({ agnx: async () => 'MOTD line\n' + agnxLine() + '\n', agni1: async () => gatewayLine() })
  let changes = 0
  const w = new CrewWatch(f.run, () => changes++, () => {})
  w.configure(true, 'agnx', 'agni1')
  await flush()
  await flush()
  const v = w.view(Date.parse('2026-11-24T17:00:00Z'))!
  assert.ok(f.calls.includes('agnx:crew') && f.calls.includes('agni1:gateway'))
  assert.equal(v.reachable, true)
  assert.equal(v.tasks.length, 9)
  assert.equal(v.gateway.keys.length, 2)
  assert.ok(changes >= 2)
  w.configure(false, 'agnx', 'agni1')
  assert.equal(w.view(Date.now()), null)
  w.stop()
})

test('unreachable hosts read as unreachable, with no stale tasks and one log line', async () => {
  let up = true
  const f = fakeRunner({ agnx: async () => (up ? agnxLine() : Promise.reject(new Error('unreachable'))), agni1: async () => Promise.reject(new Error('timeout')) })
  const logs: string[] = []
  const w = new CrewWatch(f.run, () => {}, (m) => logs.push(m))
  w.configure(true, 'agnx', 'agni1')
  await flush()
  await flush()
  assert.equal(w.view(Date.now())!.reachable, true)
  up = false
  await w.pollCrew()
  await w.pollCrew()
  const v = w.view(Date.now())!
  assert.equal(v.reachable, false)
  assert.equal(v.error, 'unreachable')
  assert.equal(v.tasks.length, 0)
  assert.ok(v.at !== null, 'remembers when it last answered')
  assert.equal(v.gateway.reachable, false)
  assert.equal(v.gateway.error, 'timeout')
  assert.equal(logs.filter((l) => l.startsWith('crew')).length, 1)
  w.stop()
})

test('output that is not the script\'s reads as bad output', async () => {
  const f = fakeRunner({ agnx: async () => 'not json', agni1: async () => '{"schema":"pitwall.gateway/1","error":"http_401"}' })
  const w = new CrewWatch(f.run, () => {}, () => {})
  w.configure(true, 'agnx', 'agni1')
  await flush()
  await flush()
  const v = w.view(Date.now())!
  assert.equal(v.error, 'bad output')
  assert.equal(v.gateway.error, 'http_401')
  w.stop()
})

test('host names that ssh could read as options are refused', () => {
  const cases: [string, boolean][] = [
    ['agnx', true],
    ['agni1', true],
    ['agni1.tailce14cd.ts.net', true],
    ['-oProxyCommand=touch /tmp/x', false],
    ['agnx; rm -rf ~', false],
    ['', false],
    ['a b', false]
  ]
  for (const [h, ok] of cases) assert.equal(validHost(h), ok, h)
})

test('worker: the Crew section is off until turned on, then fills from the crew hosts', async () => {
  const prev = main.crewDeps.runner
  main.crewDeps.runner = fakeRunner({ agnx: async () => agnxLine(), agni1: async () => gatewayLine() }).run
  try {
    const host = mockHost({
      capabilities: ['agent:read', 'workspace:read', 'storage:own', 'settings:own'],
      results: { 'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'app', terminals: [] }, 'agents.list': { agents: [] }, 'statusBar.update': {} }
    })
    const worker = await mountWorker(main, { host, hooks: ['agent.tool.before', 'agent.tool.after'], events: ['agent.status.changed', 'workspace.changed'] })
    let s = (await worker.request('pitwall.snapshot')) as Snapshot
    assert.equal(s.crew, null)
    s = (await worker.request('pitwall.setCrew', { on: true })) as Snapshot
    assert.ok(s.crew)
    await flush()
    await flush()
    s = (await worker.request('pitwall.snapshot')) as Snapshot
    assert.equal(s.crew!.tasks.length, 9)
    assert.equal(crewAttention(s), 6)
    const bar = statusBarOf(s, true)
    assert.ok(bar.text.includes('crew 6 for you'), bar.text)
    assert.equal(bar.tone, 'warning')
    s = (await worker.request('pitwall.setCrew', { on: false })) as Snapshot
    assert.equal(s.crew, null)
    await worker.deactivate()
  } finally {
    main.crewDeps.runner = prev
  }
})

const MODELS = { primary: { leader: 'agni-qwen27', helper: 'gemma-rx', reviewer: 'inkling' }, fallback: { leader: 'agni-qwen27', reviewer: 'gemma-rx' } }
/** The running-task fixture as agnx answers it, with the crew config's seat models and a cursor. */
const liveAnswer = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...liveReport(), models: MODELS, mode: 'full', cursor: { files: { '.local/state/agni-crew-three-seat/events.jsonl': [7, 1000] } }, ...extra })
const gpuAnswer = (nvidia: string | null, rocm: string | null) => async () => JSON.stringify({ schema: 'pitwall.gpu/1', nvidia, rocm })

test('agnx: the first poll reads in full, later ones send the cursor and merge what was appended', async () => {
  const scripts: string[] = []
  let answer = liveAnswer()
  const run: Runner = async (host, script) => {
    if (host !== 'agnx') throw new Error('unreachable')
    scripts.push(script)
    return answer
  }
  const w = new CrewWatch(run, () => {}, () => {})
  w.configure(true, 'agnx', 'agni1')
  await flush()
  assert.ok(!scripts[0].startsWith('CURSOR_JSON'), 'no cursor on the first read')
  const before = w.view(LIVE_AT)!.tasks.find((t) => t.id === '1125-1012-ab12')!.stages.length
  answer = liveAnswer({ mode: 'delta', events: [{ ts: '2026-11-25T10:15:00+00:00', task: '1125-1012-ab12', stage: 'build', attempt: 1, outcome: 'committed', seconds: 78 }] })
  await w.pollCrew()
  assert.match(scripts[1], /^CURSOR_JSON = "\{\\"files\\":\{\\".local\/state\/agni-crew-three-seat\/events.jsonl\\":\[7,1000\]\},\\"open\\":\[/)
  const after = w.view(LIVE_AT)!.tasks.find((t) => t.id === '1125-1012-ab12')!.stages
  assert.equal(after.length, before + 1, 'kept the earlier lines and added the new one')
  // The seat lines are still there: the mascots keep drawing from them.
  assert.equal(w.view(LIVE_AT)!.live[0].source, 'seats')
  // A full answer replaces everything.
  answer = liveAnswer({ mode: 'full', events: [] })
  await w.pollCrew()
  assert.equal(w.view(LIVE_AT)!.tasks.find((t) => t.id === '1125-1012-ab12')!.stages.length, 0)
  w.stop()
})

test('mergeEvents and openRefs: bounded per listed task; a start with no stop is open; sizes update by ref', () => {
  const a = { task: 't1', stage: 'plan', ts: 'x' }
  const gone = { task: 'old', stage: 'plan', ts: 'x' }
  const start = { schema: 'agni.crew.seat_event/1', seat_event: 'start', task: 't1', seat: 'leader', slot: '', stage: 'build', attempt: 1, ref: 'log:10', output_bytes: 5 }
  const merged = mergeEvents([a, gone], { mode: 'delta', events: [start], sizes: { 'log:10': 900 } }, new Set(['t1']))
  assert.deepEqual(merged.map((e) => e.stage), ['plan', 'build'])
  assert.equal(merged[1].output_bytes, 900)
  assert.deepEqual(openRefs(merged, new Set(['t1'])), ['log:10'])
  assert.deepEqual(openRefs([...merged, { ...start, seat_event: 'stop', ref: undefined }], new Set(['t1'])), [])
  assert.deepEqual(openRefs(merged, new Set()), [], 'only running tasks')
})

test('card reads: only while the section is shown and a task runs, at most every 20 s, from the hosts the config names', async () => {
  const f = fakeRunner({ agnx: async () => liveAnswer(), agni1: gpuAnswer(null, rocmSmiSample()), agni2: gpuAnswer(nvidiaSmiSample(), null) })
  const w = new CrewWatch(f.run, () => {}, () => {})
  w.configure(true, 'agnx', 'gw')
  await flush()
  await flush()
  assert.ok(!f.calls.some((c) => c.endsWith(':gpu')), 'not shown yet: no card reads')
  assert.deepEqual(w.gpuHosts(), ['agni1', 'agni2'])
  const t0 = Date.now()
  w.setVisible(true, t0)
  await flush()
  await flush()
  assert.deepEqual(f.calls.filter((c) => c.endsWith(':gpu')).sort(), ['agni1:gpu', 'agni2:gpu'])
  const m = Object.fromEntries(w.view(Date.now())!.live[0].mascots.map((x) => [x.id, x]))
  assert.deepEqual([m.qwen.card, m.qwen.tempC], ['R9700', 39])
  assert.deepEqual([m.gemma.card, m.gemma.tempC], ['RX 9070 XT', 29])
  assert.deepEqual([m.inkling.card, m.inkling.tempC], ['RTX 5060', 30.76])
  // Too soon: no second read.
  await w.pollGpu(t0 + 5000)
  assert.equal(f.calls.filter((c) => c.endsWith(':gpu')).length, 2)
  // The lease runs out when the panel stops saying it looks.
  assert.equal(w.visible(t0 + VISIBLE_LEASE_MS + 1), false)
  await w.pollGpu(t0 + VISIBLE_LEASE_MS + 1)
  assert.equal(f.calls.filter((c) => c.endsWith(':gpu')).length, 2)
  // Hidden: no reads even when due.
  w.setVisible(false, t0 + GPU_POLL_MS)
  await w.pollGpu(t0 + GPU_POLL_MS)
  assert.equal(f.calls.filter((c) => c.endsWith(':gpu')).length, 2)
  w.stop()
})

test('card reads: nothing runs, nothing read', async () => {
  const idle = liveReport()
  idle.tasks = idle.tasks.filter((t: any) => t.status !== 'running')
  idle.status.text = ''
  const f = fakeRunner({ agnx: async () => JSON.stringify({ ...idle, models: MODELS }), agni1: gpuAnswer(null, rocmSmiSample()) })
  const w = new CrewWatch(f.run, () => {}, () => {})
  w.configure(true, 'agnx', 'gw')
  await flush()
  w.setVisible(true)
  await flush()
  assert.ok(!f.calls.some((c) => c.endsWith(':gpu')))
  w.stop()
})

test('off host: agni2 does not answer, so the reviewer keeps its card name and shows no figures', async () => {
  const f = fakeRunner({ agnx: async () => liveAnswer(), agni1: gpuAnswer(null, rocmSmiSample()) })
  const logs: string[] = []
  const w = new CrewWatch(f.run, () => {}, (l) => logs.push(l))
  w.configure(true, 'agnx', 'gw')
  await flush()
  w.setVisible(true)
  await flush()
  await flush()
  const m = Object.fromEntries(w.view(Date.now())!.live[0].mascots.map((x) => [x.id, x]))
  assert.equal(m.qwen.tempC, 39)
  assert.deepEqual([m.inkling.card, m.inkling.tempC, m.inkling.vramGb], ['RTX 5060', null, null])
  assert.ok(logs.some((l) => l.startsWith('gpu read from agni2 failed: unreachable')))
  // A missing tool reads the same way: the host answers with no cards.
  const g = fakeRunner({ agnx: async () => liveAnswer(), agni1: gpuAnswer(null, null), agni2: gpuAnswer(null, null) })
  const w2 = new CrewWatch(g.run, () => {}, () => {})
  w2.configure(true, 'agnx', 'gw')
  await flush()
  w2.setVisible(true)
  await flush()
  await flush()
  assert.ok(w2.view(Date.now())!.live[0].mascots.every((x) => x.tempC === null && x.vramGb === null))
  w.stop()
  w2.stop()
})
