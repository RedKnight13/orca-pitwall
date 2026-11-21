// Incremental parser for a Claude Code session transcript (~/.claude/projects/<slug>/<id>.jsonl)
// or one subagent transcript (<id>/subagents/agent-<agentId>.jsonl). Feed it complete lines in
// order; it keeps running totals and never keeps message text beyond short, masked summaries.
// The format is undocumented: unknown rows are skipped, missing fields are tolerated.
import { costOf, promptTokens, type Usage } from '../pricing'
import { EDIT_TOOLS, mask, oneLine, summarizeTool, toolLabel } from '../summarize'
import { BackgroundTracker, fireLabel, isInjected } from './background'

export interface Turn {
  startedAt: number
  endedAt: number | null
  prompt: string
  tools: number
  edits: number
  errors: number
  agents: number
  costAtStart: number
  costUsd: number | null
}

export interface ToolUse {
  id: string
  name: string
  summary: string
  at: number
}

export interface ToolResult {
  isError: boolean
  denied: boolean
  at: number
}

export interface Spawn {
  toolUseId: string
  type: string
  task: string
  model: string | null
  at: number
  agentId: string | null
  endedAt: number | null
  isError: boolean
}

export interface ParserEvent {
  at: number
  kind: 'prompt' | 'spawn' | 'done' | 'edit' | 'error' | 'denied' | 'compact' | 'turn'
  text: string
}

const DENIED = /doesn't want to proceed|was (rejected|denied) by the user|user (rejected|denied|declined)|permission to use .* (was )?denied|tool use was rejected/i

function ts(row: Record<string, unknown>): number {
  const t = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  return Number.isFinite(t) ? t : 0
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((b) => (b && typeof b === 'object' && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
      .join(' ')
  return ''
}

/** A prompt the person typed, or null for injected rows (reminders, notifications, outputs). */
export function promptOf(content: unknown): string | null {
  if (Array.isArray(content) && content.some((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'tool_result')) return null
  const raw = textOf(content).trim()
  if (!raw) return null
  const cmd = /^<command-name>\s*([^<]+)<\/command-name>/.exec(raw)
  if (cmd) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)
    return oneLine(mask(`${cmd[1].trim()} ${args ? args[1].trim() : ''}`), 70)
  }
  if (raw.startsWith('<') || raw.startsWith('[Request interrupted') || raw.startsWith('Caveat:') || raw.startsWith('This session is being continued from a previous conversation')) return null
  return oneLine(mask(raw), 70)
}

export class TranscriptParser {
  model: string | null = null
  effort: string | null = null
  cwd: string | null = null
  ctxTokens = 0
  outTokens = 0
  requests = 0
  costUsd = 0
  costKnown = true
  promptTotal = 0
  cacheReadTotal = 0
  compactions = 0
  private lastCacheHit: number | null = null
  lastAt = 0
  firstAt = 0
  turn: Turn | null = null
  lastTurn: Turn | null = null
  /** Open tool calls only: an entry goes when its result arrives, so long sessions stay small. */
  readonly tools = new Map<string, ToolUse>()
  readonly spawns = new Map<string, Spawn>()
  /** Tool names of the newest calls, newest last. */
  readonly recentTools: string[] = []
  steps = 0

  /** Called for each new tool call and each tool result, in transcript order. */
  onTool: (use: ToolUse) => void = () => {}
  onResult: (id: string, result: ToolResult) => void = () => {}

  /** Tool call and result ids already handled: Claude Code may write the same message twice (see blobs). */
  private readonly seenUses = new Set<string>()
  private readonly seenResults = new Set<string>()
  private readonly perMessage = new Map<string, { cost: number; out: number; prompt: number; cacheRead: number }>()
  private readonly onEvent: (e: ParserEvent) => void
  /** Background shells, monitors, cron jobs and the /loop wakeup still pending (null for a subagent's transcript). */
  readonly bg: BackgroundTracker | null

  constructor(onEvent: (e: ParserEvent) => void = () => {}, opts: { background?: boolean } = {}) {
    this.onEvent = onEvent
    this.bg = opts.background === false ? null : new BackgroundTracker((e) => this.onEvent(e))
  }

  /** Parses one JSONL line; a malformed line is ignored. */
  line(text: string): void {
    if (!text || text.charCodeAt(0) !== 123 /* { */) return
    let row: Record<string, unknown>
    try {
      row = JSON.parse(text)
    } catch {
      return
    }
    this.row(row)
  }

  /** Rows read, and rows of a kind Pitwall understands (messages and system rows). */
  rows = 0
  knownRows = 0

  /**
   * True when the transcript has plenty of rows but none Pitwall understands: Claude Code changed its
   * format, and the numbers would silently read as zero.
   */
  formatUnknown(): boolean {
    return this.rows >= 50 && this.knownRows === 0
  }

  row(row: Record<string, unknown>): void {
    this.rows++
    if (row.type === 'assistant' || row.type === 'user' || row.type === 'system' || row.type === 'api-request-blob') this.knownRows++
    const at = ts(row)
    if (at) {
      if (!this.firstAt) this.firstAt = at
      if (at > this.lastAt) this.lastAt = at
    }
    if (typeof row.cwd === 'string') this.cwd = row.cwd
    if (at) this.bg?.tick(at)
    switch (row.type) {
      case 'assistant':
        this.commitCommand()
        return this.assistant(row, at)
      case 'user':
        return this.user(row, at)
      case 'system':
        return this.system(row, at)
      case 'api-request-blob':
        this.commitCommand()
        return this.blob(row)
      // Neither kind counts toward knownRows: only background work is read from them.
      case 'queue-operation':
        // A task notification is queued the moment the task ends, before the model reads it.
        if (this.bg && row.operation === 'enqueue' && typeof row.content === 'string' && isInjected(row.content)) this.bg.text(row.content, at)
        return
      case 'attachment':
        return this.attachment(row, at)
    }
  }

  /**
   * Newer Claude Code also records each API message as an `api-request-blob` row, without a timestamp;
   * after a compaction these can be the only record of a turn's tool calls. Only tool calls and results
   * are taken from them: usage and prompts come from the regular rows, so nothing is counted twice.
   */
  private blob(row: Record<string, unknown>): void {
    const msg = (row.message ?? {}) as { role?: unknown; content?: unknown }
    if (!Array.isArray(msg.content)) return
    const at = this.lastAt
    if (msg.role === 'assistant') this.toolUses(msg.content as Record<string, unknown>[], at)
    else if (msg.role === 'user') {
      this.toolResults(msg.content as Record<string, unknown>[], at, row)
      this.notifications(msg.content, at, false)
    }
  }

  private attachment(row: Record<string, unknown>, at: number): void {
    const att = row.attachment
    if (!this.bg || !att || typeof att !== 'object') return
    const a = att as Record<string, unknown>
    if (a.type === 'queued_command' && typeof a.prompt === 'string' && isInjected(a.prompt)) this.bg.text(a.prompt, at)
    else if (a.type === 'session_cron_carry' || a.type === 'task_status') this.bg.attachment(a, at)
    // A new Claude Code process for this session: what ran in the background of the old one is gone.
    else if (a.type === 'hook_success' && (a.hookName === 'SessionStart:startup' || a.hookName === 'SessionStart:resume')) this.bg.started()
  }

  /**
   * Task notifications arrive as injected text blocks. Tool results are never read here: a file or
   * grep output that quotes a notification is not one.
   */
  private notifications(content: unknown, at: number, fromNotification: boolean): void {
    if (!this.bg) return
    if (typeof content === 'string') {
      if ((fromNotification || isInjected(content)) && content.includes('<task-notification>')) this.bg.text(content, at)
      return
    }
    if (!Array.isArray(content)) return
    for (const b of content as Record<string, unknown>[]) {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') continue
      if ((fromNotification || isInjected(b.text)) && b.text.includes('<task-notification>')) this.bg.text(b.text, at)
    }
  }

  private static mark(set: Set<string>, id: string): boolean {
    if (set.has(id)) return false
    set.add(id)
    if (set.size > 4096) set.delete(set.values().next().value as string)
    return true
  }

  private assistant(row: Record<string, unknown>, at: number): void {
    const msg = (row.message ?? {}) as { id?: string; model?: string; usage?: Usage; content?: unknown }
    if (msg.model && msg.model !== '<synthetic>') this.model = msg.model
    if (typeof row.effort === 'string') this.effort = row.effort
    const u = msg.usage
    if (u && msg.model !== '<synthetic>') {
      const key = msg.id ?? String(row.requestId ?? row.uuid ?? Math.random())
      const cost = costOf(msg.model ?? this.model, u)
      if (cost === null) this.costKnown = false
      const next = { cost: cost ?? 0, out: u.output_tokens ?? 0, prompt: promptTokens(u), cacheRead: u.cache_read_input_tokens ?? 0 }
      const prev = this.perMessage.get(key)
      if (prev) {
        this.costUsd += next.cost - prev.cost
        this.outTokens += next.out - prev.out
        this.promptTotal += next.prompt - prev.prompt
        this.cacheReadTotal += next.cacheRead - prev.cacheRead
      } else {
        this.requests++
        this.costUsd += next.cost
        this.outTokens += next.out
        this.promptTotal += next.prompt
        this.cacheReadTotal += next.cacheRead
      }
      this.perMessage.set(key, next)
      // Rows of one message are adjacent, so the last few ids are enough to count each once.
      if (this.perMessage.size > 16) this.perMessage.delete(this.perMessage.keys().next().value as string)
      if (next.prompt > 0) {
        this.ctxTokens = next.prompt + next.out
        this.lastCacheHit = (next.cacheRead / next.prompt) * 100
      }
    }
    if (!Array.isArray(msg.content)) return
    this.toolUses(msg.content as Record<string, unknown>[], at)
  }

  private toolUses(content: Record<string, unknown>[], at: number): void {
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || typeof b.id !== 'string' || !TranscriptParser.mark(this.seenUses, b.id)) continue
      const name = String(b.name ?? 'tool')
      const use: ToolUse = { id: b.id, name, summary: summarizeTool(name, b.input, this.cwd), at }
      this.tools.set(b.id, use)
      this.bg?.use(b.id, name, b.input)
      this.onTool(use)
      this.steps++
      this.recentTools.push(toolLabel(name))
      if (this.recentTools.length > 3) this.recentTools.shift()
      if (this.turn) {
        this.turn.tools++
        if (EDIT_TOOLS.has(name)) this.turn.edits++
      }
      if (EDIT_TOOLS.has(name)) this.onEvent({ at, kind: 'edit', text: `${name} ${use.summary}` })
      if (name === 'Agent' || name === 'Task') {
        const input = (b.input ?? {}) as Record<string, unknown>
        const spawn: Spawn = {
          toolUseId: b.id,
          type: String(input.subagent_type ?? 'general-purpose'),
          task: oneLine(mask(String(input.description ?? '')), 80),
          model: typeof input.model === 'string' ? input.model : null,
          at,
          agentId: null,
          endedAt: null,
          isError: false
        }
        this.spawns.set(b.id, spawn)
        if (this.turn) this.turn.agents++
        this.onEvent({ at, kind: 'spawn', text: `${spawn.type}: ${spawn.task}` })
      }
    }
  }

  private user(row: Record<string, unknown>, at: number): void {
    const msg = (row.message ?? {}) as { content?: unknown }
    const content = msg.content
    if (Array.isArray(content)) this.toolResults(content as Record<string, unknown>[], at, row)
    const origin = (row.origin ?? {}) as { kind?: unknown }
    this.notifications(content, at, origin.kind === 'task-notification')
    if (row.isMeta === true || row.isSidechain === true || row.isCompactSummary === true) return
    const prompt = promptOf(content)
    if (prompt === null) return
    this.pendingCommand = null
    // A slash command may run locally (/model, /reload-plugins) and never reach the model: hold it until the model answers.
    if (/^<command-name>/.test(textOf(content).trim())) this.pendingCommand = { at, prompt }
    else this.startTurn(at, prompt)
  }

  private pendingCommand: { at: number; prompt: string } | null = null

  private commitCommand(): void {
    const p = this.pendingCommand
    if (!p) return
    this.pendingCommand = null
    this.startTurn(p.at, p.prompt)
  }

  private startTurn(at: number, prompt: string): void {
    this.closeTurn(at)
    this.turn = { startedAt: at, endedAt: null, prompt, tools: 0, edits: 0, errors: 0, agents: 0, costAtStart: this.costUsd, costUsd: null }
    this.onEvent({ at, kind: 'prompt', text: prompt })
  }

  private toolResults(content: Record<string, unknown>[], at: number, row: Record<string, unknown>): void {
    {
      for (const b of content) {
        if (!b || b.type !== 'tool_result' || typeof b.tool_use_id !== 'string' || !TranscriptParser.mark(this.seenResults, b.tool_use_id)) continue
        const isError = b.is_error === true
        const denied = isError && DENIED.test(textOf(b.content))
        const result = { isError, denied, at }
        this.onResult(b.tool_use_id, result)
        const use = this.tools.get(b.tool_use_id)
        this.tools.delete(b.tool_use_id)
        this.bg?.result(b.tool_use_id, isError, () => textOf(b.content), row.toolUseResult, at, use?.summary ?? null)
        if (isError && this.turn) this.turn.errors++
        if (denied) this.onEvent({ at, kind: 'denied', text: `${use ? use.name : 'tool'} denied` })
        else if (isError) this.onEvent({ at, kind: 'error', text: `${use ? use.name + ' ' + use.summary : 'tool'} failed` })
        const spawn = this.spawns.get(b.tool_use_id)
        if (spawn) {
          const res = (row.toolUseResult ?? {}) as { agentId?: unknown; isAsync?: unknown; status?: unknown }
          if (typeof res.agentId === 'string') spawn.agentId = res.agentId
          // Blob rows carry no toolUseResult; the result text still says when the agent went to the background.
          const async = res.isAsync === true || res.status === 'async_launched' || /^Async agent launched/.test(textOf(b.content))
          if (!async) {
            spawn.endedAt = at
            spawn.isError = isError
            this.onEvent({ at, kind: 'done', text: `${spawn.type} ${isError ? 'failed' : 'finished'}` })
          }
        }
      }
    }
  }

  private system(row: Record<string, unknown>, at: number): void {
    if (row.subtype === 'compact_boundary') {
      this.compactions++
      this.bg?.compacted(at)
      const meta = (row.compactMetadata ?? {}) as { preTokens?: number; postTokens?: number; trigger?: string }
      if (typeof meta.postTokens === 'number') this.ctxTokens = meta.postTokens
      const pre = typeof meta.preTokens === 'number' ? Math.round(meta.preTokens / 1000) + 'k' : '?'
      const post = typeof meta.postTokens === 'number' ? Math.round(meta.postTokens / 1000) + 'k' : '?'
      this.onEvent({ at, kind: 'compact', text: `context compacted ${pre} → ${post}${meta.trigger ? ' (' + meta.trigger + ')' : ''}` })
    } else if (row.subtype === 'scheduled_task_fire') {
      // A cron job or the /loop wakeup ran: its prompt reaches the model as a hidden row, so the turn starts here.
      this.bg?.fire(row, at)
      this.pendingCommand = null
      this.startTurn(at, fireLabel(row))
    } else if (row.subtype === 'local_command') {
      this.pendingCommand = null
    } else if (row.subtype === 'turn_duration') {
      this.closeTurn(at)
    }
  }

  private closeTurn(at: number): void {
    const t = this.turn
    if (!t) return
    t.endedAt = Math.max(at, t.startedAt)
    t.costUsd = this.costKnown ? this.costUsd - t.costAtStart : null
    this.lastTurn = t
    this.turn = null
    this.onEvent({ at, kind: 'turn', text: `turn done: ${t.tools} tools, ${t.edits} edits${t.errors ? ', ' + t.errors + ' errors' : ''}` })
  }

  /** The running turn with its cost so far. */
  turnView(): Turn | null {
    const t = this.turn
    return t ? { ...t, costUsd: this.costKnown ? this.costUsd - t.costAtStart : null } : null
  }

  /** Share of the latest request's prompt that came from cache. */
  cacheHitPct(): number | null {
    return this.lastCacheHit
  }
}
