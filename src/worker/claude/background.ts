// What a Claude Code session still has pending in the background: shells started with
// run_in_background (or sent there), Monitor watches, cron jobs (CronCreate) and the /loop wakeup
// (ScheduleWakeup). Fed by the transcript parser, row by row; keeps only what is still pending.
// Background agents are not here: the Subagents block already shows them.
//
// When unsure, an item goes rather than stays: a shell shown running that is gone is a wrong number.
import type { BackgroundView } from '../../shared/types'
import { nextCronTime } from '../cron'
import { mask, oneLine } from '../summarize'

export interface BgItem extends Omit<BackgroundView, 'overdue'> {
  /** The cron expression, to find the next run after each one. */
  cron: string | null
  /** How late Claude Code may still run it on purpose, beyond dueAt (when the job's own offset is not known). */
  slack: number
  /** The job's fixed shift from its cron times, learned from the first next-run time Claude Code reports. */
  offset: number
}

export interface BgEvent {
  at: number
  kind: 'done' | 'error'
  text: string
}

/** A schedule past due while its agent sits idle this long is not going to fire: the session is gone. */
export const STALE_MS = 20 * 60 * 1000
/** After a compaction Claude Code lists each running task in a task_status row, within about two seconds. */
const CENSUS_MS = 10_000
const WAKEUP = 'wakeup'
const DURABLE = 'Kept across restarts'
const ID = '([A-Za-z0-9_-]{4,64})'
const TRACKED_USES = new Set(['Bash', 'Monitor', 'CronCreate', 'CronDelete', 'ScheduleWakeup', 'TaskStop', 'KillShell', 'KillBash'])
/** Result text of a Bash call that went to the background: started there, or moved after a timeout. */
const SENT_BACK = new RegExp(`^\\s*Command running in background with ID: ${ID}`)
const TIMED_OUT = new RegExp(`^\\s*Command did not complete[^(]*\\(ID: ${ID}\\)`)
const LOOP_SENTINEL = /^<<autonomous-loop(?:-dynamic)?>>$/

interface PendingUse {
  name: string
  input: Record<string, unknown>
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function label(text: string | null, fallback: string): string {
  return text ? oneLine(mask(text), 80) : fallback
}

/** What a /loop wakeup or cron will do: its prompt, unless that is only the autonomous-loop marker. */
function promptLabel(prompt: string | null, reason: string | null): string {
  if (prompt && LOOP_SENTINEL.test(prompt.trim())) return reason ? `autonomous loop: ${label(reason, '')}` : 'autonomous loop'
  return label(prompt ?? reason, 'scheduled prompt')
}

/** The prompt line of a turn a cron job or the wakeup started. */
export function fireLabel(row: Record<string, unknown>): string {
  return `${isLoopFire(row) ? 'loop' : 'scheduled'}: ${oneLine(promptLabel(str(row.prompt), null), 70)}`
}

function isLoopFire(row: Record<string, unknown>): boolean {
  return row.taskKind === 'loop' || row.cronKind === 'loop' || /\/loop wakeup/.test(str(row.content) ?? '')
}

/**
 * Claude Code shifts each job by a fixed offset: a recurring job up to half its period late (at most
 * 30 minutes), a one-shot on :00 or :30 up to 90 s early. The first next-run time it reports gives
 * that offset; with it, later runs are exact. Without it, a recurring job gets that much slack.
 */
function timing(cron: string | null, recurring: boolean, reported: number | null, at: number): { dueAt: number | null; offset: number; slack: number } {
  const slot = cron ? nextCronTime(cron, at) : null
  if (reported !== null) {
    const base = cron ? slotOf(cron, reported) : null
    if (base !== null) return { dueAt: reported, offset: reported - base, slack: 0 }
    // No slot fits: trust the reported time, and give later runs the full slack.
    return { dueAt: reported, offset: 0, slack: recurring ? maxShift(cron, reported) : 0 }
  }
  return { dueAt: slot, offset: 0, slack: recurring ? maxShift(cron, slot) : 0 }
}

/**
 * The cron time a run at `runAt` belongs to: the latest one at most 2 minutes after it (one-shots
 * run up to 90 s early) and at most 31 minutes before it (the largest shift). Null if none.
 */
function slotOf(cron: string, runAt: number): number | null {
  let slot: number | null = null
  let t = nextCronTime(cron, runAt - 31 * 60_000 - 1)
  for (let i = 0; t !== null && t <= runAt + 120_000 && i < 64; i++) {
    slot = t
    t = nextCronTime(cron, t)
  }
  return slot
}

function maxShift(cron: string | null, dueAt: number | null): number {
  if (!cron || dueAt === null) return 0
  const after = nextCronTime(cron, dueAt)
  return after === null ? 0 : Math.min((after - dueAt) / 2, 30 * 60_000)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * "Next run: Nov 21 6:43pm" in a CronCreate result, as local time: the only place the run time is when
 * the result is read from a blob row. The year is the one that puts it closest after `at`.
 */
export function nextRunOf(text: string, at: number): number | null {
  const m = /Next run: ([A-Z][a-z]{2}) (\d{1,2}) (\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text)
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  if (month < 0) return null
  const hour = (Number(m[3]) % 12) + (m[5].toLowerCase() === 'pm' ? 12 : 0)
  const year = new Date(at).getFullYear()
  for (const y of [year, year + 1]) {
    const t = new Date(y, month, Number(m[2]), hour, Number(m[4])).getTime()
    // Up to 90 s early for a one-shot, and the text has minutes only.
    if (t >= at - 3 * 60_000) return t
  }
  return null
}

/** "Auto-expires after 30 days" in the result: when a recurring job ends on its own. Older versions said 7. */
function expiry(text: string, at: number): number | null {
  const m = /Auto-expires after (\d+) days?/.exec(text)
  return m ? at + Number(m[1]) * 86_400_000 : null
}

/** Text Claude Code injects for background events; a person's prompt does not start like this. */
export function isInjected(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('<task-notification>') || t.startsWith('<system-reminder>') || t.startsWith('[SYSTEM NOTIFICATION')
}

/** The <task-notification> blocks in a text that report a task ended: id and status. */
export function endedTasks(text: string): { id: string; status: string }[] {
  if (!text.includes('<task-notification>')) return []
  const out: { id: string; status: string }[] = []
  const re = /<task-notification>([\s\S]*?)<\/task-notification>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(m[1])
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(m[1])
    // Monitor events and goal check-ins carry no status: the task goes on.
    if (id && status) out.push({ id: id[1], status: status[1] })
  }
  return out
}

export class BackgroundTracker {
  readonly items = new Map<string, BgItem>()
  private readonly uses = new Map<string, PendingUse>()
  /** Task ids already reported ended: a start read after its end (it happens) must not bring one back. */
  private readonly ended = new Set<string>()
  /** The running-task list Claude Code writes after a compaction, being collected. */
  private census: { at: number; seen: Set<string> } | null = null
  /** Recent task_status rows, in case some come just before the compaction row. */
  private readonly recentStatus: { id: string; at: number }[] = []

  constructor(private readonly onEvent: (e: BgEvent) => void = () => {}) {}

  /** A tool call. Only the ones that start or stop background work are kept, until their result. */
  use(id: string, name: string, input: unknown): void {
    if (!TRACKED_USES.has(name)) return
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    this.uses.set(id, { name, input: i })
    if (this.uses.size > 256) this.uses.delete(this.uses.keys().next().value as string)
  }

  /**
   * A tool result. `textOf` reads the result text (only called for the calls kept above),
   * `meta` is the row's toolUseResult (absent on blob rows: the text is read instead), `summary`
   * the parser's masked summary of the call.
   */
  result(toolUseId: string, isError: boolean, textOf: () => string, meta: unknown, at: number, summary: string | null): void {
    const use = this.uses.get(toolUseId)
    if (!use) return
    this.uses.delete(toolUseId)
    const { name, input } = use
    const r = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
    if (name === 'TaskStop' || name === 'KillShell' || name === 'KillBash') {
      // Even a failed stop means the task is not running (it had already ended, or never existed).
      const id = str(input.task_id) ?? str(input.shell_id) ?? str(r.task_id)
      if (id) this.end(id, 'stopped', at)
      return
    }
    if (isError) return
    let memo: string | null = null
    const text = () => (memo ??= textOf())
    if (name === 'Bash') {
      // Any Bash call can end up in the background (run_in_background, a timeout, or the person sending it there).
      const id = str(r.backgroundTaskId) ?? (SENT_BACK.exec(text()) ?? TIMED_OUT.exec(text()))?.[1] ?? null
      if (id) this.add({ ...base(id, 'shell', at), label: summary || label(str(input.description) ?? str(input.command), 'background command') })
      return
    }
    if (name === 'Monitor') {
      const m = new RegExp(`^\\s*Monitor started \\(task ${ID}(?:, expires in (\\d+)(ms|s|m|h))?`).exec(text())
      const id = str(r.taskId) ?? m?.[1] ?? null
      if (!id) return
      const unit = m?.[3] === 'h' ? 3_600_000 : m?.[3] === 'm' ? 60_000 : m?.[3] === 's' ? 1000 : 1
      const timeout = num(r.timeoutMs) ?? (m?.[2] ? Number(m[2]) * unit : null)
      const persistent = r.persistent === true || input.persistent === true
      this.add({ ...base(id, 'monitor', at), label: label(str(input.description) ?? str(input.command), 'monitor'), endsAt: !persistent && timeout ? at + timeout : null })
      return
    }
    if (name === 'CronCreate') {
      const m = new RegExp(`^\\s*Scheduled (recurring job|one-shot task) ${ID} \\(([^)]*)\\)`).exec(text())
      const id = str(r.id) ?? m?.[2] ?? null
      if (!id) return
      const cron = str(input.cron)
      const recurring = typeof r.recurring === 'boolean' ? r.recurring : m ? m[1] === 'recurring job' : input.recurring !== false
      const fireAt = num(r.nextFireAt) ?? nextRunOf(text(), at)
      this.add({
        ...base(id, 'cron', at),
        ...timing(cron, recurring, fireAt === null ? null : Math.round(fireAt), at),
        label: promptLabel(str(input.prompt), null),
        schedule: str(r.humanSchedule) ?? m?.[3] ?? cron,
        recurring,
        endsAt: recurring ? (num(r.expiresAt) ?? expiry(text(), at)) : null,
        detail: r.durable === true ? DURABLE : null,
        cron
      })
      return
    }
    if (name === 'CronDelete') {
      const id = str(input.id) ?? str(r.id)
      if (id) this.items.delete(id)
      return
    }
    if (name === 'ScheduleWakeup') {
      if (input.stop === true || r.stopped === true) {
        this.items.delete(WAKEUP)
        return
      }
      const inText = /\(in (\d+)s\)/.exec(text())
      const delay = num(input.delaySeconds)
      const due = num(r.scheduledFor) ?? (inText ? at + Number(inText[1]) * 1000 : delay !== null ? at + Math.min(3600, Math.max(60, delay)) * 1000 : null)
      this.setWakeup(due === null ? null : Math.round(due), str(input.prompt), str(input.reason), at)
    }
  }

  /** Injected text that may hold task notifications: a user row, a queued command, a blob's text. */
  text(text: string, at: number): void {
    for (const { id, status } of endedTasks(text)) this.end(id, status, at)
  }

  /** A `scheduled_task_fire` system row: a cron job or the wakeup ran. */
  fire(row: Record<string, unknown>, at: number): void {
    const id = str(row.taskId)
    const item = id ? this.items.get(id) : undefined
    if (item && item.kind === 'cron') {
      if (!item.recurring) this.items.delete(item.id)
      else {
        // Not known yet: the run itself shows the job's offset (unless it waited for the agent; then no slot fits).
        if (item.slack && item.cron) {
          const ran = slotOf(item.cron, at)
          if (ran !== null) {
            item.offset = at - ran
            item.slack = 0
          }
        }
        // Its next cron time after the one that ran, shifted by the job's offset.
        const slot = item.cron ? nextCronTime(item.cron, Math.max(at, item.dueAt ?? 0) - item.offset) : null
        item.dueAt = slot === null ? null : slot + item.offset
        if (item.slack) item.slack = maxShift(item.cron, item.dueAt)
      }
      return
    }
    if (isLoopFire(row)) this.items.delete(WAKEUP)
  }

  /**
   * The session process started (a SessionStart hook ran): the last one's shells, monitors, wakeup and
   * session-only cron jobs died with it. A session_cron_carry row after this brings back what Claude Code keeps.
   */
  started(): void {
    for (const [id, item] of this.items) if (item.detail !== DURABLE || item.kind !== 'cron') this.items.delete(id)
  }

  /** A compaction: the task_status rows that follow list every task still running. */
  compacted(at: number): void {
    this.closeCensus()
    const seen = new Set(this.recentStatus.filter((s) => at - s.at <= CENSUS_MS).map((s) => s.id))
    this.census = { at, seen }
  }

  /** Called with each row's time: closes the census once its window has passed. */
  tick(at: number): void {
    if (this.census && at > this.census.at + CENSUS_MS) this.closeCensus()
  }

  private closeCensus(): void {
    const c = this.census
    if (!c) return
    this.census = null
    for (const [id, item] of this.items)
      if (item.kind === 'shell' && (item.startedAt === null || item.startedAt <= c.at) && !c.seen.has(id)) this.items.delete(id)
  }

  /** Attachments Claude Code writes after a compaction or a resume: the state it carries over. */
  attachment(att: Record<string, unknown>, at: number): void {
    if (att.type === 'session_cron_carry') {
      const w = (att.wakeup && typeof att.wakeup === 'object' ? att.wakeup : null) as Record<string, unknown> | null
      if (w) this.setWakeup(num(w.scheduledFor), str(w.prompt), str(w.reason), this.items.get(WAKEUP)?.startedAt ?? null)
      else this.items.delete(WAKEUP)
      if (Array.isArray(att.tasks)) this.carryCrons(att.tasks, at)
      return
    }
    if (att.type === 'task_status') {
      const id = str(att.taskId)
      const status = str(att.status)
      if (!id || !status) return
      if (status !== 'running' && status !== 'pending') return this.end(id, status, at)
      this.recentStatus.push({ id, at })
      if (this.recentStatus.length > 64) this.recentStatus.shift()
      if (this.census) this.census.seen.add(id)
      const shell = (att.shell && typeof att.shell === 'object' ? att.shell : {}) as Record<string, unknown>
      if (att.taskType === 'local_bash' && !this.items.has(id)) this.add({ ...base(id, 'shell', null), label: label(str(att.description) ?? str(shell.command), 'background command') })
    }
  }

  private carryCrons(tasks: unknown[], at: number): void {
    const carried = new Map<string, Record<string, unknown>>()
    for (const t of tasks) {
      if (!t || typeof t !== 'object') continue
      const id = str((t as Record<string, unknown>).id) ?? str((t as Record<string, unknown>).taskId)
      // A task Pitwall cannot name: the carried list cannot be trusted to replace what is known.
      if (!id) return
      carried.set(id, t as Record<string, unknown>)
    }
    for (const [id, item] of this.items) if (item.kind === 'cron' && !carried.has(id)) this.items.delete(id)
    for (const [id, t] of carried) {
      if (this.items.has(id)) continue
      const cron = str(t.cron)
      const recurring = t.recurring === true
      const created = num(t.createdAt)
      const fireAt = num(t.nextFireAt)
      this.add({
        ...base(id, 'cron', created),
        ...timing(cron, recurring, fireAt === null ? null : Math.round(fireAt), at),
        label: promptLabel(str(t.prompt), null),
        schedule: str(t.humanSchedule) ?? cron,
        recurring,
        endsAt: recurring ? num(t.expiresAt) : null,
        detail: t.durable === true ? DURABLE : null,
        cron
      })
    }
  }

  private setWakeup(dueAt: number | null, prompt: string | null, reason: string | null, at: number | null): void {
    const sentinel = !!prompt && LOOP_SENTINEL.test(prompt.trim())
    this.items.set(WAKEUP, { ...base(WAKEUP, 'wakeup', at), label: promptLabel(prompt, reason), dueAt, detail: reason && !sentinel ? oneLine(mask(reason), 120) : null })
  }

  private add(item: BgItem): void {
    if (this.ended.has(item.id)) return
    this.items.set(item.id, item)
  }

  private end(id: string, status: string, at: number): void {
    this.ended.add(id)
    if (this.ended.size > 1024) this.ended.delete(this.ended.values().next().value as string)
    const item = this.items.get(id)
    if (!item || (item.kind !== 'shell' && item.kind !== 'monitor')) return
    this.items.delete(id)
    const what = item.kind === 'shell' ? 'background' : 'monitor'
    if (status === 'failed') this.onEvent({ at, kind: 'error', text: `${what} ${item.label} failed` })
    else this.onEvent({ at, kind: 'done', text: `${what} ${item.label} ${status === 'completed' ? 'finished' : status}` })
  }

  /**
   * What is pending at `now`. `idleSince` is when the agent went idle (null while it works or waits
   * on the person): Claude Code only fires schedules when idle, so a schedule overdue while idle for
   * long is one whose session is gone, and a schedule due while busy waits.
   */
  pending(now: number, idleSince: number | null): BackgroundView[] {
    if (this.census && now > this.census.at + CENSUS_MS) this.closeCensus()
    const out: BackgroundView[] = []
    for (const item of this.items.values()) {
      if (item.endsAt !== null && now > item.endsAt + 60_000) continue
      let overdue = false
      if (item.dueAt !== null) {
        const late = item.dueAt + item.slack
        if (idleSince !== null && now - Math.max(late, idleSince) > STALE_MS) continue
        overdue = now > late + 60_000
      }
      const { cron: _cron, slack: _slack, offset: _offset, ...view } = item
      out.push({ ...view, overdue })
    }
    const running = (x: BackgroundView) => x.kind === 'shell' || x.kind === 'monitor'
    return out.sort((a, b) =>
      running(a) !== running(b) ? (running(a) ? -1 : 1) : running(a) ? (a.startedAt ?? 0) - (b.startedAt ?? 0) : (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
    )
  }
}

function base(id: string, kind: BackgroundView['kind'], startedAt: number | null): BgItem {
  return { id, kind, label: '', startedAt, dueAt: null, schedule: null, recurring: false, endsAt: null, detail: null, cron: null, slack: 0, offset: 0 }
}
