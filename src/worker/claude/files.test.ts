import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { compactSettings, listSubagents, Tail, TranscriptLocator } from './files'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'pitwall-test-'))
}

test('Tail yields complete lines only and resumes where it stopped', async () => {
  const dir = tmp()
  const f = join(dir, 's.jsonl')
  writeFileSync(f, '{"a":1}\n{"b":')
  const tail = new Tail(f)
  const got: string[] = []
  assert.equal(await tail.poll((l) => got.push(l)), 'read')
  assert.deepEqual(got, ['{"a":1}'])
  appendFileSync(f, '2}\n')
  await tail.poll((l) => got.push(l))
  assert.deepEqual(got, ['{"a":1}', '{"b":2}'])
  assert.equal(await tail.poll((l) => got.push(l)), 'none')
  rmSync(dir, { recursive: true })
})

test('Tail keeps multi-byte characters intact across chunk boundaries', async () => {
  const dir = tmp()
  const f = join(dir, 's.jsonl')
  const line = JSON.stringify({ t: 'é'.repeat(700_000) })
  writeFileSync(f, line + '\n')
  const got: string[] = []
  await new Tail(f).poll((l) => got.push(l))
  assert.equal(got.length, 1)
  assert.equal(JSON.parse(got[0]).t.length, 700_000)
  rmSync(dir, { recursive: true })
})

test('Tail starts over when the file shrinks and reports a missing file', async () => {
  const dir = tmp()
  const f = join(dir, 's.jsonl')
  writeFileSync(f, '{"a":1}\n{"a":2}\n')
  const tail = new Tail(f)
  await tail.poll(() => {})
  writeFileSync(f, '{"z":1}\n')
  const got: string[] = []
  assert.equal(await tail.poll((l) => got.push(l)), 'reset')
  assert.deepEqual(got, ['{"z":1}'])
  rmSync(dir, { recursive: true })
  assert.equal(await tail.poll(() => {}), 'gone')
})

test('the locator finds a session in any project folder and rejects odd ids', async () => {
  const root = tmp()
  mkdirSync(join(root, 'projects', '-work-a'), { recursive: true })
  mkdirSync(join(root, 'projects', '-work-b'), { recursive: true })
  const sid = '11111111-2222-3333-4444-555555555555'
  writeFileSync(join(root, 'projects', '-work-b', sid + '.jsonl'), '')
  const loc = new TranscriptLocator(() => root)
  assert.equal(await loc.find(sid), join(root, 'projects', '-work-b', sid + '.jsonl'))
  assert.equal(await loc.find('../../etc/passwd'), null)
  rmSync(root, { recursive: true })
})

test('subagents are listed with their meta', async () => {
  const root = tmp()
  const t = join(root, 'sess.jsonl')
  writeFileSync(t, '')
  mkdirSync(join(root, 'sess', 'subagents'), { recursive: true })
  writeFileSync(join(root, 'sess', 'subagents', 'agent-abc.jsonl'), '')
  writeFileSync(join(root, 'sess', 'subagents', 'agent-abc.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'tu1', finished: true }))
  writeFileSync(join(root, 'sess', 'subagents', 'agent-def.jsonl'), '')
  const subs = (await listSubagents(t)).sort((a, b) => a.agentId.localeCompare(b.agentId))
  assert.equal(subs.length, 2)
  assert.equal(subs[0].meta!.agentType, 'Explore')
  assert.deepEqual(subs[1].meta, {})
  rmSync(root, { recursive: true })
})

test('reads the auto-compact window per model from settings.json', async () => {
  const root = tmp()
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 400000 } }, theme: 'x' }))
  const s = await compactSettings(root)
  assert.deepEqual(s, { enabled: true, windows: { 'claude-opus-5-5': 400000 } })
  const none = await compactSettings(join(root, 'missing'))
  assert.deepEqual(none, { enabled: true, windows: {} })
  rmSync(root, { recursive: true })
})

test('a tail is caught up only once it has read to the end of the file', async () => {
  const dir = tmp()
  const f = join(dir, 's.jsonl')
  writeFileSync(f, '{"a":1}\n'.repeat(10))
  const tail = new Tail(f)
  const got: string[] = []
  assert.equal(tail.caughtUp, false)
  await tail.poll((l) => got.push(l), 32)
  assert.equal(tail.caughtUp, false)
  while (got.length < 10) await tail.poll((l) => got.push(l), 32)
  assert.equal(tail.caughtUp, true)
  assert.equal(got.length, 10)
  rmSync(dir, { recursive: true })
})
