import { assert, test } from 'orca/testing'
import type { LogEntry } from '../shared/types'
import { Gate } from './gate'

test('a hook call runs, then finishes ok or failed', () => {
  const g = new Gate()
  g.before('a', { callId: 'c1', tool: 'Read', input: { file_path: '/x/y/z.ts' } }, 1)
  assert.equal(g.get('c1')!.state, 'running')
  g.after('a', { callId: 'c1', tool: 'Read', output: { ok: true } }, 2)
  assert.equal(g.get('c1')!.state, 'ok')
  g.before('a', { callId: 'c2', tool: 'Bash', input: {} }, 3)
  g.after('a', { callId: 'c2', tool: 'Bash' }, 4)
  assert.equal(g.get('c2')!.state, 'error')
})

test('a blocked agent turns its newest open call into a permission ask, then back', () => {
  const logs: LogEntry[] = []
  const g = new Gate((e) => logs.push(e))
  g.before('a', { callId: 'c1', tool: 'Read' }, 1)
  g.before('a', { callId: 'c2', tool: 'Bash', input: { command: 'make deploy' } }, 2)
  g.before('b', { callId: 'c3', tool: 'Bash' }, 3)
  g.blocked('a', 4)
  assert.equal(g.get('c2')!.state, 'asking')
  assert.equal(g.get('c1')!.state, 'running')
  assert.equal(g.get('c3')!.state, 'running')
  assert.equal(logs[0].kind, 'asking')
  assert.equal(logs[0].text, 'asks to run Bash: make deploy')
  g.unblocked('a')
  assert.equal(g.get('c2')!.state, 'running')
})

test('the transcript decides denials and adds calls the hooks missed', () => {
  const g = new Gate()
  g.before('a', { callId: 'c1', tool: 'Bash' }, 1)
  g.after('a', { callId: 'c1', tool: 'Bash' }, 2)
  g.transcriptResult('c1', { isError: true, denied: true, at: 2 })
  assert.equal(g.get('c1')!.state, 'denied')
  g.transcriptUse('a', { id: 'old', name: 'Grep', summary: 'x', at: 0 }, true)
  assert.equal(g.get('old')!.state, 'running')
  assert.equal(g.get('old')!.sub, true)
  g.transcriptResult('old', { isError: false, denied: false, at: 1 })
  assert.equal(g.get('old')!.state, 'ok')
  assert.deepEqual(g.list().map((e) => e.id), ['old', 'c1'])
})

test('without a call id, after() closes the newest open call of that tool', () => {
  const g = new Gate()
  const a = g.before('a', { tool: 'Bash' }, 1)
  const b = g.before('a', { tool: 'Read' }, 2)
  g.after('a', { tool: 'Bash', output: 1 }, 3)
  assert.equal(g.get(a.id)!.state, 'ok')
  assert.equal(g.get(b.id)!.state, 'running')
})

test('settle closes calls a finished turn left open; forget and the size cap drop entries', () => {
  const g = new Gate()
  g.before('a', { callId: 'c1', tool: 'Bash' }, 0)
  g.settle('a', 5000)
  assert.equal(g.get('c1')!.state, 'ok')
  for (let i = 0; i < 450; i++) g.before('b', { callId: `x${i}`, tool: 'Read' }, 10 + i)
  assert.equal(g.size, 400)
  assert.equal(g.get('c1'), undefined)
  // Old history inserted last is what goes, not the newest live calls.
  for (let i = 0; i < 60; i++) g.transcriptUse('c', { id: `h${i}`, name: 'Read', summary: '', at: -1000 + i }, false)
  assert.equal(g.get('x449')!.state, 'running')
  assert.ok(g.size <= 450)
  g.forget('b')
  g.forget('c')
  assert.equal(g.size, 0)
})

test('a call filed under a terminal moves to the session the transcript names', () => {
  const g = new Gate()
  g.before('t:term', { callId: 'toolu_1', tool: 'Read' }, 1)
  g.transcriptUse('s:abc', { id: 'toolu_1', name: 'Read', summary: 'a.ts', at: 1 }, false)
  assert.equal(g.get('toolu_1')!.agentKey, 's:abc')
  g.before('t:term', { callId: 'toolu_2', tool: 'Read' }, 2)
  g.rekey('t:term', 's:abc')
  assert.equal(g.get('toolu_2')!.agentKey, 's:abc')
})
