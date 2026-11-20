import { assert, test } from 'orca/testing'
import { costOf, modelWindow, priceOf, promptTokens } from './pricing'

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-12, `${a} != ${b}`)

test('prices cache writes by TTL and cache reads per model', () => {
  const u = { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 3000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 } }
  // opus 5.5: in 4, out 20, read 0.2, 5m write 5, 1h write 8
  close(costOf('claude-opus-5-5', u), (1000 * 4 + 1000 * 20 + 1000 * 0.2 + 1000 * 5 + 2000 * 8) / 1e6)
  close(costOf('claude-sonnet-5-5', { input_tokens: 1e6 }), 2)
  close(costOf('claude-fable-5-2', { cache_read_input_tokens: 1e6 }), 0.2)
})

test('cache writes without a TTL split count as 5-minute writes', () => {
  close(costOf('claude-sonnet-4-6', { cache_creation_input_tokens: 1e6 }), 3 * 1.25)
})

test('matches dated and 1M-suffixed ids, longest prefix first', () => {
  assert.equal(priceOf('claude-opus-5-5[1m]')!.input, 4)
  assert.equal(priceOf('claude-opus-5')!.input, 5)
  assert.equal(priceOf('claude-sonnet-4-5-20250929')!.input, 3)
  assert.equal(priceOf('claude-fable-5-1')!.cacheRead, 0.25)
  assert.equal(priceOf('gpt-5'), null)
  assert.equal(costOf(null, { input_tokens: 1 }), null)
})

test('haiku 5.5 bills long prompts at the higher tier', () => {
  close(costOf('claude-haiku-5-5', { input_tokens: 50_000 }), 50_000 * 0.1 / 1e6)
  close(costOf('claude-haiku-5-5', { input_tokens: 150_000 }), 150_000 * 0.5 / 1e6)
})

test('prompt tokens and model windows', () => {
  assert.equal(promptTokens({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 99 }), 6)
  assert.equal(modelWindow('claude-opus-5-5'), 1_000_000)
  assert.equal(modelWindow('claude-haiku-4-5'), 200_000)
  assert.equal(modelWindow('claude-sonnet-4-5-20250929'), 200_000)
  assert.equal(modelWindow('claude-sonnet-4-5[1m]'), 1_000_000)
  assert.equal(modelWindow('claude-opus-4-6'), 1_000_000)
  assert.equal(modelWindow(null), 200_000)
})
