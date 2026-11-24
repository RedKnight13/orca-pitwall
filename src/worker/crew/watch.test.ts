import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { agnxLine, gatewayLine } from '../../../test/crew'
import type { Snapshot } from '../../shared/types'
import * as main from '../index'
import { crewAttention, statusBarOf } from '../index'
import type { Runner } from './remote'
import { validHost } from './remote'
import { AGNX_PY } from './scripts'
import { CrewWatch } from './watch'

function fakeRunner(answers: Record<string, () => Promise<string>>): { run: Runner; calls: string[] } {
  const calls: string[] = []
  const run: Runner = async (host, script) => {
    calls.push(`${host}:${script === AGNX_PY ? 'crew' : 'gateway'}`)
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

test('worker: Crew development sessions come from Crew workspaces whatever is focused; a picked run sticks', async () => {
  const prev = main.crewDeps.runner
  main.crewDeps.runner = fakeRunner({ agnx: async () => agnxLine(), agni1: async () => gatewayLine() }).run
  try {
    const host = mockHost({
      capabilities: ['agent:read', 'workspace:read', 'storage:own', 'settings:own'],
      results: {
        // Focused on an unrelated workspace.
        'workspace.readContext': { workspaceId: 'w1', branch: 'main', displayName: 'auden', terminals: [] },
        'workspace.list': {
          workspaces: [
            { id: 'w1', kind: 'worktree', name: 'auden', projectId: 'github:x/auden', path: '/a', branch: 'main', hostId: 'local', status: { state: 'active', unread: false, terminalCount: 1, lastActivityAt: null } },
            { id: 'w9', kind: 'worktree', name: 'crew-issue-84-implementation', projectId: 'github:redknight13/agni-crew', path: '/c', branch: 'crew-issue-84', hostId: 'local', status: { state: 'working', unread: false, terminalCount: 1, lastActivityAt: null } }
          ],
          truncated: false
        },
        'agents.list': { agents: [{ terminalId: 't9', title: 'Codex', agent: 'codex', state: 'working', stateStartedAt: 5, sessionId: 's9', task: { title: 'Implement #84' } }] },
        'terminal.list': { terminals: [], truncated: false },
        'statusBar.update': {}
      }
    })
    const worker = await mountWorker(main, { host, hooks: ['agent.tool.before', 'agent.tool.after'], events: ['agent.status.changed', 'workspace.changed'] })
    await worker.request('pitwall.setCrew', { on: true })
    await flush()
    await flush()
    let s = (await worker.request('pitwall.snapshot')) as Snapshot
    assert.equal(s.scope, 'focused')
    assert.deepEqual(s.crew!.dev!.agents.map((a) => [a.title, a.workspaceName]), [['Implement #84', 'crew-issue-84-implementation']])
    assert.equal(s.crew!.dev!.workspaces, 1)
    s = (await worker.request('pitwall.crewFocus', { key: 'agni-crew-three-seat/1124-1020-3645' })) as Snapshot
    assert.equal(s.crew!.focus, 'agni-crew-three-seat/1124-1020-3645')
    s = (await worker.request('pitwall.crewFocus', { key: '../../etc' })) as Snapshot
    assert.equal(s.crew!.focus, null, 'only a root/id key is kept')
    s = (await worker.request('pitwall.setCrew', { on: false })) as Snapshot
    assert.equal(s.crew, null)
    await worker.deactivate()
  } finally {
    main.crewDeps.runner = prev
  }
})
