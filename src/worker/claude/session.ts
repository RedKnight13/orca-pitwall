// One Claude Code session: its transcript, its subagents' transcripts, and the view they give.
import type { SubagentView, TurnView } from '../../shared/types'
import type { Gate } from '../gate'
import { listSubagents, Tail, type SubagentFile, type TranscriptLocator } from './files'
import { mask, oneLine } from '../summarize'
import { TranscriptParser, type ParserEvent, type Turn } from './transcript'

interface Sub {
  agentId: string
  tail: Tail
  parser: TranscriptParser
  meta: SubagentFile['meta']
  /** Finished and read to the end: no more file access for it. */
  closed: boolean
}

/** Events older than this at load time are history: counted, not logged. */
const LOG_HORIZON_MS = 30 * 60 * 1000
const SUB_IDLE_DONE_MS = 10 * 60 * 1000
/** Lookup backoff for a transcript that is not on this machine (remote host, other config folder). */
const LOOKUP_DELAYS_MS = [3_000, 3_000, 10_000, 30_000, 120_000, 300_000]

export class ClaudeSession {
  parser: TranscriptParser
  path: string | null = null
  private tail: Tail | null = null
  private readonly subs = new Map<string, Sub>()
  private polls = 0
  private lastLookup = 0
  private misses = 0
  private spawnsSeen = -1
  /** Sum of subagent cost when the current turn started, so a turn's cost includes its subagents. */

  constructor(
    readonly sessionId: string,
    readonly agentKey: string,
    private readonly gate: Gate,
    private readonly log: (e: ParserEvent & { agentKey: string }) => void
  ) {
    this.parser = this.makeParser(false)
  }

  private makeParser(sub: boolean): TranscriptParser {
    const p = new TranscriptParser((e) => {
      if (Date.now() - e.at < LOG_HORIZON_MS && (!sub || e.kind === 'error' || e.kind === 'denied')) this.log({ ...e, agentKey: this.agentKey })
    })
    // History older than the log horizon stays out of the gate: it would only push out live calls.
    p.onTool = (use) => {
      if (Date.now() - use.at < LOG_HORIZON_MS || this.gate.get(use.id)) this.gate.transcriptUse(this.agentKey, use, sub)
    }
    p.onResult = (id, res) => this.gate.transcriptResult(id, res)
    return p
  }

  get found(): boolean {
    return this.tail !== null
  }

  /** Found but not yet read to the end: every number is still a partial sum. */
  get loading(): boolean {
    if (!this.tail) return false
    if (!this.tail.caughtUp) return true
    for (const s of this.subs.values()) if (!s.tail.caughtUp) return true
    return false
  }

  /** Reads what was appended since the last poll. Returns true when anything changed. */
  async poll(locator: TranscriptLocator): Promise<boolean> {
    this.polls++
    if (!this.tail) {
      const wait = LOOKUP_DELAYS_MS[Math.min(this.misses, LOOKUP_DELAYS_MS.length - 1)]
      if (Date.now() - this.lastLookup < wait) return false
      this.lastLookup = Date.now()
      this.path = await locator.find(this.sessionId)
      if (!this.path) {
        this.misses++
        return false
      }
      this.misses = 0
      this.tail = new Tail(this.path)
    }
    let changed = false
    const r = await this.tail.poll((l) => this.parser.line(l))
    if (r === 'gone') {
      // A new Tail reads the file from the start, so the parser must start over too, or every
      // request is counted twice when the file comes back.
      this.tail = null
      this.parser = this.makeParser(false)
      this.subs.clear()
      this.spawnsSeen = -1
      this.gate.forget(this.agentKey)
      return true
    }
    if (r === 'reset') {
      // The file was rewritten: start over with a fresh parser on the same tail.
      this.parser = this.makeParser(false)
      this.subs.clear()
      this.spawnsSeen = -1
      this.gate.forget(this.agentKey)
      changed = true
    }
    if (r === 'read') changed = true
    if (this.path) changed = (await this.pollSubs()) || changed
    return changed
  }

  /** Cost of the subagents started in the current turn (none before its prompt counts). */
  turnSubCost(): number {
    const t = this.parser.turn
    if (!t) return 0
    let c = 0
    for (const s of this.subs.values()) if (s.parser.firstAt >= t.startedAt) c += s.parser.costUsd
    return c
  }

  private async pollSubs(): Promise<boolean> {
    if (!this.path) return false
    let changed = false
    // List the folder when the main transcript shows a new spawn, else every 10th poll.
    const spawns = this.parser.spawns.size
    if (spawns !== this.spawnsSeen || this.polls % 10 === 0) {
      this.spawnsSeen = spawns
      const files = await listSubagents(this.path, (id) => !this.subs.get(id)?.closed)
      for (const f of files) {
        const s = this.subs.get(f.agentId)
        if (!s) {
          this.subs.set(f.agentId, { agentId: f.agentId, tail: new Tail(f.path), parser: this.makeParser(true), meta: f.meta ?? {}, closed: false })
          changed = true
        } else if (f.meta && f.meta.finished !== s.meta.finished) {
          s.meta = f.meta
          changed = true
        }
      }
    }
    const now = Date.now()
    for (const s of this.subs.values()) {
      if (s.closed) continue
      const r = await s.tail.poll((l) => s.parser.line(l))
      if (r === 'read' || r === 'reset') changed = true
      if (r === 'none' && this.subStatus(s, now) !== 'running') s.closed = true
    }
    return changed
  }

  private subStatus(s: Sub, now: number): SubagentView['status'] {
    const toolUse = s.meta.toolUseId ? this.parser.spawns.get(s.meta.toolUseId) : undefined
    if (toolUse?.isError) return 'error'
    const finished = s.meta.finished === true || (toolUse !== undefined && toolUse.endedAt !== null)
    const idle = now - Math.max(s.parser.lastAt, s.tail.mtime) > SUB_IDLE_DONE_MS
    return finished || idle ? 'done' : 'running'
  }

  /** Whether any subagent of this session is still running. */
  get subsRunning(): boolean {
    return this.subagents(Date.now()).some((s) => s.status === 'running')
  }

  subagents(now: number): SubagentView[] {
    const spawnsByAgent = new Map<string, { task: string; type: string; isError: boolean }>()
    for (const sp of this.parser.spawns.values()) if (sp.agentId) spawnsByAgent.set(sp.agentId, sp)
    const out: SubagentView[] = []
    for (const s of this.subs.values()) {
      const p = s.parser
      if (!p.firstAt) continue
      const toolUse = s.meta.toolUseId ? this.parser.spawns.get(s.meta.toolUseId) : undefined
      const spawn = toolUse ?? spawnsByAgent.get(s.agentId)
      const status = spawn?.isError ? 'error' : this.subStatus(s, now)
      out.push({
        id: s.agentId,
        type: s.meta.agentType ?? spawn?.type ?? 'agent',
        task: s.meta.description ? oneLine(mask(s.meta.description), 80) : spawn?.task ?? '',
        model: p.model ?? s.meta.model ?? s.meta.pickedEffortModel ?? null,
        startedAt: p.firstAt,
        endedAt: status === 'running' ? null : p.lastAt,
        status,
        ctxTokens: p.ctxTokens,
        outTokens: p.outTokens,
        steps: p.steps,
        costUsd: p.costKnown ? p.costUsd : null,
        lastTools: [...p.recentTools]
      })
    }
    out.sort((a, b) => a.startedAt - b.startedAt)
    return out
  }

  /** Cost of the session including its subagents. */
  totalCost(): number | null {
    if (!this.parser.costKnown) return null
    let c = this.parser.costUsd
    for (const s of this.subs.values()) {
      if (!s.parser.costKnown) return null
      c += s.parser.costUsd
    }
    return c
  }
}

export function turnView(t: Turn | null): TurnView | null {
  if (!t) return null
  return { startedAt: t.startedAt, endedAt: t.endedAt, prompt: t.prompt, tools: t.tools, edits: t.edits, errors: t.errors, agents: t.agents, costUsd: t.costUsd }
}
