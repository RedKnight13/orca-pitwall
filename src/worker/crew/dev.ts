// Crew development: the Orca agents working on the crew itself (issue workers, PR reviewers) in the
// Crew project's workspaces. Read from Orca, whatever workspace is focused, and kept apart from the
// crew's runs and model seats: an Orca agent is development, a seat lease is a run. Read-only.
import type { AgentState, CrewDevAgentView, CrewDevView } from '../../shared/types'

/** Workspaces read per pass, and agents sent. */
const MAX_WORKSPACES = 24
const MAX_AGENTS = 16

export interface DevWorkspace {
  id: string
  name: string
  project?: string | null
  projectId?: string | null
  branch: string | null
  status?: { terminalCount: number }
}

export interface DevAgentRow {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: AgentState
  stateStartedAt: number
  sessionId?: string | null
  task?: { title: string } | null
}

export type DevCall = <T>(name: string, params: unknown) => Promise<T>

/** The Crew repository by name (agni-crew), or a workspace another project names as crew work (crew-…). */
export function isCrewWorkspace(w: DevWorkspace): boolean {
  const project = `${w.projectId ?? ''} ${w.project ?? ''}`
  if (/(^|[\s:/])agni-crew(\s|$)/i.test(project)) return true
  return /^crew[-_/]/i.test(w.name) || /^crew[-_/]/i.test(w.branch ?? '')
}

const clean = (t: string | null | undefined): string | null => {
  if (!t) return null
  const s = t.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  return s && !/^(claude( code)?|codex|zsh|bash|fish|sh|terminal( \d+)?)$/i.test(s) ? s.slice(0, 160) : null
}

const ORDER: Record<AgentState, number> = { blocked: 0, waiting: 1, working: 2, done: 3, unknown: 4 }

/** One pass over Orca. Throws when Orca does not list workspaces, so the caller can say the read failed. */
export async function readCrewDev(call: DevCall, now: number): Promise<CrewDevView> {
  const res = await call<{ workspaces: DevWorkspace[] }>('workspace.list', { includeStatus: true })
  const crew = res.workspaces.filter((w) => isCrewWorkspace(w) && (w.status?.terminalCount ?? 0) > 0).slice(0, MAX_WORKSPACES)
  const agents: CrewDevAgentView[] = []
  let failed = 0
  for (const w of crew) {
    let rows: DevAgentRow[]
    try {
      rows = (await call<{ agents: DevAgentRow[] }>('agents.list', { workspaceId: w.id })).agents
    } catch {
      failed++
      continue
    }
    if (!rows.length) continue
    const titles = await call<{ terminals: { id: string; title?: string }[] }>('terminal.list', { workspaceId: w.id })
      .then((r) => new Map(r.terminals.map((t) => [t.id, t.title ?? ''])))
      .catch(() => new Map<string, string>())
    for (const a of rows) {
      const task = clean(a.task?.title)
      const term = clean(a.terminalId ? titles.get(a.terminalId) : null) ?? clean(a.title)
      agents.push({
        key: a.sessionId ? `s:${a.sessionId}` : `t:${a.terminalId ?? w.id}`,
        agentKind: a.agent ?? 'agent',
        workspaceName: w.name,
        branch: w.branch,
        title: task ?? term ?? w.name,
        lastSeen: task && term && term !== task ? term : null,
        state: a.state,
        stateSince: a.stateStartedAt || now
      })
    }
  }
  agents.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.stateSince - a.stateSince)
  return { at: now, ok: failed === 0, error: failed ? `${failed} Crew workspace${failed === 1 ? '' : 's'} did not answer` : null, agents: agents.slice(0, MAX_AGENTS), workspaces: crew.length }
}
