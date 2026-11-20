// The snapshot the worker sends to every open Pitwall panel. Agent-neutral: an adapter (only
// Claude Code today) fills the transcript-based fields; Orca itself fills state and tool calls.

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done' | 'unknown'
export type GateState = 'running' | 'asking' | 'ok' | 'error' | 'denied'
export type ToolFamily = 'file' | 'shell' | 'web' | 'mcp' | 'agent' | 'other'
export type Scope = 'focused' | 'all'

export interface TurnView {
  startedAt: number
  endedAt: number | null
  prompt: string
  tools: number
  edits: number
  errors: number
  agents: number
  costUsd: number | null
}

export interface SubagentView {
  id: string
  type: string
  task: string
  model: string | null
  startedAt: number
  endedAt: number | null
  status: 'running' | 'done' | 'error'
  ctxTokens: number
  outTokens: number
  steps: number
  costUsd: number | null
  lastTools: string[]
}

export interface AgentView {
  key: string
  agentKind: string
  title: string
  workspaceName: string
  branch: string | null
  state: AgentState
  stateSince: number
  source: 'transcript' | 'orca-only'
  /** The transcript exists but its format is not one Pitwall reads. */
  formatUnknown: boolean
  /** Its transcript is still being read for the first time: no number is final yet. */
  loading: boolean
  model: string | null
  effort: string | null
  ctxTokens: number
  ctxWindow: number
  /** The model's own window, and where ctxWindow comes from: the model, the auto-compact window, or the Context window setting. */
  ctxModelWindow: number
  ctxBasis: 'model' | 'compact' | 'setting'
  compactions: number
  costUsd: number | null
  outTokens: number
  requests: number
  cacheHitPct: number | null
  turn: TurnView | null
  lastTurn: TurnView | null
  subagents: SubagentView[]
  /** Subagents this session started, including ones not sent. */
  subagentTotal: number
  /** Pitwall can bring this agent's terminal to the front (it has one, and this is not the demo). */
  canFocus: boolean
  /** Finished a turn the person has not looked at yet (opened or jumped to it in Pitwall). */
  unseen: boolean
}

export interface GateEntry {
  id: string
  at: number
  endedAt: number | null
  agentKey: string
  sub: boolean
  tool: string
  family: ToolFamily
  summary: string
  state: GateState
}

export interface LogEntry {
  at: number
  agentKey: string
  kind: 'prompt' | 'spawn' | 'done' | 'edit' | 'error' | 'denied' | 'asking' | 'compact' | 'turn'
  text: string
}

export interface Snapshot {
  v: 1
  at: number
  scope: Scope
  demo: boolean
  showCost: boolean
  agents: AgentView[]
  gate: GateEntry[]
  log: LogEntry[]
  note: string | null
}

export const EMPTY_SNAPSHOT: Snapshot = {
  v: 1,
  at: 0,
  scope: 'focused',
  demo: false,
  showCost: true,
  agents: [],
  gate: [],
  log: [],
  note: null
}
