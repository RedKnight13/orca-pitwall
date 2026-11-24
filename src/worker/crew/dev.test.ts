import { assert, test } from 'orca/testing'
import { isCrewWorkspace, readCrewDev, type DevCall } from './dev'

const ws = (id: string, name: string, projectId: string | null, terminals = 1) => ({ id, name, projectId, branch: name, status: { terminalCount: terminals } })

test('Crew workspaces: the agni-crew project, or crew- work in another project; nothing else', () => {
  assert.ok(isCrewWorkspace(ws('a', 'crew-issue-84-implementation', 'github:redknight13/agni-crew')))
  assert.ok(isCrewWorkspace(ws('b', 'main', 'github:redknight13/agni-crew')))
  assert.ok(isCrewWorkspace(ws('c', 'crew-architect-review', 'github:redknight13/agni-infra')))
  assert.ok(!isCrewWorkspace(ws('d', 'pitwall-agni-crew', 'github:sonthh/orca-pitwall')))
  assert.ok(!isCrewWorkspace(ws('e', 'auden-film', 'github:x/auden')))
  assert.ok(!isCrewWorkspace(ws('f', 'main', 'github:x/agni-crew-fork')))
})

function host(failing = new Set<string>()): DevCall {
  return (async (name: string, params: any) => {
    if (name === 'workspace.list')
      return { workspaces: [ws('w1', 'crew-issue-84-implementation', 'github:redknight13/agni-crew'), ws('w2', 'crew-w11', 'github:redknight13/agni-crew'), ws('w3', 'auden', 'github:x/auden'), ws('w4', 'crew-idle', 'github:redknight13/agni-crew', 0)] }
    if (name === 'agents.list') {
      if (failing.has(params.workspaceId)) throw new Error('no')
      if (params.workspaceId === 'w1') return { agents: [{ terminalId: 't1', title: '✳ Claude Code', agent: 'codex', state: 'working', stateStartedAt: 5, sessionId: 's1', task: { title: 'Implement #84' } }] }
      if (params.workspaceId === 'w3') throw new Error('unrelated workspaces are never asked')
      return { agents: [] }
    }
    if (name === 'terminal.list') return { terminals: [{ id: 't1', title: '⠋ Running go test ./...' }] }
    throw new Error(name)
  }) as DevCall
}

test('reads only Crew workspaces with open terminals, whatever is focused', async () => {
  const d = await readCrewDev(host(), 100)
  assert.equal(d.workspaces, 2)
  assert.ok(d.ok)
  assert.deepEqual(d.agents.map((a) => [a.title, a.lastSeen, a.workspaceName, a.state]), [['Implement #84', 'Running go test ./...', 'crew-issue-84-implementation', 'working']])
})

test('a Crew workspace that does not answer is named as a gap', async () => {
  const d = await readCrewDev(host(new Set(['w2'])), 100)
  assert.equal(d.ok, false)
  assert.equal(d.error, '1 Crew workspace did not answer')
  assert.equal(d.agents.length, 1)
})
