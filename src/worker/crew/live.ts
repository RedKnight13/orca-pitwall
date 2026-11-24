// Who in the crew is working, as mascots: the stage strip, one row per mascot, the hand-off and the
// finale. Pure: recorded events in, a view out. It reads two kinds of line from events.jsonl:
//   - stage lines (every crew release): one line when a stage ends, with its outcome;
//   - seat lines (Agni-crew #42, schema agni.crew.seat_event/1 exactly): a start and a stop per seat run.
// With seat lines for a task, the rows follow them; without, they follow the task's current stage.
// Bubbles are built from fixed phrases and file names only: no free text from the crew reaches them.
import type { CrewLiveView, CrewMascotId, CrewMascotView, CrewTaskView } from '../../shared/types'

export const SEAT_SCHEMA = 'agni.crew.seat_event/1'

/** A finished task keeps its 🎉 or 💥 this long. */
export const FINALE_MS = 10 * 60_000

export interface StageLine {
  kind: 'stage'
  task: string
  stage: string
  attempt: number
  outcome: string
  at: number
  seconds: number
  mode: string | null
  gate: string | null
  decision: string | null
  verdict: string | null
  testExit: number | null
  inputTokens: number | null
  refereeCalls: number
  evidence: string[]
}

export interface SeatLine {
  kind: 'seat'
  task: string
  event: 'start' | 'stop'
  stage: string
  attempt: number
  seat: string
  slot: '' | 'helper_'
  at: number
  output: string | null
  outputBytes: number | null
  seconds: number
  exit: number | null
  timedOut: boolean | null
}

export type LiveLine = StageLine | SeatLine

const MASCOTS: Record<CrewMascotId, { face: string; name: string; role: string; card: string | null }> = {
  qwen: { face: '🐉', name: 'Qwen', role: 'leader', card: 'R9700' },
  gemma: { face: '🦊', name: 'Gemma', role: 'second author', card: 'RX 9070 XT' },
  inkling: { face: '🐙', name: 'Inkling', role: 'reviewer', card: 'agni2' },
  jev: { face: '🦉', name: 'Jev', role: 'referee', card: null },
  venice: { face: '🎭', name: 'Venice', role: 'advisor', card: null },
  codex: { face: '🐎', name: 'Codex', role: 'cavalry', card: null },
  tests: { face: '🧪', name: 'Tests', role: 'test runner', card: null }
}

/** Pipeline order, which is also the strip's order. */
const ORDER: CrewMascotId[] = ['qwen', 'gemma', 'codex', 'tests', 'inkling', 'jev', 'venice']

/** Always on the strip; the others join when the task calls them. */
const CORE: CrewMascotId[] = ['qwen', 'gemma', 'tests', 'inkling']

const ACTION: Record<string, string> = {
  admit: 'reading',
  intake: 'reading',
  plan: 'planning',
  build: 'writing',
  author: 'writing',
  cavalry: 'writing',
  grade: 'testing',
  review: 'reviewing',
  decide: 'thinking',
  advise: 'thinking',
  finish: 'wrapping up'
}

/** The crew.toml seat names of #42's seat lines. */
const SEAT_MASCOT: Record<string, CrewMascotId> = { leader: 'qwen', helper: 'gemma', reviewer: 'inkling', inkling: 'inkling', cavalry: 'codex', tests: 'tests' }

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const time = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}

/** One short lowercase-ish token, as the crew writes its outcomes and modes. Anything else is dropped. */
const WORD = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const word = (v: unknown): string | null => (typeof v === 'string' && WORD.test(v) ? v : null)

/** A file name, never a path and never contents. */
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export function fileName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const n = v.replace(/\\/g, '/').split('/').pop() ?? ''
  return FILE.test(n) && /\.[A-Za-z0-9]{1,8}$/.test(n) ? n : null
}

/** Reads one event the agnx script sent. Stage lines need a stage; seat lines need the exact #42 schema. */
export function parseLiveLine(raw: unknown): LiveLine | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const task = str(e.task)
  const at = time(e.ts)
  if (!task || at === null) return null
  if ('seat_event' in e) {
    // Version check: a later schema may mean other fields; it waits for a Pitwall that knows it.
    if (e.schema !== SEAT_SCHEMA) return null
    const event = e.seat_event === 'start' || e.seat_event === 'stop' ? e.seat_event : null
    const seat = word(e.seat)
    const stage = word(e.stage)
    if (!event || !seat || !stage) return null
    return {
      kind: 'seat',
      task,
      event,
      stage,
      attempt: num(e.attempt) ?? 0,
      seat,
      slot: e.slot === 'helper_' ? 'helper_' : '',
      at,
      output: fileName(e.output),
      outputBytes: num(e.output_bytes),
      seconds: Math.max(0, num(e.seconds) ?? 0),
      exit: num(e.exit),
      timedOut: typeof e.timed_out === 'boolean' ? e.timed_out : null
    }
  }
  const stage = word(e.stage)
  if (!stage) return null
  return {
    kind: 'stage',
    task,
    stage,
    attempt: num(e.attempt) ?? 0,
    outcome: word(e.outcome) ?? '',
    at,
    seconds: Math.max(0, num(e.seconds) ?? 0),
    mode: word(e.mode),
    gate: word(e.gate),
    decision: word(e.decision),
    verdict: word(e.verdict),
    testExit: num(e.test_exit),
    inputTokens: num(e.input_tokens),
    refereeCalls: num(e.referee_calls) ?? 0,
    evidence: Array.isArray(e.evidence) ? e.evidence.map(fileName).filter((x): x is string => !!x) : []
  }
}

/** Which mascot a stage belongs to. Build is the leader's; the helper joins it in a split plan. */
function stageMascot(stage: string, gate: string | null): CrewMascotId | null {
  if (stage === 'grade') return 'tests'
  if (stage === 'review') return 'inkling'
  if (stage === 'cavalry') return 'codex'
  if (stage === 'advise') return 'venice'
  if (stage === 'author') return 'gemma'
  if (stage === 'decide') return gate === 'jev' ? 'jev' : 'qwen'
  if (stage === 'ask_owner') return null
  return ACTION[stage] ? 'qwen' : null
}

const human = (w: string) => w.replace(/_/g, ' ')

function kTokens(n: number): string {
  return n >= 1000 ? `${(Math.round(n / 100) / 10).toString()}k` : String(Math.round(n))
}

function secs(s: number): string {
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : `${Math.round(n / 1024)} kB`
}

/** The last guard on a bubble: one short line, nothing that reads as code. */
const CODE_HINT = /[{}<>;=`$\\|]|\n|\b(def|function|return|import|class|const|let|var)\b/
export function safeBubble(parts: (string | null | undefined)[]): string | null {
  const text = parts.filter(Boolean).join(' · ')
  if (!text || CODE_HINT.test(text)) return null
  return text.length > 72 ? text.slice(0, 71) + '…' : text
}

/** A stage line as a few words: fixed phrases, the crew's own outcome words, and file names. */
function stageBubble(l: StageLine, id: CrewMascotId): string | null {
  const files = (pick: RegExp) => l.evidence.filter((f) => pick.test(f)).slice(0, 2).join(', ') || null
  switch (l.stage) {
    case 'admit':
      return safeBubble([l.outcome === 'primary' ? 'checked the seats' : `seats: ${human(l.outcome)}`])
    case 'intake':
      return safeBubble([l.outcome === 'ok' ? 'read the task' : human(l.outcome)])
    case 'plan':
      if (l.outcome === 'stop') return safeBubble(['stopped at the plan'])
      return safeBubble([l.mode === 'helper' ? 'planned a split with Gemma' : 'planned it solo', l.refereeCalls ? `${l.refereeCalls} referee call${l.refereeCalls === 1 ? '' : 's'}` : null])
    case 'build':
    case 'author':
      if (id === 'gemma') return safeBubble([l.outcome === 'committed' ? 'wrote its share' : human(l.outcome)])
      return safeBubble([l.outcome === 'committed' ? `committed attempt ${l.attempt}` : l.outcome === 'stop' ? 'stopped' : human(l.outcome)])
    case 'cavalry':
      return safeBubble([`cavalry ${human(l.outcome)}`])
    case 'grade':
      return safeBubble([l.outcome === 'tests_pass' ? 'tests pass' : l.outcome === 'tests_fail' ? `tests fail${l.testExit !== null ? ` (exit ${l.testExit})` : ''}` : human(l.outcome)])
    case 'review':
      return safeBubble([l.verdict ?? (l.outcome || null), l.inputTokens ? `read ${kTokens(l.inputTokens)} tokens` : null])
    case 'decide':
      return safeBubble([l.outcome === 'merge_ready' ? 'merge-ready' : l.outcome === 'retry' ? 'asked for another try' : l.outcome ? human(l.outcome) : null, files(/^(test|review)-/)])
    case 'advise':
      return safeBubble([l.outcome === 'advised' ? 'gave advice' : l.outcome === 'advice_refused' ? 'declined to advise' : human(l.outcome)])
    case 'finish':
      return safeBubble([l.outcome ? `finished: ${human(l.outcome)}` : 'finished'])
  }
  return safeBubble([`${human(l.stage)} ${human(l.outcome)}`])
}

function seatBubble(l: SeatLine): string | null {
  if (l.event === 'start') return safeBubble([ACTION[l.stage] ?? human(l.stage), l.output, l.outputBytes !== null ? kb(l.outputBytes) : null])
  const how = l.timedOut || l.exit === 124 ? 'timed out' : l.exit !== null && l.exit !== 0 ? `exit ${l.exit}` : `done in ${secs(l.seconds)}`
  return safeBubble([`${human(l.stage)} ${how}`, l.output])
}

const seatMascot = (l: SeatLine): CrewMascotId | null => (l.slot === 'helper_' ? 'gemma' : (SEAT_MASCOT[l.seat] ?? null))

const FAIL = new Set(['tests_fail', 'FAIL', 'malformed', 'no_verdict', 'failed', 'stop', 'timeout'])

/** The task to draw: a running one, else one that ended in the last few minutes. */
function pickTask(tasks: CrewTaskView[], lines: Map<string, LiveLine[]>, now: number): { task: CrewTaskView; finale: CrewLiveView['finale'] } | null {
  const running = tasks.filter((t) => t.status === 'running').sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (running.length) return { task: running[0], finale: null }
  let best: { task: CrewTaskView; finale: CrewLiveView['finale'] } | null = null
  for (const t of tasks) {
    const kind = t.status === 'merge_ready' ? 'merge_ready' : t.status === 'failed' || t.status === 'interrupted' || t.status === 'waiting' ? 'failed' : null
    if (!kind) continue
    const evs = lines.get(t.id) ?? []
    const at = Math.max(t.updatedAt ?? 0, evs.length ? evs[evs.length - 1].at : 0)
    if (!at || now - at > FINALE_MS || now - at < -60_000) continue
    if (!best || at > best.finale!.at) best = { task: t, finale: { kind, at } }
  }
  return best
}

export function crewLive(tasks: CrewTaskView[], lines: Map<string, LiveLine[]>, now: number): CrewLiveView | null {
  const picked = pickTask(tasks, lines, now)
  if (!picked) return null
  const { task, finale } = picked
  const all = [...(lines.get(task.id) ?? [])].sort((a, b) => a.at - b.at)
  const stages = all.filter((l): l is StageLine => l.kind === 'stage')
  const seats = all.filter((l): l is SeatLine => l.kind === 'seat')
  const running = task.status === 'running'

  const attempt = Math.max(task.attempts, ...all.map((l) => l.attempt), 0)
  // This attempt's lines. Intake and plan run as attempt 0, before the first build.
  const thisRound = (a: number) => a === attempt || (attempt <= 1 && a === 0)
  const plan = [...stages].reverse().find((l) => l.stage === 'plan')
  const gate = plan?.gate ?? [...stages].reverse().find((l) => l.gate)?.gate ?? null
  const split = plan?.mode === 'helper' || seats.some((l) => seatMascot(l) === 'gemma')

  const involved = new Set<CrewMascotId>(CORE)
  if (gate === 'jev' || stages.some((l) => l.stage === 'decide' && l.gate === 'jev')) involved.add('jev')
  if (stages.some((l) => l.stage === 'advise') || task.stage === 'advise') involved.add('venice')
  if (stages.some((l) => l.stage === 'cavalry') || seats.some((l) => seatMascot(l) === 'codex') || task.stage === 'cavalry') involved.add('codex')

  // Who is generating now, and since when.
  const active = new Map<CrewMascotId, { action: string; since: number; bubble: string | null }>()
  const lastAt = all.length ? all[all.length - 1].at : (task.createdAt ?? now)
  const source: CrewLiveView['source'] = seats.length ? 'seats' : 'stages'
  if (running && seats.length) {
    // Seat lines: a start with no stop after it is a run in progress.
    const open = new Map<string, SeatLine>()
    for (const l of seats) {
      const k = `${l.seat}|${l.slot}|${l.stage}|${l.attempt}`
      if (l.event === 'start') open.set(k, l)
      else open.delete(k)
    }
    for (const l of open.values()) {
      const id = seatMascot(l)
      if (id) active.set(id, { action: ACTION[l.stage] ?? 'working', since: l.at, bubble: seatBubble(l) })
    }
    // Jev and Venice are not seats: their stages still say when they think.
    const st = task.stage ?? ''
    const id = stageMascot(st, gate)
    if ((id === 'jev' || id === 'venice') && !active.size) active.set(id, { action: ACTION[st], since: lastAt, bubble: null })
  } else if (running) {
    const st = task.stage ?? 'intake'
    const id = stageMascot(st, gate)
    if (id) active.set(id, { action: ACTION[st] ?? 'working', since: lastAt, bubble: null })
    if (st === 'build' && split) active.set('gemma', { action: 'writing', since: lastAt, bubble: null })
  }
  for (const id of active.keys()) involved.add(id)

  const mascots: CrewMascotView[] = []
  for (const id of ORDER) {
    if (!involved.has(id)) continue
    const mine = (l: LiveLine) => (l.kind === 'seat' ? seatMascot(l) === id : stageMascot(l.stage, l.gate ?? gate) === id || (id === 'gemma' && split && l.stage === 'build'))
    const own = all.filter(mine)
    const last = own[own.length - 1]
    const now_ = active.get(id)
    let state: CrewMascotView['state']
    if (now_) state = 'active'
    else if (id === 'gemma' && !split) state = 'idle'
    else if (own.some((l) => thisRound(l.attempt))) {
      const bad = own.some((l) => l.kind === 'stage' && thisRound(l.attempt) && FAIL.has(l.outcome))
      const badSeat = last?.kind === 'seat' && last.event === 'stop' && thisRound(last.attempt) && ((last.exit !== null && last.exit !== 0) || !!last.timedOut)
      state = bad || badSeat ? 'failed' : 'done'
    } else {
      // Still to come this attempt; Venice and Codex are called in, never queued.
      state = running && id !== 'venice' && id !== 'codex' ? 'waiting' : 'idle'
    }
    let bubble: string | null = now_?.bubble ?? null
    if (!bubble && last) bubble = last.kind === 'seat' ? seatBubble(last) : stageBubble(last, id)
    // Evidence files belong to whoever wrote them: the test log to the tests, the verdict to the reviewer.
    if (!now_ && (id === 'tests' || id === 'inkling')) {
      const decide = [...stages].reverse().find((l) => l.stage === 'decide' && l.evidence.length)
      const f = decide?.evidence.find((x) => (id === 'tests' ? /^test-/ : /^review-/).test(x))
      if (f && bubble && !bubble.includes(f)) bubble = safeBubble([bubble, f])
    }
    if (id === 'gemma' && !split && !now_) bubble = bubble ?? 'sitting this one out'
    mascots.push({
      id,
      ...MASCOTS[id],
      state,
      action: now_?.action ?? null,
      since: now_?.since ?? null,
      // Neither the stage lines nor agni.crew.seat_event/1 carry token rates.
      tokensPerSec: null,
      bubble,
      // No read-only source for card temperature or VRAM yet: not in `crew status`, and agnx has no AMD card.
      tempC: null,
      vramGb: null
    })
  }

  // The hand-off: the mascot who finished last, to the one working now.
  let handoff: CrewLiveView['handoff'] = null
  if (running && active.size) {
    const to = [...active.entries()].sort((a, b) => b[1].since - a[1].since)[0]
    const prev = [...all].reverse().find((l) => (l.kind === 'stage' || l.event === 'stop') && l.at <= to[1].since + 1)
    const from = prev ? (prev.kind === 'seat' ? seatMascot(prev) : stageMascot(prev.stage, prev.gate ?? gate)) : null
    if (from && from !== to[0]) handoff = { from, to: to[0], at: to[1].since }
  }

  return {
    taskId: task.id,
    status: task.status,
    stage: task.stage,
    startedAt: task.createdAt ?? (all.length ? all[0].at : null),
    mascots,
    handoff,
    finale,
    source
  }
}
