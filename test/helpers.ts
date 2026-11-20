// Builders for synthetic Claude Code transcript rows. All data here is invented.
let n = 0
const T0 = Date.parse('2026-01-01T10:00:00Z')
export const at = (s: number) => new Date(T0 + s * 1000).toISOString()
export const ms = (s: number) => T0 + s * 1000

export function prompt(s: number, text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'user', timestamp: at(s), uuid: `u${++n}`, cwd: '/work/app', message: { role: 'user', content: text }, ...extra })
}

export function assistant(
  s: number,
  opts: { id?: string; model?: string; effort?: string; usage?: Record<string, unknown>; tools?: { id: string; name: string; input: unknown }[]; text?: string }
) {
  const content: unknown[] = []
  if (opts.text) content.push({ type: 'text', text: opts.text })
  for (const t of opts.tools ?? []) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input })
  return JSON.stringify({
    type: 'assistant',
    timestamp: at(s),
    uuid: `a${++n}`,
    effort: opts.effort ?? 'high',
    message: { id: opts.id ?? `msg_${n}`, role: 'assistant', model: opts.model ?? 'claude-opus-5-5', usage: opts.usage, content }
  })
}

export function result(s: number, toolUseId: string, opts: { isError?: boolean; text?: string; toolUseResult?: unknown } = {}) {
  const block: Record<string, unknown> = { type: 'tool_result', tool_use_id: toolUseId, content: opts.text ?? 'ok' }
  if (opts.isError) block.is_error = true
  return JSON.stringify({ type: 'user', timestamp: at(s), uuid: `r${++n}`, message: { role: 'user', content: [block] }, toolUseResult: opts.toolUseResult })
}

export function system(s: number, subtype: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: 'system', subtype, timestamp: at(s), uuid: `s${++n}`, ...extra })
}

/** Newer Claude Code: a copy of an API message without a timestamp, plus a timestamped request row. */
export function blob(role: 'assistant' | 'user', content: unknown[]) {
  return JSON.stringify({ type: 'api-request-blob', hash: `h${++n}`, sessionId: 'sess', message: { role, content } })
}

export function apiRequest(s: number) {
  return JSON.stringify({ type: 'api-request', timestamp: at(s), id: `q${++n}`, sessionId: 'sess' })
}
