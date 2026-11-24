// Runs the two Crew scripts with the local python3 against fakes: a fake LiteLLM answer and a fake
// crew state folder. The point is what leaves the host: only the whitelisted fields, never a key.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { seatEventsJsonl } from '../../../test/crew'
import { crewLive } from './live'
import { parseCrewReport, parseGatewayReport } from './parse'
import { AGNX_PY, GATEWAY_PY } from './scripts'

const MASTER = 'sk-test-master-not-real-0000'
const VIRTUAL = 'sk-test-virtual-not-real-1111'

function python(): string | null {
  try {
    execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' })
    return 'python3'
  } catch {
    return null
  }
}

// Loads the script as a module (so main() does not run) and calls main with a fake urlopen.
const GATEWAY_DRIVER = `
import io, json, sys
g = {"__name__": "gateway"}
exec(sys.stdin.read(), g)
seen = []
class Resp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
def fake(req, timeout=None):
    seen.append(req.get_header("Authorization"))
    if sys.argv[2] == "401":
        import urllib.error
        raise urllib.error.HTTPError(req.full_url, 401, "Authentication Error, " + seen[-1], {}, None)
    keys = [
        {"key_alias": "agni-crew-jev", "spend": 4.1, "max_budget": 5.0, "expires": "2026-12-24T08:50:20.207000Z",
         "token": "hashed-token-value", "api_key": "${VIRTUAL}", "metadata": {"note": "${VIRTUAL}"}},
        {"key_alias": "someone-else", "spend": 1.0, "max_budget": 2.0, "expires": None, "token": "t2"},
    ]
    return Resp(json.dumps({"keys": keys, "total_pages": 1}).encode())
g["main"](urlopen=fake, env_path=sys.argv[1])
if sys.argv[2] != "none":
    assert seen and all(h == "Bearer ${MASTER}" for h in seen), seen
`

test('gateway script: only alias, spend, budget and expiry leave the host; never a key', () => {
  const py = python()
  if (!py) return
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-gw-'))
  try {
    const env = join(dir, 'gateway.env')
    writeFileSync(env, `TAILSCALE_IP=100.0.0.1\nLITELLM_MASTER_KEY="${MASTER}"\nLITELLM_SALT_KEY=salt-not-real\n`)
    const out = execFileSync(py, ['-I', '-c', GATEWAY_DRIVER, env, '200'], { input: GATEWAY_PY, encoding: 'utf8' })
    assert.ok(!out.includes(MASTER) && !out.includes(VIRTUAL) && !out.includes('hashed-token') && !out.includes('salt'), out)
    assert.equal(out.trim().split('\n').length, 1)
    const line = JSON.parse(out)
    assert.deepEqual(line.keys, [{ alias: 'agni-crew-jev', spend: 4.1, max_budget: 5, expires: '2026-12-24T08:50:20.207000Z' }])
    assert.deepEqual(line.missing, ['agni-crew-claude'])
    const g = parseGatewayReport(out, Date.parse('2026-11-24T12:00:00Z'))
    assert.equal(g.keys[0].tone, 'warn')

    // An HTTP error says only its status, even when the server echoes the header back.
    const err = execFileSync(py, ['-I', '-c', GATEWAY_DRIVER, env, '401'], { input: GATEWAY_PY, encoding: 'utf8' })
    assert.ok(!err.includes(MASTER), err)
    assert.deepEqual(JSON.parse(err), { schema: 'pitwall.gateway/1', error: 'http_401' })

    // No env file: a short reason, no traceback, no request.
    const none = execFileSync(py, ['-I', '-c', GATEWAY_DRIVER, join(dir, 'missing.env'), 'none'], { input: GATEWAY_PY, encoding: 'utf8' })
    assert.deepEqual(JSON.parse(none), { schema: 'pitwall.gateway/1', error: 'no_master_key' })
  } finally {
    rmSync(dir, { recursive: true })
  }
})

test('agnx script: reads a crew state folder and sends back whitelisted fields only', () => {
  const py = python()
  if (!py) return
  const home = mkdtempSync(join(tmpdir(), 'pitwall-agnx-'))
  try {
    const state = join(home, '.local/state/agni-crew-three-seat')
    const release = join(home, 'agni/crew/releases/main-test')
    mkdirSync(join(state, 'tasks'), { recursive: true })
    mkdirSync(join(home, '.local/state/agni-crew-graph'), { recursive: true })
    mkdirSync(join(home, 'agni/bin'), { recursive: true })
    mkdirSync(join(release, 'helpers'), { recursive: true })
    writeFileSync(join(home, 'agni/bin/crew'), '#!/bin/sh\nexec "$HOME/agni/crew/releases/main-test/crew" "$@"\n')
    writeFileSync(join(release, 'crew'), '#!/bin/sh\necho "1124-0001-aaaa  running      stage=build   attempts=1  /w/x  Fix it"\necho "seat leader  holder=crew/1124-0001-aaaa  priority=crew"\n')
    writeFileSync(join(release, 'helpers/agni-seat-lock'), 'import json\nprint(json.dumps({"schema": "agni.seat-status/1", "seats": [{"seat": "leader", "holder": "crew/1124-0001-aaaa", "priority": "crew", "lease_id": "LEASE-SECRET"}]}))\n')
    chmodSync(join(home, 'agni/bin/crew'), 0o755)
    chmodSync(join(release, 'crew'), 0o755)
    writeFileSync(
      join(state, 'tasks/1124-0001-aaaa.json'),
      JSON.stringify({
        id: '1124-0001-aaaa',
        status: 'running',
        stage: 'build',
        attempts: 1,
        prompt: 'Fix it',
        created: '2026-11-24T10:00:00+00:00',
        updated: '2026-11-24T10:05:00+00:00',
        test_command: ['python3', '-B', '/secret/path/verify.py'],
        reviewer: { endpoint_sha256: 'ENDPOINT-HASH' },
        conversation: 'CONVERSATION-TEXT',
        result: null
      })
    )
    writeFileSync(
      join(state, 'events.jsonl'),
      [
        JSON.stringify({ ts: '2026-11-24T10:01:00+00:00', task: '1124-0001-aaaa', stage: 'intake', attempt: 0, outcome: 'ok', seconds: 31.4, reviewer: { endpoint_sha256: 'ENDPOINT-HASH' } }),
        JSON.stringify({ ts: '2026-11-24T10:02:00+00:00', task: 'other-task', stage: 'intake', attempt: 0, outcome: 'ok', seconds: 9 }),
        'not json'
      ].join('\n') + '\n'
    )
    writeFileSync(join(home, '.local/state/agni-crew-graph/events.jsonl'), JSON.stringify({ ts: '2026-11-24T10:03:00+00:00', task: '1124-0001-aaaa', stage: 'plan', attempt: 0, outcome: 'ok', seconds: 12, test_receipt_sha256: 'RECEIPT' }) + '\n')
    const out = execFileSync(py, ['-I', '-'], { input: AGNX_PY, encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 30_000 })
    for (const leak of ['ENDPOINT-HASH', 'CONVERSATION-TEXT', '/secret/path', 'LEASE-SECRET', 'RECEIPT', 'other-task']) assert.ok(!out.includes(leak), leak)
    const r = parseCrewReport(out)
    assert.equal(r.tasks.length, 1)
    assert.equal(r.tasks[0].status, 'running')
    assert.deepEqual(
      r.tasks[0].stages.map((s) => [s.stage, s.seconds]),
      [
        ['intake', 31.4],
        ['plan', 12]
      ]
    )
    assert.equal(r.lockDeployed, true)
    // The seats' health depends on what listens on this machine's loopback; a down seat never shows a holder.
    assert.deepEqual(r.seats.map((s) => s.id), ['leader', 'helper', 'reviewer'])
    for (const s of r.seats) if (s.state === 'down') assert.equal(s.holder, null)
  } finally {
    rmSync(home, { recursive: true })
  }
})

test('agnx script: #42 seat lines and the mascot fields go out whitelisted; no paths, models, reasons or code', () => {
  const py = python()
  if (!py) return
  const home = mkdtempSync(join(tmpdir(), 'pitwall-seat-'))
  try {
    const state = join(home, '.local/state/agni-crew-three-seat')
    const wt = join(state, 'worktrees/crew-1125-1012-ab12')
    mkdirSync(join(state, 'tasks'), { recursive: true })
    mkdirSync(join(wt, '.crew/seats'), { recursive: true })
    writeFileSync(join(wt, '.crew/seats/leader-build-1.out'), 'SEAT-OUTPUT-CONTENTS '.repeat(100))
    writeFileSync(join(state, 'tasks/1125-1012-ab12.json'), JSON.stringify({ id: '1125-1012-ab12', status: 'running', stage: 'build', attempts: 1, prompt: 'Fix it', created: '2026-11-25T10:12:00+00:00', updated: '2026-11-25T10:15:10+00:00' }))
    const raw = seatEventsJsonl()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .map((e) => (e.worktree ? { ...e, worktree: wt } : e))
    raw.push(
      { ts: '2026-11-25T10:14:00+00:00', task: '1125-1012-ab12', stage: 'decide', attempt: 1, outcome: 'retry', gate: 'jev', decision: 'def f(): pass', reason: 'REASON-TEXT', evidence: ['.crew/test-1.txt', '/abs/SECRET-PATH/review-1.md', 'x = `rm -rf`'], referee_calls: [{ raw_answers: 'RAW-ANSWER' }] },
      { schema: 'agni.crew.seat_event/2', seat_event: 'start', ts: '2026-11-25T10:14:01+00:00', task: '1125-1012-ab12', stage: 'review', seat: 'reviewer', output: 'NEWER-SCHEMA.out' },
      { schema: 'agni.crew.seat_event/1', seat_event: 'start', ts: '2026-11-25T10:14:02+00:00', task: '1125-1012-ab12', stage: 'review', attempt: 1, seat: 'reviewer', slot: '', worktree: wt, output: '../../../etc/passwd', seconds: 0 }
    )
    writeFileSync(join(state, 'events.jsonl'), raw.map((e) => JSON.stringify(e)).join('\n') + '\n')
    const out = execFileSync(py, ['-I', '-'], { input: AGNX_PY, encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 30_000 })
    for (const leak of ['SEAT-OUTPUT-CONTENTS', 'crew-local/agni-qwen27', 'opencode', wt, '.crew/seats', 'REASON-TEXT', 'RAW-ANSWER', 'def f', 'SECRET-PATH', 'rm -rf', 'NEWER-SCHEMA', 'passwd'])
      assert.ok(!out.includes(leak), leak)
    const line = JSON.parse(out)
    const seats = line.events.filter((e: any) => e.seat_event)
    assert.equal(seats.length, 7, 'six #42 lines and the traversal one; the /2 line stays home')
    const build = seats.find((e: any) => e.stage === 'build')
    assert.deepEqual(build, { schema: 'agni.crew.seat_event/1', seat_event: 'start', ts: '2026-11-25T10:13:42+00:00', task: '1125-1012-ab12', stage: 'build', attempt: 1, seat: 'leader', slot: '', output: 'leader-build-1.out', seconds: 0, exit: null, timed_out: null, output_bytes: 2100 })
    const decide = line.events.find((e: any) => e.stage === 'decide')
    assert.deepEqual(decide.evidence, ['test-1.txt', 'review-1.md'])
    assert.equal(decide.referee_calls, 1)
    assert.equal(decide.gate, 'jev')
    assert.ok(!('decision' in decide) && !('reason' in decide))
    // And it reads back as mascots.
    const r = parseCrewReport(out)
    const live = crewLive(r.tasks, r.lines, Date.parse('2026-11-25T10:15:12Z'))!
    assert.equal(live.source, 'seats')
    assert.ok(live.mascots.find((m) => m.id === 'qwen')!.bubble!.includes('leader-build-1.out · 2 kB'))
  } finally {
    rmSync(home, { recursive: true })
  }
})
