import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { assistant, prompt, result } from '../../../test/helpers'
import { Gate } from '../gate'
import { ClaudeSession } from './session'
import type { TranscriptLocator } from './files'

test('a transcript that disappears and comes back is not counted twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pitwall-session-'))
  const path = join(dir, 's.jsonl')
  const away = join(dir, 'away.jsonl')
  writeFileSync(
    path,
    [prompt(0, 'go'), assistant(1, { usage: { input_tokens: 100, output_tokens: 10 }, tools: [{ id: 't1', name: 'Read', input: {} }] }), result(2, 't1')].join('\n') + '\n'
  )
  const locator = { find: async () => path } as unknown as TranscriptLocator
  const s = new ClaudeSession('sid', 's:sid', new Gate(), () => {})
  const internal = s as unknown as { lastLookup: number }
  await s.poll(locator)
  assert.equal(s.parser.requests, 1)
  renameSync(path, away)
  await s.poll(locator)
  renameSync(away, path)
  internal.lastLookup = 0
  await s.poll(locator)
  await s.poll(locator)
  assert.equal(s.parser.requests, 1)
  assert.equal(s.parser.turnView()!.tools, 1)
  rmSync(dir, { recursive: true })
})
