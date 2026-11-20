// The gate: one entry per tool call, from Orca's agent.tool hooks (live, any agent) and the
// transcript (history, results, denials). Entries are keyed by the tool_use id both carry.
import type { GateEntry, GateState, LogEntry } from '../shared/types'
import { familyOf, summarizeTool } from './summarize'

const MAX = 400
const SLACK = 50

export interface HookCall {
  callId?: string
  tool: string
  input?: unknown
  output?: unknown
}

export class Gate {
  private readonly entries = new Map<string, GateEntry>()
  private seq = 0

  constructor(private readonly log: (e: LogEntry) => void = () => {}) {}

  get size(): number {
    return this.entries.size
  }

  get(id: string): GateEntry | undefined {
    return this.entries.get(id)
  }

  before(agentKey: string, call: HookCall, at: number, cwd?: string | null): GateEntry {
    const id = call.callId ?? `hook-${++this.seq}`
    const existing = this.entries.get(id)
    if (existing) return existing
    const e: GateEntry = {
      id,
      at,
      endedAt: null,
      agentKey,
      sub: false,
      tool: call.tool,
      family: familyOf(call.tool),
      summary: summarizeTool(call.tool, call.input, cwd),
      state: 'running'
    }
    this.put(e)
    return e
  }

  after(agentKey: string, call: HookCall, at: number): GateEntry | undefined {
    let e = call.callId ? this.entries.get(call.callId) : undefined
    if (!e && !call.callId) e = this.newestOpen(agentKey, call.tool)
    if (!e) e = this.before(agentKey, call, at)
    if (e.state === 'running' || e.state === 'asking') {
      e.state = call.output === undefined ? 'error' : 'ok'
      e.endedAt = at
    }
    return e
  }

  /** The agent waits on the person: its newest open call is the one asking for permission. */
  blocked(agentKey: string, at: number): void {
    const e = this.newestOpen(agentKey)
    if (e && e.state === 'running') {
      e.state = 'asking'
      this.log({ at, agentKey, kind: 'asking', text: `asks to run ${e.tool}${e.summary ? ': ' + e.summary : ''}` })
    }
  }

  hasAsking(agentKey: string): boolean {
    for (const e of this.entries.values()) if (e.agentKey === agentKey && e.state === 'asking') return true
    return false
  }

  /** The agent moved on: a call still asking was answered. */
  unblocked(agentKey: string): void {
    for (const e of this.entries.values()) if (e.agentKey === agentKey && e.state === 'asking') e.state = 'running'
  }

  /** The agent finished its turn: anything still open will not report back. */
  settle(agentKey: string, at: number): void {
    for (const e of this.entries.values())
      if (e.agentKey === agentKey && (e.state === 'running' || e.state === 'asking') && at - e.at > 1000) {
        e.state = 'ok'
        e.endedAt = at
      }
  }

  /** A call the transcript recorded; adds it when the hooks did not see it (history, other hosts). */
  transcriptUse(agentKey: string, use: { id: string; name: string; summary: string; at: number }, sub: boolean): void {
    const e = this.entries.get(use.id)
    if (e) {
      // The hook may have filed it under the terminal before the session was known; the transcript knows.
      e.agentKey = agentKey
      e.sub = e.sub || sub
      if (!e.summary) e.summary = use.summary
      return
    }
    this.put({ id: use.id, at: use.at, endedAt: null, agentKey, sub, tool: use.name, family: familyOf(use.name), summary: use.summary, state: 'running' })
  }

  /** The transcript's result is final: it tells a denial and an error apart. */
  transcriptResult(id: string, result: { isError: boolean; denied: boolean; at: number }): void {
    const e = this.entries.get(id)
    if (!e) return
    const state: GateState = result.denied ? 'denied' : result.isError ? 'error' : 'ok'
    e.state = state
    e.endedAt = result.at || e.endedAt || e.at
  }

  /** Moves every entry of one agent key to another (a terminal that turned out to run a known session). */
  rekey(from: string, to: string): void {
    for (const e of this.entries.values()) if (e.agentKey === from) e.agentKey = to
  }

  forget(agentKey: string): void {
    for (const [id, e] of this.entries) if (e.agentKey === agentKey) this.entries.delete(id)
  }

  clear(): void {
    this.entries.clear()
  }

  list(limit = 160, keep?: (e: GateEntry) => boolean): GateEntry[] {
    const all = [...this.entries.values()].filter((e) => !keep || keep(e))
    all.sort((a, b) => a.at - b.at)
    return all.slice(-limit).map((e) => ({ ...e }))
  }

  private newestOpen(agentKey: string, tool?: string): GateEntry | undefined {
    let best: GateEntry | undefined
    for (const e of this.entries.values())
      if (e.agentKey === agentKey && (e.state === 'running' || e.state === 'asking') && !e.sub && (!tool || e.tool === tool) && (!best || e.at >= best.at))
        best = e
    return best
  }

  private put(e: GateEntry): void {
    this.entries.set(e.id, e)
    // History of a newly tracked session arrives after other agents' live calls, so insertion order is
    // not time order: drop the oldest by time, in batches to keep inserts cheap.
    if (this.entries.size <= MAX + SLACK) return
    const oldest = [...this.entries.values()].sort((a, b) => a.at - b.at).slice(0, this.entries.size - MAX)
    for (const o of oldest) this.entries.delete(o.id)
  }
}
