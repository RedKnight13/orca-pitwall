// The task as a story: what it is, how it ended, and one plain line per role, each grounded in a
// receipt (a stage line, an assignment, the recorded decision, `crew status`). Rules it keeps:
//   - an assignment is not execution: "assigned" until a stage line says the work was graded;
//   - no cause the record does not give (the runner's rejection says what, not why);
//   - a reserve role says what it can do and whether this task called it.
// Raw file names, ids, roots and stage settings go in the details fold, never in the narration.
import type { CrewStageView, CrewTaskView, CrewView } from '../shared/types'
import { esc, fmtSecs } from './render'

export type RoleId = 'leader' | 'helper' | 'runner' | 'tests' | 'reviewer' | 'referee' | 'escalation' | 'cavalry'
export type RoleTone = 'ok' | 'bad' | 'warn' | 'run' | 'quiet' | 'idle'

export interface RoleLine {
  id: RoleId
  name: string
  role: string
  /** One or two words for the map and the chip: assigned, rejected, did not start, called ×2. */
  word: string
  tone: RoleTone
  /** One short sentence for a person. */
  says: string
  reserve: boolean
  /** Raw receipts for the details fold. */
  files: string[]
}

export interface Story {
  headline: string
  outcome: string
  tone: RoleTone
  roles: RoleLine[]
  receipts: string[]
}

/** The prompt's first sentence: "Make the durations package correct." */
export function headline(prompt: string): string {
  const p = prompt.trim()
  if (!p) return 'Task with no recorded prompt'
  const m = /^(.{12,140}?[.!?])(\s|$)/.exec(p)
  return m ? m[1] : p.length > 140 ? p.slice(0, 139).replace(/\s+\S*$/, '') + '…' : p
}

/** "Make the durations package correct" → "duration". */
function subject(prompt: string): string | null {
  const m = /\bthe ([a-z][a-z0-9_]*) (?:package|module|library)\b/i.exec(prompt)
  if (!m) return null
  const w = m[1].toLowerCase()
  return w.endsWith('s') && w.length > 4 ? w.slice(0, -1) : w
}

/** A file's job in words. Known verb stems read as work (parse.py → parsing); others as the module. */
const STEM: Record<string, string> = {
  parse: 'parsing', parser: 'parsing', fmt: 'formatting', format: 'formatting', formatter: 'formatting', render: 'rendering',
  wrap: 'line wrapping', slug: 'slugs', report: 'reports', lru: 'the LRU cache', ttl: 'TTL expiry', stock: 'stock rules',
  validate: 'validation', io: 'input and output', cli: 'the command line', util: 'helpers', utils: 'helpers'
}

export function workOf(files: string[], prompt: string): string | null {
  const code = files.filter((f) => !/^(test_|.*_test\.)/.test(f))
  if (!code.length) return null
  const subj = subject(prompt)
  const words = [...new Set(code.map((f) => {
    const stem = f.replace(/\.[^.]+$/, '').toLowerCase()
    const job = STEM[stem]
    if (job && subj && /ing$/.test(job)) return `${subj} ${job}`
    return job ?? `the ${stem} module`
  }))]
  return words.length > 2 ? `${words.slice(0, 2).join(', ')} and ${words.length - 2} more` : words.join(' and ')
}

const last = (xs: CrewStageView[], stage: string) => [...xs].reverse().find((x) => x.stage === stage)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

const ENDED = new Set(['merge_ready', 'waiting', 'failed', 'needs_owner', 'interrupted', 'stopped'])

/**
 * `stages`: the lines to tell (all of them, or a replay's prefix). `ended`: the story reaches the
 * task's end (not a replay paused mid-way, not a running task).
 */
export function story(c: CrewView, t: CrewTaskView, stages: CrewStageView[], ended: boolean, live: boolean): Story {
  const plan = last(stages, 'plan')
  const build = last(stages, 'build')
  const grade = last(stages, 'grade')
  const review = last(stages, 'review')
  const cav = last(stages, 'cavalry')
  const advise = last(stages, 'advise')
  const split = plan?.mode === 'helper' || !!t.assignments?.helper?.length
  const rejected = ended && t.decision === 'helper_assignment_rejected'
  // The runner's own ownership check (a file gate), not a Jev verdict.
  const crossed = [...stages].reverse().find((s) => s.stage === 'build' && s.reason)
  const helperCrossed = crossed?.reason === 'helper_outside_assignment'
  const leaderCrossed = crossed?.reason === 'leader_edited_helper_file'
  const attemptWord = crossed && crossed.attempt > 1 ? ` on attempt ${crossed.attempt}` : ''
  const leaderWork = workOf(t.assignments?.leader ?? [], t.prompt)
  const helperWork = workOf(t.assignments?.helper ?? [], t.prompt)
  const graded = !!grade
  const active = live && c.live?.taskId === t.id ? c.live.mascots.filter((m) => m.state === 'active') : []
  const doing = (id: string) => active.find((m) => m.id === id)
  const ran = stages.length > 0
  const notReached = ended ? 'did not start' : 'not yet'
  const roles: RoleLine[] = []

  // Qwen leads: intake and plan are its stages; an assignment alone is not work done.
  {
    const now = doing('qwen')
    const bits: string[] = []
    if (plan) bits.push(plan.mode === 'helper' ? 'Planned a split with Gemma' : 'Planned it alone')
    if (leaderWork) bits.push(`${bits.length ? 'was ' : ''}assigned ${leaderWork}`)
    if (!bits.length) bits.push(ran ? 'Read the task' : 'Has not started')
    let says = bits.join(', then ') + '.'
    if (leaderCrossed) says += ` Edited a file assigned to Gemma${attemptWord}, which the ownership check stopped.`
    else if (leaderWork && build && !graded && ended) says += ' Its part was never graded.'
    const word = now ? `${now.action ?? 'working'}…` : leaderCrossed ? 'crossed scope' : leaderWork ? 'assigned' : plan ? 'planned' : ran ? 'read task' : 'waiting'
    roles.push({ id: 'leader', name: 'Qwen', role: 'Leader', word, tone: now ? 'run' : leaderCrossed ? 'bad' : leaderWork && !graded ? 'warn' : 'ok', says: capital(says), reserve: false, files: t.assignments?.leader ?? [] })
  }
  // Gemma, the second author, only on a split plan.
  {
    const now = doing('gemma')
    let says: string
    let word: string
    let tone: RoleTone
    if (now) [word, tone, says] = [`${now.action ?? 'writing'}…`, 'run', helperWork ? `Working on ${helperWork}.` : 'Writing its part.']
    else if (!split) [word, tone, says] = ['not used', 'idle', plan ? 'Not used: Qwen planned this alone.' : 'Joins only when Qwen plans a split.']
    else if (helperCrossed) [word, tone, says] = ['crossed scope', 'bad', `Assigned ${helperWork ?? 'part of the work'}, but edited files outside that assignment${attemptWord}. Its work was not graded.`]
    else if (rejected) [word, tone, says] = ['rejected', 'bad', `Assigned ${helperWork ?? 'part of the work'}. The runner rejected the handoff, so it was not graded.`]
    else [word, tone, says] = ['assigned', graded ? 'ok' : 'warn', `Assigned ${helperWork ?? 'part of the work'}.${graded ? '' : ended ? ' Never graded.' : ''}`]
    roles.push({ id: 'helper', name: 'Gemma', role: 'Second author', word, tone, says, reserve: false, files: t.assignments?.helper ?? [] })
  }
  // The crew runner routes the work and makes the call at the end.
  {
    let word = 'routing'
    let tone: RoleTone = 'quiet'
    let says = live ? 'Routing the work between seats.' : 'Routes the work between seats.'
    if (crossed && crossed.reason !== 'other' && ended) [word, tone, says] = ['rejected handoff', 'bad', `Its ownership check stopped the build${attemptWord}: ${helperCrossed ? 'Gemma edited files outside its assignment' : 'Qwen edited a file assigned to Gemma'}. This is the runner's file check, not a Jev verdict.`]
    else if (rejected) [word, tone, says] = ['rejected handoff', 'bad', 'Rejected the handoff to Gemma before tests or review. The record does not say why.']
    else if (ended && t.status === 'merge_ready') [word, tone, says] = ['merge-ready', 'ok', 'Marked the work merge-ready for you.']
    else if (ended && t.status === 'needs_owner') [word, tone, says] = ['needs you', 'warn', 'Stopped: it needs a test command to grade the work.']
    else if (ended && t.status === 'interrupted') [word, tone, says] = ['interrupted', 'bad', 'The runner stopped mid-task.']
    else if (ended && build?.outcome === 'stop') [word, tone, says] = ['stopped', 'bad', `Stopped the task after the build (${fmtSecs(build.seconds)}) and handed it to you.`]
    else if (ended) [word, tone, says] = ['stopped', 'bad', 'Stopped the task and handed it to you.']
    roles.push({ id: 'runner', name: 'Runner', role: 'Crew runner', word, tone, says, reserve: false, files: [] })
  }
  // Tests and review: a stage line, or nothing happened.
  {
    const now = doing('tests')
    const pass = grade?.outcome === 'tests_pass'
    const [word, tone, says]: [string, RoleTone, string] = now
      ? ['testing…', 'run', 'Running the tests now.']
      : grade
        ? pass ? ['passed', 'ok', `Tests passed (${fmtSecs(grade.seconds)}).`] : ['failed', 'bad', `Tests ${grade.outcome === 'tests_fail' ? 'failed' : human(grade.outcome)}.`]
        : [notReached, 'idle', ended ? 'Tests did not start.' : 'Runs once the build is in.']
    roles.push({ id: 'tests', name: 'Tests', role: 'Test runner', word, tone, says, reserve: false, files: [] })
  }
  {
    const now = doing('inkling')
    const [word, tone, says]: [string, RoleTone, string] = now
      ? ['reviewing…', 'run', 'Reviewing the change now.']
      : review
        ? review.outcome === 'PASS' ? ['approved', 'ok', `Approved the change (${fmtSecs(review.seconds)}).`] : ['objected', 'bad', `Review said ${human(review.outcome)}.`]
        : [notReached, 'idle', ended ? 'Review did not start.' : 'Reviews once the tests pass.']
    roles.push({ id: 'reviewer', name: 'Inkling', role: 'Reviewer', word, tone, says, reserve: false, files: [] })
  }
  // Reserve roles: what each can do, and whether this task called it.
  const reserves = new Set(c.reserveRoles ?? [])
  const calls = stages.reduce((n, s) => n + (s.gate === 'jev' ? (s.refereeCalls ?? 0) : 0), 0)
  const judged = stages.some((s) => s.gate === 'jev')
  if (reserves.has('cavalry') || cav) {
    const can = 'Can be called once on an eligible waiting task.'
    const said = cav
      ? `Called: ${cav.outcome ? human(cav.outcome) : 'took over'}${cav.seconds ? ` (${fmtSecs(cav.seconds)})` : ''}.`
      : t.cavalryEligible
        ? 'Not called yet. Crew status lists this task as eligible for its one call.'
        : ended && t.status === 'waiting' && t.primary
          ? `${can} Crew status does not list this one; not called.`
          : `${can} Not called on this task.`
    roles.push({ id: 'cavalry', name: 'Codex', role: 'Cavalry', word: doing('codex') ? 'writing…' : cav ? 'called' : t.cavalryEligible ? 'available' : 'not called', tone: doing('codex') ? 'run' : cav ? 'ok' : t.cavalryEligible ? 'warn' : 'idle', says: said, reserve: true, files: [] })
  }

  if (reserves.has('referee') || judged) {
    const safe = plan?.gate === 'jev' && plan.decision === 'safe_helper'
    const said = calls ? `Called ${plural(calls, 'time')}${plan?.gate === 'jev' ? ' while planning' : ''}${safe ? '; judged the split safe' : ''}.` : judged ? 'Judged a step.' : 'Can referee a split plan or a stuck decision. Not called on this task.'
    roles.push({ id: 'referee', name: 'Jev', role: 'Referee', word: doing('jev') ? 'judging…' : calls ? `called ×${calls}` : judged ? 'called' : 'not called', tone: doing('jev') ? 'run' : calls || judged ? 'ok' : 'idle', says: said, reserve: true, files: [] })
  }
  if (reserves.has('escalation') || advise) {
    const said = advise ? (advise.outcome === 'advised' ? 'Called: gave advice.' : advise.outcome === 'advice_refused' ? 'Called: declined to advise.' : `Called: ${human(advise.outcome)}.`) : 'Can advise when the crew is stuck. Not called on this task.'
    roles.push({ id: 'escalation', name: 'Venice', role: 'Escalation', word: doing('venice') ? 'advising…' : advise ? 'called' : 'not called', tone: doing('venice') ? 'run' : advise ? 'ok' : 'idle', says: said, reserve: true, files: [] })
  }
  const outcome = outcomeLine(t, stages, ended, live, rejected, graded)
  const receipts = stages.map((s) => [s.stage, s.outcome || 'done', fmtSecs(s.seconds), s.mode && `mode=${s.mode}`, s.gate && `gate=${s.gate}`, s.decision && `decision=${s.decision}`, s.refereeCalls && `referee_calls=${s.refereeCalls}`, s.reason && `reason=${s.reason}`, s.evidence?.length && `files=${s.evidence.join(',')}`].filter(Boolean).join(' '))
  return { headline: headline(t.prompt), outcome: outcome.text, tone: outcome.tone, roles, receipts }
}

function outcomeLine(t: CrewTaskView, stages: CrewStageView[], ended: boolean, live: boolean, rejected: boolean, graded: boolean): { text: string; tone: RoleTone } {
  if (live && !ended) return { text: t.stage ? `In progress: ${human(t.stage)}.` : 'Starting.', tone: 'run' }
  if (!ended) {
    const at = stages[stages.length - 1]
    return { text: at ? `Replay at ${human(at.stage)}: ${human(at.outcome || 'done')}.` : 'Replay at the start.', tone: 'quiet' }
  }
  if (t.status === 'merge_ready') return { text: 'Finished: tests passed and the work is merge-ready.', tone: 'ok' }
  const why = [...stages].reverse().find((s) => s.stage === 'build' && s.reason && s.reason !== 'other')?.reason
  if (why === 'helper_outside_assignment') return { text: 'Stopped before testing: Gemma edited files outside its assignment.', tone: 'bad' }
  if (why === 'leader_edited_helper_file') return { text: "Stopped before testing: Qwen edited a file assigned to Gemma.", tone: 'bad' }
  if (rejected) return { text: 'Stopped before testing: the runner rejected the handoff to Gemma.', tone: 'bad' }
  if (t.status === 'needs_owner') return { text: 'Waiting for you: no test command to grade the work.', tone: 'warn' }
  if (t.status === 'interrupted') return { text: 'Interrupted: the crew process stopped mid-task.', tone: 'bad' }
  if (t.status === 'failed') return { text: `Failed${stages.length ? ` at ${human(stages[stages.length - 1].stage)}` : ''}.`, tone: 'bad' }
  return { text: graded ? 'Stopped after grading and handed to you.' : 'Stopped before testing and handed to you.', tone: 'bad' }
}

export const taskEnded = (t: CrewTaskView) => ENDED.has(t.status)

const human = (s: string) => s.replace(/_/g, ' ').toLowerCase()
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const GLYPH: Record<RoleId, string> = { leader: 'Q', helper: 'G', runner: '⇄', tests: '✓', reviewer: 'I', referee: 'J', escalation: 'V', cavalry: 'C' }

/** The story panel: headline, outcome, one row per role, and the receipts folded away. */
export function renderStory(s: Story, t: CrewTaskView, ui: { expanded: Record<string, boolean> }): string {
  const rows = s.roles
    .map((r) => `<li class="sr sr-${r.tone}${r.reserve ? ' sr-reserve' : ''}" data-role="${r.id}"><i class="sr-face" aria-hidden="true">${GLYPH[r.id]}</i><div class="sr-main"><div class="sr-head"><b>${esc(r.name)}</b><span class="sr-role">${esc(r.role)}</span><span class="sr-word">${esc(r.word)}</span></div><p>${esc(r.says)}</p></div></li>`)
    .join('')
  const core = rows && `<ul class="sr-list" aria-label="Who did what">${rows}</ul>`
  const files = s.roles.filter((r) => r.files.length).map((r) => `<dt>${esc(r.name)}</dt><dd>${r.files.map((f) => `<code>${esc(f)}</code>`).join(' ')}</dd>`).join('')
  const open = !!ui.expanded['crewstory:' + t.key]
  const detail = `<button class="cm-fold sm" data-action="expand" data-key-x="crewstory:${esc(t.key)}" aria-expanded="${open}"><span>Details: files, ids, settings</span><span>${open ? '−' : '+'}</span></button>${open ? `<dl class="cm-facts story-detail"><dt>Task</dt><dd><code>${esc(t.id)}</code></dd><dt>Root</dt><dd><code>${esc(t.root)}</code>${t.primary ? ' (default profile)' : ' (not covered by <code>crew status</code>)'}</dd>${t.decision ? `<dt>Decision</dt><dd><code>${esc(t.decision)}</code></dd>` : ''}${files}${s.receipts.length ? `<dt>Stages</dt><dd>${s.receipts.map((r) => `<code>${esc(r)}</code>`).join('<br>')}</dd>` : ''}</dl>` : ''}`
  return `<div class="story st-${s.tone}"><p class="story-title">${esc(s.headline)}</p><p class="story-outcome">${esc(s.outcome)}</p>${core}${detail}</div>`
}
