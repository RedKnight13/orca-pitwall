import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { VERSION } from './version'

test('the version shown in the panel is the one released', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')) as { version: string }
  assert.equal(VERSION, read('orca-plugin.json').version)
  assert.equal(VERSION, read('package.json').version)
})
