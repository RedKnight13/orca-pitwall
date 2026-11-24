// Pure parsers for what the Crew scripts print (see scripts.ts). No I/O, so the tests feed them
// recorded output. Anything malformed is dropped rather than guessed at.
import type { CrewKeyView, CrewSeatView, CrewStageView, CrewTaskView, CrewTone } from '../../shared/types'
import { parseLiveLine, type LiveLine } from './live'

/** One row of `crew status` (the list form): the crew's own view of a task's status. */
export interface StatusRow {
  id: string
  status: string
  stage: string | null
  attempts: number
  wait: { seat: string; holder: string } | null
}

export interface StatusList {
  tasks: Map<string, StatusRow>
  leases: { seat: string; holder: string; priority: string }[]
}

const TASK_LINE = /^(\S+)\s+([a-z_]+)\s+stage=(\S+)\s+attempts=(\d+)(?:\s+wait=(\S+)\s+holder=(\S+))?/
const SEAT_LINE = /^seat\s+(\S+)\s+holder=(\S+)\s+priority=(\S+)/

export function parseStatusList(text: string): StatusList {
  const tasks = new Map<string, StatusRow>()
  const leases: StatusList['leases'] = []
  for (const line of String(text ?? '').split('\n')) {
    const seat = SEAT_LINE.exec(line)
    if (seat) {
      leases.push({ seat: seat[1], holder: seat[2], priority: seat[3] })
      continue
    }
    const m = TASK_LINE.exec(line)
    if (!m) continue
    tasks.set(m[1], { id: m[1], status: m[2], stage: m[3] === '-' ? null : m[3], attempts: Number(m[4]), wait: m[5] ? { seat: m[5], holder: m[6] } : null })
  }
  return { tasks, leases }
}

// Outcome words as the Agni Crew Replay colours them; anything else reads as waiting.
const PASS = new Set(['ok', 'tests_pass', 'PASS', 'merge_ready', 'committed'])
const FAIL = new Set(['tests_fail', 'FAIL', 'malformed', 'no_verdict', 'failed', 'no_test_command'])

export function outcomeTone(outcome: string): CrewTone {
  return PASS.has(outcome) ? 'pass' : FAIL.has(outcome) ? 'fail' : 'wait'
}

interface RawTask {
  assignments?: Record<string, unknown>
  id?: unknown
  status?: unknown
  stage?: unknown
  attempts?: unknown
  prompt?: unknown
  created?: unknown
  updated?: unknown
  has_test_command?: unknown
  error?: unknown
  waiting_on_seat?: { seat?: unknown; holder?: unknown } | null
  result?: { verdict?: unknown; test_exit?: unknown; decision?: unknown; next_actor?: unknown } | null
}

interface RawEvent {
  ts?: unknown
  task?: unknown
  stage?: unknown
  attempt?: unknown
  outcome?: unknown
  seconds?: unknown
}

interface RawReport {
  reserve_roles?: unknown
  schema?: unknown
  status?: { exit?: unknown; text?: unknown } | null
  tasks?: unknown
  total?: unknown
  events?: unknown
  seats?: unknown
  lock?: { deployed?: unknown; seats?: unknown } | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** Who sits in each seat. The ports are on agnx's loopback, where the crew reaches them. */
const SEAT_INFO: Record<string, { role: string; model: string; where: string }> = {
  leader: { role: 'Leader', model: 'Qwen', where: 'agnx :28084' },
  helper: { role: 'Helper', model: 'Gemma', where: 'agnx :28085' },
  reviewer: { role: 'Reviewer', model: 'Inkling', where: 'agni2 :8093' }
}

/** Statuses that wait on the owner. needs_owner is the crew's own ask for a test command. */
function ownerOf(status: string): CrewTaskView['owner'] {
  if (status === 'needs_owner') return 'test_command'
  if (status === 'waiting' || status === 'failed' || status === 'interrupted') return 'stuck'
  return null
}

function detailOf(status: string, t: RawTask, attempts: number): string {
  const r = t.result ?? {}
  const err = str(t.error)
  if (status === 'needs_owner') return 'No test command: the crew needs one to grade the work.'
  if (err && (status === 'failed' || status === 'interrupted')) return err
  if (status === 'interrupted') return 'The crew process stopped mid-task.'
  if (status === 'waiting' && r.decision === 'helper_assignment_rejected') return 'Crew rejected the helper handoff before grading or review.'
  const bits: string[] = []
  const verdict = str(r.verdict)
  const exit = num(r.test_exit)
  if (exit !== null) bits.push(exit === 0 ? 'tests pass' : `tests exit ${exit}`)
  if (verdict) bits.push(`review ${verdict}`)
  if (attempts) bits.push(`${attempts} attempt${attempts === 1 ? '' : 's'}`)
  return bits.join(' · ')
}

/** Task order: waiting on the owner first, then running, then merge-ready, then the rest; newest first within each. */
const RANK: Record<string, number> = { running: 1, merge_ready: 2 }

export interface CrewReport {
  reserveRoles: string[]
  tasks: CrewTaskView[]
  more: number
  seats: CrewSeatView[]
  agni1Only: boolean
  lockDeployed: boolean
  /** Per task, the lines the mascots are drawn from (stage lines, and #42 seat lines when present). */
  lines: Map<string, LiveLine[]>
}

/** Parses the agnx script's JSON line. Throws on output that is not the script's. */
export function parseCrewReport(raw: string): CrewReport {
  const d = JSON.parse(raw) as RawReport
  if (!d || d.schema !== 'pitwall.crew/1') throw new Error('bad output')
  const list = parseStatusList(str(d.status?.text) ?? '')
  const events = (Array.isArray(d.events) ? (d.events as RawEvent[]) : []).filter((e) => e && typeof e === 'object')
  const byTask = new Map<string, CrewStageView[]>()
  const lines = new Map<string, LiveLine[]>()
  for (const e of events) {
    const live = parseLiveLine(e)
    if (live) lines.set(live.task, [...(lines.get(live.task) ?? []), live])
    // Seat lines are not stages: they stay out of the run sheet.
    if ('seat_event' in e) continue
    const task = str(e.task)
    const stage = str(e.stage)
    const at = time(e.ts)
    if (!task || !stage || at === null) continue
    const outcome = e.outcome === null || e.outcome === undefined ? '' : String(e.outcome)
    const row: CrewStageView = { stage, attempt: num(e.attempt) ?? 0, outcome, seconds: Math.max(0, num(e.seconds) ?? 0), tone: outcomeTone(outcome), at }
    if (live?.kind === 'stage' && live.evidence.length) row.evidence = live.evidence
    const rows = byTask.get(task) ?? []
    rows.push(row)
    byTask.set(task, rows)
  }
  const tasks: CrewTaskView[] = []
  for (const t of Array.isArray(d.tasks) ? (d.tasks as RawTask[]) : []) {
    const id = str(t?.id)
    if (!id) continue
    const row = list.tasks.get(id)
    // The list is the crew's own reading (a dead runner shows as interrupted); the record is the fallback.
    const status = row?.status ?? str(t.status) ?? 'unknown'
    const attempts = row?.attempts ?? num(t.attempts) ?? 0
    const stages = (byTask.get(id) ?? []).sort((a, b) => a.at - b.at)
    const wait = row?.wait ?? (t.waiting_on_seat && str(t.waiting_on_seat.seat) ? { seat: String(t.waiting_on_seat.seat), holder: str(t.waiting_on_seat.holder) ?? '?' } : null)
    tasks.push({
      id,
      status,
      stage: row?.stage ?? str(t.stage),
      attempts,
      assignments: Object.fromEntries(Object.entries(t.assignments ?? {}).filter(([role, files]) =>
        ['leader', 'helper', 'reviewer'].includes(role) && Array.isArray(files)
      ).map(([role, files]) => [role, (files as unknown[]).filter((f): f is string => typeof f === 'string').slice(0, 8)])),
      prompt: str(t.prompt) ?? '',
      createdAt: time(t.created),
      updatedAt: time(t.updated),
      owner: ownerOf(status),
      detail: detailOf(status, t, attempts),
      waitingOn: status === 'running' ? wait : null,
      stages,
      totalSeconds: stages.reduce((n, s) => n + s.seconds, 0)
    })
  }
  const rank = (t: CrewTaskView) => (t.owner ? 0 : RANK[t.status] ?? 3)
  tasks.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  const lockSeats = Array.isArray(d.lock?.seats) ? (d.lock!.seats as { seat?: unknown; holder?: unknown }[]) : []
  const holders = new Map<string, string>()
  for (const l of lockSeats) if (str(l?.seat)) holders.set(String(l.seat), str(l.holder) ?? '?')
  // Without the lock helper, `crew status` still prints the leases it sees.
  for (const l of list.leases) if (!holders.has(l.seat)) holders.set(l.seat, l.holder)
  const seats: CrewSeatView[] = []
  for (const s of Array.isArray(d.seats) ? (d.seats as { seat?: unknown; health?: unknown }[]) : []) {
    const id = str(s?.seat)
    if (!id) continue
    const info = SEAT_INFO[id] ?? { role: id, model: '', where: '' }
    const up = num(s.health) === 200
    const holder = holders.get(id) ?? null
    seats.push({ id, ...info, state: !up ? 'down' : holder ? 'busy' : 'up', holder: up ? holder : null })
  }
  const reviewer = seats.find((s) => s.id === 'reviewer')
  const total = num(d.total) ?? tasks.length
  const reserveRoles = Array.isArray(d.reserve_roles) ? d.reserve_roles.filter((role): role is string => ['cavalry', 'referee', 'escalation'].includes(role)) : []
  return { reserveRoles, tasks, more: Math.max(0, total - tasks.length), seats, agni1Only: !!reviewer && reviewer.state === 'down', lockDeployed: d.lock?.deployed === true, lines }
}

/** Amber at 80% of budget or 7 days to expiry, red at 100% or 1 day. */
export const KEY_WARN_PCT = 80
export const KEY_BAD_PCT = 100
export const KEY_WARN_DAYS = 7
export const KEY_BAD_DAYS = 1
const DAY = 86_400_000

export function keyTone(pct: number | null, expiresAt: number | null, now: number): CrewKeyView['tone'] {
  const days = expiresAt === null ? null : (expiresAt - now) / DAY
  if ((pct !== null && pct >= KEY_BAD_PCT) || (days !== null && days <= KEY_BAD_DAYS)) return 'bad'
  if ((pct !== null && pct >= KEY_WARN_PCT) || (days !== null && days <= KEY_WARN_DAYS)) return 'warn'
  return ''
}

export interface GatewayReport {
  keys: CrewKeyView[]
  missing: string[]
}

/** Parses the agni1 script's JSON line. Throws with the script's short reason when it reports one. */
export function parseGatewayReport(raw: string, now: number): GatewayReport {
  const d = JSON.parse(raw) as { schema?: unknown; error?: unknown; keys?: unknown; missing?: unknown }
  if (!d || d.schema !== 'pitwall.gateway/1') throw new Error('bad output')
  if (str(d.error)) throw new Error(String(d.error))
  const keys: CrewKeyView[] = []
  for (const k of Array.isArray(d.keys) ? (d.keys as { alias?: unknown; spend?: unknown; max_budget?: unknown; expires?: unknown }[]) : []) {
    const alias = str(k?.alias)
    if (!alias) continue
    const spend = num(k.spend)
    const budget = num(k.max_budget)
    const pct = spend !== null && budget !== null && budget > 0 ? (spend / budget) * 100 : null
    const expiresAt = time(k.expires)
    keys.push({ alias, spendUsd: spend, budgetUsd: budget, pct, expiresAt, tone: keyTone(pct, expiresAt, now) })
  }
  const missing = Array.isArray(d.missing) ? (d.missing as unknown[]).map(str).filter((x): x is string => !!x) : []
  return { keys, missing }
}
