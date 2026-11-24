// Keeps the Crew section's figures: polls agnx (tasks, seats) and agni1 (gateway keys) while the
// section is on, never while it is off. Read-only toward both hosts. A failed read keeps nothing
// stale on screen: the section says the crew is unreachable and when it last answered.
import type { CrewGatewayView, CrewView } from '../../shared/types'
import { crewLive } from './live'
import { keyTone, parseCrewReport, parseGatewayReport, type CrewReport, type GatewayReport } from './parse'
import type { Runner } from './remote'
import { AGNX_PY, GATEWAY_PY } from './scripts'

export const CREW_POLL_MS = 15_000
export const GATEWAY_POLL_MS = 60_000
const TIMEOUT_MS = 25_000

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
  private timers: ReturnType<typeof setInterval>[] = []
  private busy = { crew: false, gateway: false }

  constructor(
    private readonly run: Runner,
    private readonly changed: () => void,
    private readonly log: (msg: string) => void
  ) {}

  configure(on: boolean, crewHost: string, gatewayHost: string): void {
    const moved = crewHost !== this.crewHost || gatewayHost !== this.gatewayHost
    this.crewHost = crewHost
    this.gatewayHost = gatewayHost
    if (moved) {
      this.crew = fresh()
      this.gateway = fresh()
    }
    if (on === this.enabled && !(on && moved)) return
    this.stop()
    this.enabled = on
    if (!on) {
      this.crew = fresh()
      this.gateway = fresh()
      this.changed()
      return
    }
    void this.pollCrew()
    void this.pollGateway()
    this.timers = [setInterval(() => void this.pollCrew(), CREW_POLL_MS), setInterval(() => void this.pollGateway(), GATEWAY_POLL_MS)]
    // Never keep the worker process alive on its own (tests, shutdown).
    for (const t of this.timers) (t as { unref?: () => void }).unref?.()
    this.changed()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  async pollCrew(): Promise<void> {
    if (!this.enabled || this.busy.crew) return
    this.busy.crew = true
    try {
      this.crew = await this.read(this.crewHost, AGNX_PY, (out) => parseCrewReport(out), this.crew, 'crew')
    } finally {
      this.busy.crew = false
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

  private async read<T>(host: string, script: string, parse: (out: string) => T, prev: Reading<T>, what: string): Promise<Reading<T>> {
    try {
      const out = await this.run(host, script, TIMEOUT_MS)
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
      reserveRoles: c.data?.reserveRoles ?? [],
      sources: c.data?.sources ?? [],
      orphanLeases: c.data?.orphanLeases ?? [],
      agni1Only: c.data?.agni1Only ?? false,
      lockDeployed: c.data?.lockDeployed ?? false,
      gateway,
      live: c.ok && c.data ? crewLive(c.data.tasks, c.data.lines, now) : null
    }
  }
}
