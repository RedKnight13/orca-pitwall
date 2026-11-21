// Next run time of a 5-field cron expression (minute hour day-of-month month day-of-week), in the
// machine's local time, as Claude Code schedules its cron jobs. Supports *, lists, ranges and steps.
// Anything else (names, @hourly, 6 fields) gives null: Pitwall then shows the schedule without a time.

interface Field {
  set: Set<number>
  /** The field starts with `*`: for the day rule below it does not restrict. */
  any: boolean
}

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7] // day of week, 0 and 7 are Sunday
]

function field(text: string, [lo, hi]: [number, number]): Field | null {
  const set = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    let from = lo
    let to = hi
    if (m[1] !== '*') {
      from = Number(m[2])
      to = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? hi : from
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1
    if (from < lo || to > hi || from > to || step < 1) return null
    for (let v = from; v <= to; v += step) set.add(v)
  }
  // As in Vixie cron, a day field starting with * (`*`, `*/2`) does not restrict for the day-of-month/day-of-week rule.
  return { set, any: text.startsWith('*') }
}

export interface Cron {
  minute: Field
  hour: Field
  dom: Field
  month: Field
  dow: Field
}

export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const f = parts.map((p, i) => field(p, RANGES[i]))
  if (f.some((x) => x === null)) return null
  const [minute, hour, dom, month, dow] = f as Field[]
  if (dow.set.has(7)) dow.set.add(0)
  return { minute, hour, dom, month, dow }
}

function dayMatches(c: Cron, d: Date): boolean {
  const dom = c.dom.set.has(d.getDate())
  const dow = c.dow.set.has(d.getDay())
  // Standard cron: when both day fields are restricted, either one matching is enough.
  if (!c.dom.any && !c.dow.any) return dom || dow
  return dom && dow
}

/** Searches this far ahead at most: a schedule that never fires (Feb 30) gives null, not a hang. */
const HORIZON_DAYS = 366 * 5

/** The first time strictly after `after` (ms) that the expression fires, or null. */
export function nextCronTime(expr: string, after: number): number | null {
  const c = parseCron(expr)
  if (!c || !Number.isFinite(after)) return null
  const d = new Date(after)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const limit = after + HORIZON_DAYS * 86_400_000
  while (d.getTime() <= limit) {
    if (!c.month.set.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!dayMatches(c, d)) {
      d.setDate(d.getDate() + 1)
      d.setHours(0, 0, 0, 0)
      continue
    }
    if (!c.hour.set.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!c.minute.set.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0)
      continue
    }
    return d.getTime()
  }
  return null
}
