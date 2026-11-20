// Anthropic API list prices, USD per million tokens. Source: Anthropic model and pricing docs,
// 2026-11. Cache writes are 1.25x input (5-minute TTL) or 2x input (1-hour TTL); cache reads are
// per model. Claude Code on a subscription does not bill these: they are the API equivalent.

export interface Price {
  input: number
  output: number
  cacheRead: number
  /** Prompts above `above` tokens are billed at these rates instead. */
  long?: { above: number; input: number; output: number; cacheRead: number }
}

const P = (input: number, output: number, cacheRead = input * 0.1): Price => ({ input, output, cacheRead })

// Longest prefix first wins.
const TABLE: [string, Price][] = [
  ['claude-fable-5-2', P(8, 40, 0.2)],
  ['claude-mythos-5-2', P(8, 40, 0.2)],
  ['claude-fable-5-1', P(10, 50, 0.25)],
  ['claude-mythos-5-1', P(10, 50, 0.25)],
  ['claude-fable-5', P(10, 50, 1)],
  ['claude-mythos-5', P(10, 50, 1)],
  ['claude-opus-5-5', P(4, 20, 0.2)],
  ['claude-opus-5', P(5, 25)],
  ['claude-opus-4-8', P(5, 25)],
  ['claude-opus-4-7', P(5, 25)],
  ['claude-opus-4-6', P(5, 25)],
  ['claude-opus-4-5', P(5, 25)],
  ['claude-opus-4', P(15, 75)],
  ['claude-sonnet-5-5', P(2, 10, 0.1)],
  ['claude-sonnet-5', P(2, 10)],
  ['claude-sonnet-4', P(3, 15)],
  ['claude-haiku-5-5', { ...P(0.1, 0.5), long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 } }],
  ['claude-haiku-4-5', P(1, 5)],
  ['claude-3-5-haiku', P(0.8, 4)]
]

export function priceOf(model: string | null | undefined): Price | null {
  if (!model) return null
  const id = model.toLowerCase().replace(/\[1m\]$/, '')
  let best: [string, Price] | null = null
  for (const row of TABLE) if (id.startsWith(row[0]) && (!best || row[0].length > best[0].length)) best = row
  return best ? best[1] : null
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Tokens the request carried in its prompt: what the context gauge shows. */
export function promptTokens(u: Usage): number {
  return n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens)
}

/** Cost of one request in USD, or null when the model is unknown. */
export function costOf(model: string | null | undefined, u: Usage): number | null {
  const p = priceOf(model)
  if (!p) return null
  const prompt = promptTokens(u)
  const r = p.long && prompt > p.long.above ? { ...p, ...p.long } : p
  const write = n(u.cache_creation_input_tokens)
  const w1h = Math.min(write, n(u.cache_creation?.ephemeral_1h_input_tokens))
  const w5m = write - w1h
  return (
    (n(u.input_tokens) * r.input +
      n(u.output_tokens) * r.output +
      n(u.cache_read_input_tokens) * r.cacheRead +
      w5m * r.input * 1.25 +
      w1h * r.input * 2) /
    1_000_000
  )
}

/** The model's own context window. */
export function modelWindow(model: string | null | undefined): number {
  if (!model) return 200_000
  const id = model.toLowerCase()
  if (id.endsWith('[1m]')) return 1_000_000
  if (/claude-(haiku-4|3-|opus-4-[0-5](?!\d)|opus-4-1|opus-4$|sonnet-4-5|sonnet-4$|sonnet-4-\d{8})/.test(id)) return 200_000
  return 1_000_000
}
