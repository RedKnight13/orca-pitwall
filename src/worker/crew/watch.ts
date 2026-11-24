// Keeps the Crew section's figures: polls agnx (tasks, seats) and agni1 (gateway keys) while the
// section is on, never while it is off. Read-only toward every host. A failed read keeps nothing
// stale on screen: the section says the crew is unreachable and when it last answered.
//
// agnx: the event logs are tailed. Each poll sends the last cursor; the script reads only what was
// appended, and the lines are merged here (per task, bounded). A "full" answer replaces them.
// Card hosts (agni1, agni2): temperature and VRAM, only while the panel shows the Crew section and a
// task runs, every GPU_POLL_MS at most.
import type { CrewGatewayView, CrewView } from '../../shared/types'
import { cardReading, GPU_PY, parseGpuReport, seatPlacement, type GpuCard } from './gpu'
import { crewLive } from './live'
import { crewReportFrom, keyTone, parseGatewayReport, type CrewReport, type GatewayReport, type RawReport } from './parse'
import type { Runner } from './remote'
import { agnxScript, GATEWAY_PY, type AgnxCursor } from './scripts'

export const CREW_POLL_MS = 15_000
export const GATEWAY_POLL_MS = 60_000
/** Card temperatures: at most this often, and only while someone looks. */
export const GPU_POLL_MS = 20_000
/** The panel says it is looking at least this often; silence for longer means it is gone. */
export const VISIBLE_LEASE_MS = 90_000
/** A reading older than this is not shown. */
const GPU_STALE_MS = 75_000
/** Merged event lines kept, newest last. */
const MAX_EVENTS = 4000
const TIMEOUT_MS = 25_000
const GPU_TIMEOUT_MS = 15_000

type RawEvent = Record<string, unknown>

/** Merges a script answer into the events kept so far: "delta" appends, anything else replaces. */
export function mergeEvents(prev: RawEvent[], d: RawReport, keep: Set<string>): RawEvent[] {
  const fresh = (Array.isArray(d.events) ? d.events : []).filter((e): e is RawEvent => !!e && typeof e === 'object')
  const all = d.mode === 'delta' ? [...prev.filter((e) => keep.has(String(e.task))), ...fresh] : fresh
  const sizes = d.sizes && typeof d.sizes === 'object' ? (d.sizes as Record<string, unknown>) : {}
  const out = all.length > MAX_EVENTS ? all.slice(-MAX_EVENTS) : all
  // A running seat's output grows: the script stats it again by the line's ref.
  return out.map((e) => (typeof e.ref === 'string' && typeof sizes[e.ref] === 'number' ? { ...e, output_bytes: sizes[e.ref] } : e))
}

/** The refs of seat runs with a start and no stop yet, for the script to stat again. */
export function openRefs(events: RawEvent[], running: Set<string>): string[] {
  const open = new Map<string, string>()
  for (const e of events) {
    if (!('seat_event' in e) || !running.has(String(e.task))) continue
    const k = [e.task, e.seat, e.slot, e.stage, e.attempt].join('|')
    if (e.seat_event === 'start' && typeof e.ref === 'string') open.set(k, e.ref)
    else if (e.seat_event === 'stop') open.delete(k)
  }
  return [...open.values()]
}

/** The cursor the script printed, checked: relative log paths to [inode, offset]. */
function cursorOf(v: unknown): AgnxCursor['files'] | null {
  const f = v && typeof v === 'object' ? (v as { files?: unknown }).files : null
  if (!f || typeof f !== 'object') return null
  const out: AgnxCursor['files'] = {}
  for (const [k, c] of Object.entries(f as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(k) || k.includes('..')) return null
    if (!Array.isArray(c) || c.length !== 2 || !c.every((x) => Number.isSafeInteger(x) && x >= 0)) return null
    out[k] = [c[0], c[1]]
  }
  return out
}

interface Reading<T> {
  at: number | null
  ok: boolean
  error: string | null
  data: T | null
}

const fresh = <T>(): Reading<T> => ({ at: null, ok: false, error: null, data: null })

export class CrewWatch {
  enabled = false
  crewHost = 'agnx'
  gatewayHost = 'agni1'
  private crew: Reading<CrewReport> = fresh()
  private gateway: Reading<GatewayReport> = fresh()
  private gpu = new Map<string, Reading<GpuCard[]>>()
  private events: RawEvent[] = []
  private cursor: AgnxCursor | null = null
  private visibleUntil = 0
  private lastGpu = 0
  private timers: ReturnType<typeof setInterval>[] = []
  private busy = { crew: false, gateway: false, gpu: false }

  constructor(
    private readonly run: Runner,
    private readonly changed: () => void,
    private readonly log: (msg: string) => void
  ) {}

  configure(on: boolean, crewHost: string, gatewayHost: string): void {
    const moved = crewHost !== this.crewHost || gatewayHost !== this.gatewayHost
    this.crewHost = crewHost
    this.gatewayHost = gatewayHost
    if (moved) this.forget()
    if (on === this.enabled && !(on && moved)) return
    this.stop()
    this.enabled = on
    if (!on) {
      this.forget()
      this.changed()
      return
    }
    void this.pollCrew()
    void this.pollGateway()
    this.timers = [
      setInterval(() => void this.pollCrew(), CREW_POLL_MS),
      setInterval(() => void this.pollGateway(), GATEWAY_POLL_MS),
      setInterval(() => void this.pollGpu(), GPU_POLL_MS)
    ]
    // Never keep the worker process alive on its own (tests, shutdown).
    for (const t of this.timers) (t as { unref?: () => void }).unref?.()
    this.changed()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  private forget(): void {
    this.crew = fresh()
    this.gateway = fresh()
    this.gpu.clear()
    this.events = []
    this.cursor = null
    this.lastGpu = 0
  }

  /** The panel shows the Crew section (or stopped showing it). Showing it holds for VISIBLE_LEASE_MS unless renewed. */
  setVisible(visible: boolean, now = Date.now()): void {
    const was = this.visible(now)
    this.visibleUntil = visible ? now + VISIBLE_LEASE_MS : 0
    if (visible && !was) void this.pollGpu()
  }

  visible(now = Date.now()): boolean {
    return now < this.visibleUntil
  }

  private running(): boolean {
    return !!this.crew.ok && !!this.crew.data?.tasks.some((t) => t.status === 'running')
  }

  /** The hosts whose cards the running crew sits on, from the crew config. */
  gpuHosts(): string[] {
    const d = this.crew.data
    if (!d) return []
    const hosts = new Set<string>()
    for (const seat of ['leader', 'helper', 'reviewer']) {
      const p = seatPlacement(d.models, d.agni1Only, seat)
      if (p) hosts.add(p.host)
    }
    return [...hosts].sort()
  }

  async pollCrew(): Promise<void> {
    if (!this.enabled || this.busy.crew) return
    this.busy.crew = true
    try {
      this.crew = await this.read(this.crewHost, agnxScript(this.cursor), (out) => this.take(out), this.crew, 'crew')
      if (!this.crew.ok) this.cursor = null
    } finally {
      this.busy.crew = false
    }
    this.changed()
    // A task just started while someone looks: read the cards now rather than at the next tick.
    if (!this.lastGpu) void this.pollGpu()
  }

  /** One agnx answer: merge its events into those kept, and keep its cursor for the next poll. */
  private take(out: string): CrewReport {
    const d = JSON.parse(out) as RawReport
    if (!d || d.schema !== 'pitwall.crew/1') throw new Error('bad output')
    const ids = new Set((Array.isArray(d.tasks) ? d.tasks : []).map((t) => String((t as { id?: unknown })?.id)))
    this.events = mergeEvents(this.events, d, ids)
    const report = crewReportFrom({ ...d, events: this.events })
    const files = cursorOf(d.cursor)
    const running = new Set(report.tasks.filter((t) => t.status === 'running').map((t) => t.id))
    this.cursor = files ? { files, open: openRefs(this.events, running) } : null
    return report
  }

  /** Card temperatures and VRAM: only while the panel shows the section and a task runs, and never sooner than GPU_POLL_MS. */
  async pollGpu(now = Date.now()): Promise<void> {
    if (!this.enabled || this.busy.gpu || !this.visible(now) || !this.running()) return
    if (this.lastGpu && now - this.lastGpu < GPU_POLL_MS - 1000) return
    const hosts = this.gpuHosts()
    if (!hosts.length) return
    this.busy.gpu = true
    this.lastGpu = now
    try {
      const reads = await Promise.all(hosts.map((h) => this.read(h, GPU_PY, parseGpuReport, this.gpu.get(h) ?? fresh<GpuCard[]>(), 'gpu', GPU_TIMEOUT_MS)))
      hosts.forEach((h, i) => this.gpu.set(h, reads[i]))
    } finally {
      this.busy.gpu = false
    }
    this.changed()
  }

  async pollGateway(): Promise<void> {
    if (!this.enabled || this.busy.gateway) return
    this.busy.gateway = true
    try {
      this.gateway = await this.read(this.gatewayHost, GATEWAY_PY, (out) => parseGatewayReport(out, Date.now()), this.gateway, 'gateway')
    } finally {
      this.busy.gateway = false
    }
    this.changed()
  }

  private async read<T>(host: string, script: string, parse: (out: string) => T, prev: Reading<T>, what: string, timeout = TIMEOUT_MS): Promise<Reading<T>> {
    try {
      const out = await this.run(host, script, timeout)
      return { at: Date.now(), ok: true, error: null, data: parse(out.trim().split('\n').pop() ?? '') }
    } catch (err) {
      const reason = err instanceof SyntaxError ? 'bad output' : (err as Error).message || 'failed'
      // Log the change, not every poll.
      if (prev.ok || prev.error !== reason) this.log(`${what} read from ${host} failed: ${reason}`)
      return { at: prev.at, ok: false, error: reason, data: null }
    }
  }

  view(now: number): CrewView | null {
    if (!this.enabled) return null
    const c = this.crew
    const g = this.gateway
    const gateway: CrewGatewayView = {
      at: g.at,
      reachable: g.ok,
      error: g.ok ? null : g.error,
      // Tones follow the clock: a key can cross 7 days left between reads.
      keys: g.data ? g.data.keys.map((k) => ({ ...k, tone: keyTone(k.pct, k.expiresAt, now) })) : [],
      missing: g.data?.missing ?? []
    }
    return {
      host: this.crewHost,
      at: c.at,
      reachable: c.ok,
      error: c.ok ? null : c.error,
      tasks: c.data?.tasks ?? [],
      more: c.data?.more ?? 0,
      seats: c.data?.seats ?? [],
      agni1Only: c.data?.agni1Only ?? false,
      lockDeployed: c.data?.lockDeployed ?? false,
      gateway,
      live: c.ok && c.data ? crewLive(c.data.tasks, c.data.lines, now, (seat) => this.hardware(seat, now)) : []
    }
  }

  /** A seat's card and, when its host answered lately, the reading. No config, no card. */
  private hardware(seat: string, now: number) {
    const d = this.crew.data
    const p = d ? seatPlacement(d.models, d.agni1Only, seat) : null
    if (!p) return null
    const r = this.gpu.get(p.host)
    const live = r && r.ok && r.data && r.at !== null && now - r.at <= GPU_STALE_MS ? cardReading(new Map([[p.host, r.data]]), p) : null
    return { card: p.card, host: p.host, tempC: live?.tempC ?? null, vramGb: live?.vramGb ?? null }
  }
}
