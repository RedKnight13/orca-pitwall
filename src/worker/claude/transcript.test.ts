import { assert, test } from 'orca/testing'
import { apiRequest, assistant, blob, ms, prompt, result, system } from '../../../test/helpers'
import { promptOf, TranscriptParser, type ParserEvent } from './transcript'

const usage = (input: number, out: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: out,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  cache_creation: { ephemeral_5m_input_tokens: write, ephemeral_1h_input_tokens: 0 }
})

function feed(lines: string[]) {
  const events: ParserEvent[] = []
  const p = new TranscriptParser((e) => events.push(e))
  for (const l of lines) p.line(l)
  return { p, events }
}

test('counts a request once even when its usage repeats on several rows', () => {
  const { p } = feed([
    prompt(0, 'fix the bug'),
    assistant(1, { id: 'm1', usage: usage(10, 5, 1000, 0), text: 'looking' }),
    assistant(2, { id: 'm1', usage: usage(10, 50, 1000, 0), tools: [{ id: 't1', name: 'Read', input: { file_path: '/work/app/a.ts' } }] })
  ])
  assert.equal(p.requests, 1)
  assert.equal(p.outTokens, 50)
  assert.equal(p.ctxTokens, 1060)
  // opus 5.5: 10 in * 4 + 50 out * 20 + 1000 read * 0.2 per MTok
  assert.ok(Math.abs(p.costUsd - (10 * 4 + 50 * 20 + 1000 * 0.2) / 1e6) < 1e-12)
  assert.equal(p.model, 'claude-opus-5-5')
  assert.equal(p.effort, 'high')
  assert.equal(p.cwd, '/work/app')
})

test('tracks a turn: tools, edits, errors, cost, and closes it on turn_duration', () => {
  const { p, events } = feed([
    prompt(0, 'add a test'),
    assistant(1, { usage: usage(100, 10), tools: [{ id: 't1', name: 'Edit', input: { file_path: '/work/app/x.ts' } }] }),
    result(2, 't1'),
    assistant(3, { usage: usage(100, 10), tools: [{ id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }] }),
    result(4, 't2', { isError: true, text: 'exit 1' }),
    system(5, 'turn_duration', { durationMs: 5000 })
  ])
  assert.equal(p.turn, null)
  const t = p.lastTurn!
  assert.equal(t.prompt, 'add a test')
  assert.equal(t.tools, 2)
  assert.equal(t.edits, 1)
  assert.equal(t.errors, 1)
  assert.equal(t.endedAt, ms(5))
  assert.ok(t.costUsd !== null && t.costUsd > 0)
  assert.deepEqual(
    events.map((e) => e.kind),
    ['prompt', 'edit', 'error', 'turn']
  )
})

test('tells a denial from an error', () => {
  const events: ParserEvent[] = []
  const results: unknown[] = []
  const p = new TranscriptParser((e) => events.push(e))
  p.onResult = (id, r) => results.push([id, r])
  for (const l of [
    prompt(0, 'deploy'),
    assistant(1, { usage: usage(1, 1), tools: [{ id: 't1', name: 'Bash', input: { command: 'rm -rf build' } }] }),
    result(2, 't1', { isError: true, text: "The user doesn't want to proceed with this tool use." })
  ])
    p.line(l)
  assert.deepEqual(results, [['t1', { isError: true, denied: true, at: ms(2) }]])
  assert.equal(p.tools.size, 0)
  assert.ok(events.some((e) => e.kind === 'denied'))
})

test('records subagent spawns; async ones stay open', () => {
  const { p } = feed([
    prompt(0, 'research'),
    assistant(1, {
      usage: usage(1, 1),
      tools: [
        { id: 'ag1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find callers', prompt: 'x' } },
        { id: 'ag2', name: 'Agent', input: { subagent_type: 'code-reviewer', description: 'Review', prompt: 'y' } }
      ]
    }),
    result(2, 'ag1', { toolUseResult: { agentId: 'aaa', isAsync: true, status: 'async_launched' } }),
    result(3, 'ag2', { toolUseResult: { agentId: 'bbb' } })
  ])
  const a = p.spawns.get('ag1')!
  const b = p.spawns.get('ag2')!
  assert.equal(a.agentId, 'aaa')
  assert.equal(a.endedAt, null)
  assert.equal(b.agentId, 'bbb')
  assert.equal(b.endedAt, ms(3))
  assert.equal(p.turnView()!.agents, 2)
})

test('counts compactions and takes the context size after one', () => {
  const { p, events } = feed([
    assistant(1, { usage: usage(1, 1, 300_000) }),
    system(2, 'compact_boundary', { compactMetadata: { trigger: 'auto', preTokens: 300_002, postTokens: 40_000 } })
  ])
  assert.equal(p.compactions, 1)
  assert.equal(p.ctxTokens, 40_000)
  assert.equal(events.at(-1)!.text, 'context compacted 300k → 40k (auto)')
})

test('ignores injected rows, malformed lines and synthetic messages', () => {
  const { p } = feed([
    'not json',
    '{"broken": ',
    prompt(0, '<system-reminder>hi</system-reminder>'),
    prompt(1, 'real', { isMeta: true }),
    prompt(1, 'This session is being continued from a previous conversation that ran out of context.'),
    prompt(1, 'summary', { isCompactSummary: true }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T10:00:02Z', message: { id: 'x', model: '<synthetic>', usage: usage(5, 5), content: [] } })
  ])
  assert.equal(p.turn, null)
  assert.equal(p.requests, 0)
  assert.equal(p.model, null)
})

test('an unknown model makes the cost unknown instead of wrong', () => {
  const { p } = feed([prompt(0, 'hi'), assistant(1, { model: 'some-other-model', usage: usage(10, 10) })])
  assert.equal(p.costKnown, false)
  assert.equal(p.turnView()!.costUsd, null)
})

test('promptOf: slash commands, masking, injected text', () => {
  assert.equal(promptOf('<command-name>/review</command-name><command-args>--full</command-args>'), '/review --full')
  assert.equal(promptOf('use token=abc123secret please'), 'use token=*** please')
  assert.equal(promptOf([{ type: 'tool_result', tool_use_id: 'x', content: 'y' }]), null)
  assert.equal(promptOf('<task-notification>done</task-notification>'), null)
  assert.equal(promptOf([{ type: 'text', text: 'hello' }]), 'hello')
})

test('reads tool calls that only exist in api-request-blob rows (after a compaction)', () => {
  const calls: string[] = []
  const results: string[] = []
  const p = new TranscriptParser()
  p.onTool = (u) => calls.push(`${u.id}@${u.at}`)
  p.onResult = (id, r) => results.push(`${id}:${r.isError ? 'error' : 'ok'}`)
  for (const l of [
    prompt(0, 'go on'),
    apiRequest(5),
    blob('assistant', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }]),
    blob('user', [{ type: 'tool_result', tool_use_id: 'b1', content: 'boom', is_error: true }]),
    apiRequest(9),
    blob('assistant', [{ type: 'tool_use', id: 'b2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Look' } }]),
    blob('user', [{ type: 'tool_result', tool_use_id: 'b2', content: [{ type: 'text', text: 'Async agent launched successfully.' }] }])
  ])
    p.line(l)
  assert.deepEqual(calls, [`b1@${ms(5)}`, `b2@${ms(9)}`])
  assert.deepEqual(results, ['b1:error', 'b2:ok'])
  assert.equal(p.turnView()!.tools, 2)
  assert.equal(p.turnView()!.errors, 1)
  assert.equal(p.spawns.get('b2')!.endedAt, null)
  assert.equal(p.requests, 0)
})

test('a blob repeating a regular row counts nothing twice', () => {
  const tool = { id: 't1', name: 'Edit', input: { file_path: '/work/app/a.ts' } }
  const { p, events } = feed([
    prompt(0, 'fix it'),
    assistant(1, { usage: usage(10, 5), tools: [tool] }),
    result(2, 't1', { isError: true, text: 'nope' }),
    apiRequest(2),
    blob('assistant', [{ type: 'tool_use', ...tool }]),
    blob('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'nope', is_error: true }]),
    blob('user', [{ type: 'text', text: 'a prompt copy' }])
  ])
  const t = p.turnView()!
  assert.equal(t.tools, 1)
  assert.equal(t.edits, 1)
  assert.equal(t.errors, 1)
  assert.equal(p.requests, 1)
  assert.equal(events.filter((e) => e.kind === 'error').length, 1)
  assert.equal(events.filter((e) => e.kind === 'prompt').length, 1)
})

test('cache share is the latest prompt, not the session average', () => {
  const { p } = feed([
    prompt(0, 'a'),
    assistant(1, { usage: usage(10, 1, 990) }),
    prompt(2, 'b, after the cache expired'),
    assistant(3, { usage: usage(1000, 1, 0) })
  ])
  assert.equal(p.cacheHitPct(), 0)
})

test('flags a transcript whose rows it does not understand', () => {
  const rows = Array.from({ length: 60 }, (_, i) => JSON.stringify({ type: 'brand-new-row', timestamp: '2026-01-01T10:00:00Z', n: i }))
  assert.equal(feed(rows).p.formatUnknown(), true)
  assert.equal(feed([prompt(0, 'hi'), ...rows]).p.formatUnknown(), false)
  assert.equal(feed(rows.slice(0, 10)).p.formatUnknown(), false)
})

test('a slash command that runs locally keeps the last turn; one the model answers starts a turn', () => {
  const p = new TranscriptParser()
  const usage = { input_tokens: 10, output_tokens: 5 }
  const cmd = (s: number, name: string) => prompt(s, `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args></command-args>`)
  for (const l of [
    prompt(0, 'fix the build'),
    assistant(1, { usage, tools: [{ id: 't1', name: 'Bash', input: { command: 'make' } }] }),
    result(2, 't1'),
    system(3, 'turn_duration'),
    cmd(10, '/reload-plugins'),
    system(10, 'local_command')
  ])
    p.line(l)
  assert.equal(p.turn, null)
  assert.equal(p.lastTurn?.prompt, 'fix the build')
  assert.equal(p.lastTurn?.tools, 1)

  p.line(cmd(20, '/review'))
  assert.equal(p.turn, null)
  p.line(assistant(21, { usage, text: 'Reviewing.' }))
  assert.equal(p.turnView()?.prompt, '/review')
  assert.equal(p.turnView()?.startedAt, ms(20))
})
