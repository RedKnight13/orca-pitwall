import { assert, test } from 'orca/testing'
import { ROOTS_AT, rootsLine, rootsReport } from '../../test/crew'
import { EMPTY_SNAPSHOT, type CrewDevView, type CrewView } from '../shared/types'
import { crewLive } from '../worker/crew/live'
import { parseCrewReport } from '../worker/crew/parse'
import { headline, story, workOf } from './crewStory'
import { INITIAL_UI, renderCrew } from './render'

const now = ROOTS_AT

function view(line = rootsLine(), patch: Partial<CrewView> = {}): CrewView {
  const r = parseCrewReport(line)
  return { host: 'agnx', at: now - 4000, reachable: true, error: null, ...r, gateway: { at: now, reachable: true, error: null, keys: [], missing: [] }, live: crewLive(r.tasks, r.lines, now), dev: null, ...patch }
}
const durations = (c: CrewView) => c.tasks.find((t) => t.id === '1124-2056-0510')!
const role = (c: CrewView, id: string) => story(c, durations(c), durations(c).stages, true, false).roles.find((r) => r.id === id)!

test('durations: the task in words, and how it ended', () => {
  const c = view()
  const s = story(c, durations(c), durations(c).stages, true, false)
  assert.equal(s.headline, 'Make the durations package correct.')
  assert.equal(s.outcome, 'Stopped before testing: Gemma edited files outside its assignment.')
  assert.equal(s.tone, 'bad')
})

test('durations: Qwen assigned parsing, Gemma formatting; assignment is not execution', () => {
  const c = view()
  const q = role(c, 'leader')
  assert.equal(q.says, 'Planned a split with Gemma, then was assigned duration parsing. Its part was never graded.')
  assert.equal(q.word, 'assigned')
  const g = role(c, 'helper')
  assert.equal(g.word, 'crossed scope')
  assert.equal(g.says, 'Assigned duration formatting, but edited files outside that assignment. Its work was not graded.')
  // File names are details, not narration.
  for (const r of [q, g]) assert.ok(!/\.py\b/.test(r.says) && !/\.py\b/.test(r.word))
  assert.deepEqual([q.files, g.files], [['parse.py'], ['fmt.py']])
})

test("durations: the runner's ownership check, not a Jev verdict; no cause the receipts do not give", () => {
  const c = view()
  const r = role(c, 'runner')
  assert.equal(r.word, 'rejected handoff')
  assert.ok(r.says.includes('Gemma edited files outside its assignment') && r.says.includes('not a Jev verdict'))
  const all = JSON.stringify(story(c, durations(c), durations(c).stages, true, false))
  assert.ok(!/scratch/i.test(all), 'no scratch-file cause without a receipt')
})

test('durations: tests and Inkling review did not start', () => {
  const c = view()
  assert.deepEqual([role(c, 'tests').word, role(c, 'tests').says], ['did not start', 'Tests did not start.'])
  assert.deepEqual([role(c, 'reviewer').word, role(c, 'reviewer').says], ['did not start', 'Review did not start.'])
})

test('reserve roles: what each can do, and whether this task called it', () => {
  const c = view()
  const jev = role(c, 'referee')
  assert.equal(jev.word, 'called ×2')
  assert.equal(jev.says, 'Called 2 times while planning; judged the split safe.')
  const venice = role(c, 'escalation')
  assert.deepEqual([venice.word, venice.says], ['not called', 'Can advise when the crew is stuck. Not called on this task.'])
  const codex = role(c, 'cavalry')
  assert.equal(codex.word, 'available')
  assert.equal(codex.says, 'Not called yet. Crew status lists this task as eligible for its one call.')
  // A merge-ready task is not eligible: Codex says what it can do and that it was not called.
  const done = c.tasks.find((t) => t.id === '1124-2051-8e7f')!
  const cav = story(c, done, done.stages, true, false).roles.find((r) => r.id === 'cavalry')!
  assert.deepEqual([cav.word, cav.says], ['not called', 'Can be called once on an eligible waiting task. Not called on this task.'])
  // A waiting task crew status does not list as eligible says so, from the list, not a guess.
  const d = rootsReport()
  d.status.text = d.status.text.replace(/\(the cavalry could help: crew cavalry 1124-2056-0510\)/, 'reason: helper_assignment_rejected')
  const c2 = view(JSON.stringify(d))
  const cav2 = role(c2, 'cavalry')
  assert.deepEqual([cav2.word, cav2.says], ['not called', 'Can be called once on an eligible waiting task. Crew status does not list this one; not called.'])
})

test('reserve roles are absent when neither configured nor called', () => {
  const d = rootsReport()
  d.reserve_roles = []
  const c = view(JSON.stringify(d))
  const ids = story(c, durations(c), durations(c).stages, true, false).roles.map((r) => r.id)
  // Jev judged the plan (gate=jev), so it stays; Venice and Codex were neither configured nor called.
  assert.ok(ids.includes('referee') && !ids.includes('escalation') && !ids.includes('cavalry'))
})

test('the leader crossing into the helper\'s file, on a retry', () => {
  const c = view()
  const t = c.tasks.find((x) => x.id === '1124-1153-5cb2')!
  const q = story(c, t, t.stages, true, false).roles.find((r) => r.id === 'leader')!
  assert.equal(q.word, 'crossed scope')
  assert.ok(q.says.includes('Edited a file assigned to Gemma on attempt 2'), q.says)
})

test('a replay paused mid-way never claims what happened later', () => {
  const c = view()
  const t = durations(c)
  const s = story(c, t, t.stages.slice(0, 3), false, false)
  assert.ok(s.outcome.startsWith('Replay at plan'))
  assert.equal(s.roles.find((r) => r.id === 'tests')!.word, 'not yet')
  assert.equal(s.roles.find((r) => r.id === 'helper')!.word, 'assigned')
})

test('headline and work words', () => {
  assert.equal(headline('Fix the cache package. lru.LRU(capacity) must evict'), 'Fix the cache package.')
  assert.equal(headline(''), 'Task with no recorded prompt')
  assert.equal(workOf(['parse.py'], 'Make the durations package correct.'), 'duration parsing')
  assert.equal(workOf(['stock.py'], 'Fix the inventory package.'), 'stock rules')
  assert.equal(workOf(['zap.py'], 'x'), 'the zap module')
  assert.equal(workOf([], 'x'), null)
})

// ---- The console around the story ------------------------------------------------------------

const html = (c: CrewView, ui = INITIAL_UI) => renderCrew({ ...EMPTY_SNAPSHOT, at: now, crew: c }, ui, now)

test('the map captions are story words; files, ids and settings only in the details fold', () => {
  const ui = { ...INITIAL_UI, playback: { task: '1124-2056-0510', index: 99, playing: false } }
  const shut = html(view(), ui)
  assert.ok(shut.includes('class="role-detail">crossed scope</text>'))
  assert.ok(shut.includes('class="role-detail">called ×2</text>') && shut.includes('class="role-detail">available</text>'))
  assert.ok(!shut.includes('parse.py') && !shut.includes('referee_calls'))
  const open = html(view(), { ...ui, expanded: { 'crewstory:agni-crew-three-seat/1124-2056-0510': true } })
  assert.ok(open.includes('<code>parse.py</code>') && open.includes('<code>fmt.py</code>'))
  assert.ok(open.includes('plan ok 1m23s mode=helper gate=jev decision=safe_helper referee_calls=2'))
  assert.ok(/build stop 2m3[01]s reason=helper_outside_assignment/.test(open))
  assert.ok(open.includes('<code>helper_assignment_rejected</code>'))
})

test('a task from another state root is labelled as such and is the last run when newest', () => {
  const out = html(view())
  assert.ok(out.includes('<h1>No crew run in progress</h1>'))
  assert.ok(out.includes('Last run: Fix and extend the ledger package.') && out.includes('79-qual run root'))
  assert.ok(out.includes('Checked 4 run roots on agnx. Runs elsewhere are not seen.'), 'idle is scoped, never global')
  assert.ok(out.includes('<h2>Runs seen</h2>') && out.includes('Default crew'))
})

test('a held seat with no matching task is said, not read as idle', () => {
  const d = rootsReport()
  d.lock = { deployed: true, seats: [{ seat: 'helper', holder: 'issue42/ux-eval', priority: 'benchmark' }] }
  const out = html(view(JSON.stringify(d)))
  assert.ok(out.includes('<b>Seat in use:</b> the helper seat is held by <code>issue42/ux-eval</code> (benchmark). No task in this report matches'))
  assert.ok(out.includes('helper seat held by <code>issue42/ux-eval</code>, not a task in this report'))
})

test('the next step offers Codex only for an eligible task', () => {
  const out = html(view(), { ...INITIAL_UI, expanded: { 'crew:incidents': true } })
  assert.ok(out.includes('call Codex once to take it over: <code>crew cavalry 1124-2056-0510</code>'))
  assert.ok(!out.includes('The Codex cavalry could take it from here'))
})

test('Crew development: Orca sessions in Crew workspaces, apart from model seats', () => {
  const dev: CrewDevView = {
    at: now - 3000,
    ok: true,
    error: null,
    workspaces: 3,
    agents: [
      { key: 's:1', agentKind: 'codex', workspaceName: 'crew-issue-84-implementation', branch: 'crew-issue-84', title: 'Implement #84: seat-event schema', lastSeen: 'Running go test ./...', state: 'working', stateSince: now - 120_000 },
      { key: 's:2', agentKind: 'claude', workspaceName: 'crew-architect-review', branch: null, title: 'Layer 1 review of PR #91', lastSeen: null, state: 'done', stateSince: now - 600_000 }
    ]
  }
  const out = html(view(rootsLine(), { dev }))
  const sec = /<section class="cm-block cm-dev"[\s\S]*?<\/section>/.exec(out)![0]
  assert.ok(sec.includes('Crew development <span>in Orca</span>') && sec.includes('Separate from the model seats'))
  assert.ok(sec.includes('<b>Implement #84: seat-event schema</b><span class="dv-state">working</span>'))
  assert.ok(sec.includes('Last seen: Running go test ./...') && sec.includes('crew-issue-84-implementation'))
  assert.ok(sec.includes('<b>Layer 1 review of PR #91</b><span class="dv-state">idle</span>'))
  const failed = html(view(rootsLine(), { dev: { ...dev, ok: false, error: 'Orca did not list workspaces', at: null, agents: [] } }))
  assert.ok(failed.includes('Orca did not list workspaces; what runs there is unknown.'))
  const none = html(view(rootsLine(), { dev: { ...dev, agents: [] } }))
  assert.ok(none.includes('No agents in the 3 open Crew workspaces.'))
})

test('picking a run: each Needs-you card offers its story; the pick leads, labelled, with a way back', () => {
  const base = html(view(), { ...INITIAL_UI, expanded: { 'crew:incidents': true } })
  assert.ok(base.includes('data-action="crew-focus" data-key="agni-crew-three-seat/1124-2056-0510"'))
  assert.ok(base.includes('class="cm-inc-what" title="1124-2056-0510 in agni-crew-three-seat">Make the durations package correct.</span>'))
  const picked = html(view(rootsLine(), { focus: 'agni-crew-three-seat/1124-2056-0510' }))
  assert.ok(picked.includes('<span class="deck-mode">Picked run · recorded</span>'))
  assert.ok(picked.includes('data-action="crew-focus" data-key="">Back to the latest run</button>'))
  assert.ok(picked.indexOf('crew-deck') < picked.indexOf('cm-needs'), 'the picked story comes before the incident list')
  assert.ok(picked.indexOf('class="story') < picked.indexOf('class="command-map'), 'words before the map')
  assert.ok(picked.includes('Stopped before testing: Gemma edited files outside its assignment.'))
  // An unknown pick falls back to the latest run.
  assert.ok(html(view(rootsLine(), { focus: 'nowhere/x' })).includes('Last run · recorded'))
})
