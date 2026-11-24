import { execFileSync } from 'node:child_process'
import { assert, test } from 'orca/testing'
import { nvidiaSmiSample, rocmSmiSample } from '../../../test/crew'
import { cardReading, GPU_PY, parseGpuReport, parseNvidiaSmi, parseRocmSmi, seatPlacement, tempTone } from './gpu'

const round = (x: number) => Math.round(x * 10) / 10

test('rocm-smi (agni1): the R9700 and the RX 9070 XT by device id, past the warnings; integrated graphics left out', () => {
  const cards = parseRocmSmi(rocmSmiSample())
  assert.deepEqual(
    cards.map((c) => [c.card, c.tempC, round(c.vramGb!.used), round(c.vramGb!.total)]),
    [
      ['RX 9070 XT', 29, 12.4, 15.9],
      ['R9700', 39, 28.7, 31.9]
    ]
  )
})

test('nvidia-smi (agni2): the RTX 5060, its name shortened, MiB as GB', () => {
  const [c] = parseNvidiaSmi(nvidiaSmiSample())
  assert.equal(c.card, 'RTX 5060')
  assert.equal(c.tempC, 30.76)
  assert.deepEqual([round(c.vramGb!.used), round(c.vramGb!.total)], [7.3, 8])
})

test('missing or broken tool output gives no cards, never a guess', () => {
  for (const bad of [null, '', 'command not found', '{"card0": {', 'WARNING only\n']) {
    assert.deepEqual(parseRocmSmi(bad), [])
    assert.deepEqual(parseNvidiaSmi(bad), [])
  }
  // A field the tool could not read stays empty; the rest of the card still shows.
  const [c] = parseNvidiaSmi('NVIDIA GeForce RTX 5060, [N/A], 7430, 8151')
  assert.equal(c.tempC, null)
  assert.ok(c.vramGb)
  // The script's line: both tools, one, or none.
  assert.deepEqual(parseGpuReport(JSON.stringify({ schema: 'pitwall.gpu/1', nvidia: null, rocm: null })), [])
  assert.equal(parseGpuReport(JSON.stringify({ schema: 'pitwall.gpu/1', nvidia: nvidiaSmiSample(), rocm: rocmSmiSample() })).length, 3)
  assert.throws(() => parseGpuReport('{"schema":"other"}'), /bad output/)
})

test('placement: seat → model from the crew config, then where that model is served; the fallback while agni2 is off', () => {
  const models = { primary: { leader: 'agni-qwen27', helper: 'gemma-rx', reviewer: 'inkling' }, fallback: { leader: 'agni-qwen27', reviewer: 'gemma-rx' } }
  assert.deepEqual(seatPlacement(models, false, 'leader'), { host: 'agni1', card: 'R9700' })
  assert.deepEqual(seatPlacement(models, false, 'reviewer'), { host: 'agni2', card: 'RTX 5060' })
  // agni1-only mode: the reviewer runs on Gemma's card.
  assert.deepEqual(seatPlacement(models, true, 'reviewer'), { host: 'agni1', card: 'RX 9070 XT' })
  assert.equal(seatPlacement(models, false, 'cavalry'), null)
  assert.equal(seatPlacement(null, false, 'leader'), null, 'no config read, no card')
  assert.equal(seatPlacement({ primary: { leader: 'some-new-model' }, fallback: {} }, false, 'leader'), null, 'an unknown model gets no card')
  const readings = new Map([['agni1', parseRocmSmi(rocmSmiSample())]])
  assert.equal(cardReading(readings, { host: 'agni1', card: 'R9700' })?.tempC, 39)
  assert.equal(cardReading(readings, { host: 'agni2', card: 'RTX 5060' }), null, 'host off: nothing')
})

test('temperature tones: amber from 85 °C, red from 95 °C', () => {
  assert.deepEqual([null, 60, 84.9, 85, 94, 95, 100].map(tempTone), ['', '', '', 'warn', 'warn', 'bad', 'bad'])
})

test('gpu script: one JSON line, and no tool means null (run here, where neither tool need exist)', () => {
  let py: string
  try {
    py = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
  } catch {
    return // no python3 here
  }
  // An empty PATH: neither nvidia-smi nor rocm-smi can be found.
  const out = execFileSync(py, ['-I', '-'], { input: GPU_PY, encoding: 'utf8', env: { PATH: '/nonexistent' }, timeout: 30_000 })
  assert.deepEqual(JSON.parse(out), { schema: 'pitwall.gpu/1', nvidia: null, rocm: null })
})
