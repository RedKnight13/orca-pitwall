import { assert, test } from 'orca/testing'
import { assistant, attachment, blob, fired, ms, notification, notified, prompt, queued, result, system } from '../../../test/helpers'
import { nextCronTime } from '../cron'
import { endedTasks, nextRunOf, STALE_MS } from './background'

const DAY = 86_400_000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** How Claude Code writes a run time: "Nov 21 6:43pm", local time. */
function nextRunText(t: number): string {
  const d = new Date(t)
  const h = d.getHours() % 12 || 12
  return `${MON[d.getMonth()]} ${d.getDate()} ${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`
}
import { TranscriptParser, type ParserEvent } from './transcript'

function feed(lines: (string | string[])[]) {
  const events: ParserEvent[] = []
  const p = new TranscriptParser((e) => events.push(e))
  for (const l of lines.flat()) p.line(l)
  return { p, bg: p.bg!, events }
}

const bash = (s: number, id: string, command: string, description?: string) =>
  assistant(s, { tools: [{ id, name: 'Bash', input: { command, description, run_in_background: true } }] })
const started = (s: number, useId: string, taskId: string) =>
  result(s, useId, { text: `Command running in background with ID: ${taskId}. Output is being written to: /tmp/tasks/${taskId}.output`, toolUseResult: { stdout: '', stderr: '', backgroundTaskId: taskId } })
const ids = (p: TranscriptParser, now = ms(60), idleSince: number | null = null) => p.bg!.pending(now, idleSince).map((x) => x.id)

// ---- shells ----------------------------------------------------------------------------

test('a background shell is pending until its notification, which is logged once', () => {
  const start = [prompt(0, 'start the server'), bash(1, 't1', 'npm run dev', 'Start the dev server'), started(2, 't1', 'b1')]
  const { p, events } = feed(start)
  const [x] = p.bg!.pending(ms(10), null)
  assert.equal(x.id, 'b1')
  assert.equal(x.kind, 'shell')
  assert.equal(x.label, 'Start the dev server')
  assert.equal(x.startedAt, ms(2))
  assert.equal(x.dueAt, null)
  // The same notification is written up to six times: queued, delivered, and copied in blobs.
  const n = notification('b1', 'completed', 'Background command "npm run dev" completed (exit code 0)')
  for (const l of [queued(30, n), notified(31, n), blob('user', [{ type: 'text', text: n }]), attachment(31, { type: 'queued_command', prompt: n })]) p.line(l)
  assert.deepEqual(ids(p), [])
  const done = events.filter((e) => e.kind === 'done')
  assert.equal(done.length, 1)
  assert.equal(done[0].text, 'background Start the dev server finished')
  assert.equal(done[0].at, ms(30), 'the queue time is when it ended')
})

test('a shell is read from the result text alone (blob rows carry no toolUseResult)', () => {
  const { p } = feed([
    blob('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test --watch' } }]),
    blob('user', [{ type: 'tool_result', tool_use_id: 't1', content: 'Command running in background with ID: bx9k2m4p1. Output is being written to: /tmp/x' }])
  ])
  assert.deepEqual(ids(p), ['bx9k2m4p1'])
  assert.equal(p.bg!.items.get('bx9k2m4p1')!.label, 'pnpm test --watch')
})

test('a command moved to the background after a timeout counts too', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 't1', name: 'Bash', input: { command: 'make build' } }] }),
    result(200, 't1', { text: 'Command did not complete within its 180s timeout and was moved to the background (ID: bm7q8r2t5). Output is being written to: /tmp/x' })
  ])
  assert.deepEqual(ids(p, ms(300)), ['bm7q8r2t5'])
})

test('a failed shell logs an error; a stopped one says so', () => {
  const { p, events } = feed([bash(1, 't1', 'npm run e2e'), started(2, 't1', 'b1'), bash(3, 't2', 'npm run dev'), started(4, 't2', 'b2')])
  p.line(notified(10, notification('b1', 'failed')))
  p.line(notified(11, notification('b2', 'killed')))
  assert.deepEqual(ids(p), [])
  assert.deepEqual(
    events.filter((e) => e.kind === 'error' || e.kind === 'done').map((e) => `${e.kind}: ${e.text}`),
    ['error: background npm run e2e failed', 'done: background npm run dev killed']
  )
})

test('an end read before its start leaves no ghost', () => {
  const { p } = feed([bash(1, 't1', 'sleep 5'), notified(2, notification('b1', 'completed')), started(3, 't1', 'b1')])
  assert.deepEqual(ids(p), [])
})

test('TaskStop and KillShell end a shell, even when the stop itself fails', () => {
  const { p } = feed([
    bash(1, 't1', 'a'),
    started(2, 't1', 'b1'),
    bash(3, 't2', 'b'),
    started(4, 't2', 'b2'),
    assistant(5, { tools: [{ id: 's1', name: 'TaskStop', input: { task_id: 'b1' } }] }),
    result(6, 's1', { text: '{"message":"Successfully stopped task: b1"}' }),
    assistant(7, { tools: [{ id: 's2', name: 'KillShell', input: { shell_id: 'b2' } }] }),
    result(8, 's2', { isError: true, text: 'No shell found with ID: b2' })
  ])
  assert.deepEqual(ids(p), [])
})

test('quoted notifications and quoted result text change nothing', () => {
  const n = notification('b1', 'completed')
  const { p } = feed([
    bash(1, 't1', 'npm run dev'),
    started(2, 't1', 'b1'),
    // A file read and a grep that happen to contain a notification.
    assistant(3, { tools: [{ id: 'r1', name: 'Read', input: { file_path: '/work/app/log.txt' } }] }),
    result(4, 'r1', { text: n }),
    // A person pasting one into a prompt.
    prompt(5, `what does this mean? ${n}`),
    // A non-Bash result that mentions a background id.
    assistant(6, { tools: [{ id: 'g1', name: 'Grep', input: { pattern: 'background' } }] }),
    result(7, 'g1', { text: 'Command running in background with ID: b9.' })
  ])
  assert.deepEqual(ids(p), ['b1'])
})

test('a new Claude Code process drops what died with the old one; only durable cron jobs stay', () => {
  const { p } = feed([
    bash(1, 't1', 'npm run dev'),
    started(2, 't1', 'b1'),
    assistant(3, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '0 * * * *', prompt: 'check CI', recurring: true } }] }),
    result(4, 'c1', { toolUseResult: { id: 'c1x', humanSchedule: 'Every hour', recurring: true, durable: false, nextFireAt: ms(3600) } }),
    assistant(5, { tools: [{ id: 'c2', name: 'CronCreate', input: { cron: '0 9 * * *', prompt: 'daily', durable: true } }] }),
    result(6, 'c2', { toolUseResult: { id: 'c2x', humanSchedule: 'Daily at 9', recurring: true, durable: true, nextFireAt: ms(7200) } }),
    assistant(7, { tools: [{ id: 'w1', name: 'ScheduleWakeup', input: { delaySeconds: 600, prompt: 'later' } }] }),
    result(8, 'w1', { toolUseResult: { scheduledFor: ms(608) } }),
    attachment(100, { type: 'hook_success', hookName: 'SessionStart:compact', hookEvent: 'SessionStart' })
  ])
  assert.deepEqual(ids(p, ms(200)), ['b1', 'wakeup', 'c1x', 'c2x'], 'a compaction is not a new process')
  p.line(attachment(101, { type: 'hook_success', hookName: 'SessionStart:resume', hookEvent: 'SessionStart' }))
  assert.deepEqual(ids(p, ms(200)), ['c2x'])
})

// ---- compaction census -----------------------------------------------------------------

test('after a compaction, shells missing from the task_status list are gone', () => {
  const { p } = feed([
    bash(1, 't1', 'api'),
    started(2, 't1', 'b1'),
    bash(3, 't2', 'web'),
    started(4, 't2', 'b2'),
    bash(5, 't3', 'db'),
    started(6, 't3', 'b3'),
    // One status row comes just before the boundary, one after.
    attachment(99.9, { type: 'task_status', taskId: 'b1', taskType: 'local_bash', description: 'api', status: 'running' }),
    system(100, 'compact_boundary', { compactMetadata: { preTokens: 300000, postTokens: 40000, trigger: 'auto' } }),
    attachment(101, { type: 'task_status', taskId: 'b3', taskType: 'local_bash', description: 'db', status: 'running' })
  ])
  // Still inside the census window: nothing is dropped yet.
  assert.deepEqual(ids(p, ms(105)).sort(), ['b1', 'b2', 'b3'])
  p.line(prompt(200, 'go on'))
  assert.deepEqual(ids(p, ms(200)).sort(), ['b1', 'b3'])
})

test('the census also closes on the clock when no row follows', () => {
  const { p } = feed([bash(1, 't1', 'api'), started(2, 't1', 'b1'), system(100, 'compact_boundary', { compactMetadata: {} })])
  assert.deepEqual(ids(p, ms(105)), ['b1'])
  assert.deepEqual(ids(p, ms(120)), [])
})

test('a task_status row brings back a shell not seen start, and ends one it reports finished', () => {
  const { p } = feed([
    attachment(1, { type: 'task_status', taskId: 'b5', taskType: 'local_bash', description: 'Run the API dev server', status: 'running' }),
    attachment(1, { type: 'task_status', taskId: 'a7', taskType: 'local_agent', description: 'review', status: 'running' })
  ])
  const [x] = p.bg!.pending(ms(10), null)
  assert.equal(x.id, 'b5')
  assert.equal(x.startedAt, null, 'when it started is not known')
  assert.equal(p.bg!.items.size, 1, 'agents are the Subagents block\'s')
  p.line(attachment(2, { type: 'task_status', taskId: 'b5', taskType: 'local_bash', status: 'completed' }))
  assert.deepEqual(ids(p), [])
})

// ---- monitors --------------------------------------------------------------------------

test('a monitor runs until its notification or its timeout', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'm1', name: 'Monitor', input: { command: 'tail -f log | grep ERROR', description: 'Watch the log for errors' } }] }),
    result(2, 'm1', { text: 'Monitor started (task k1, expires in 5m unless the source ends first)', toolUseResult: { taskId: 'k1', timeoutMs: 300000, persistent: false } }),
    assistant(3, { tools: [{ id: 'm2', name: 'Monitor', input: { command: 'watch deploys', persistent: true } }] }),
    result(4, 'm2', { text: 'Monitor started (task k2)', toolUseResult: { taskId: 'k2', persistent: true } })
  ])
  const k1 = p.bg!.items.get('k1')!
  assert.equal(k1.kind, 'monitor')
  assert.equal(k1.label, 'Watch the log for errors')
  assert.equal(k1.endsAt, ms(302))
  assert.equal(p.bg!.items.get('k2')!.endsAt, null)
  // An event is not an end.
  p.line(notified(20, '<task-notification>\n<task-id>k1</task-id>\n<summary>Monitor event</summary>\n<event>ERROR x</event>\n</task-notification>'))
  assert.deepEqual(ids(p, ms(30)).sort(), ['k1', 'k2'])
  assert.deepEqual(ids(p, ms(302 + 61)), ['k2'], 'gone a minute after its timeout')
})

test('a monitor\'s timeout is read from the text when there is no toolUseResult', () => {
  const { p } = feed([
    blob('assistant', [{ type: 'tool_use', id: 'm1', name: 'Monitor', input: { command: 'x' } }]),
    apiAt(10),
    blob('user', [{ type: 'tool_result', tool_use_id: 'm1', content: 'Monitor started (task k9w3e5r7, expires in 20m unless the source ends first)' }])
  ])
  assert.equal(p.bg!.items.get('k9w3e5r7')!.endsAt, ms(10) + 20 * 60_000)
})

function apiAt(s: number) {
  return prompt(s, 'tick')
}

// ---- cron jobs -------------------------------------------------------------------------

test('a recurring cron job: next run from the result, then from the schedule after each run', () => {
  const create = [
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '*/10 * * * *', prompt: 'Check the canary error rate', recurring: true } }] }),
    result(2, 'c1', { text: 'Scheduled recurring job j1 (Every 10 minutes). Next run: ... Auto-expires after 30 days. Use CronDelete to cancel sooner.', toolUseResult: { id: 'j1', humanSchedule: 'Every 10 minutes', recurring: true, durable: false, nextFireAt: ms(600) + 0.4 } })
  ]
  const { p, events } = feed(create)
  const j = p.bg!.pending(ms(10), null)[0]
  assert.equal(j.kind, 'cron')
  assert.equal(j.label, 'Check the canary error rate')
  assert.equal(j.schedule, 'Every 10 minutes')
  assert.equal(j.dueAt, ms(600), 'rounded')
  assert.equal(j.recurring, true)
  assert.equal(j.endsAt, ms(2) + 30 * DAY, 'its expiry as the result states it')
  for (const l of fired(601, { taskId: 'j1', cron: '*/10 * * * *', prompt: 'Check the canary error rate' })) p.line(l)
  assert.equal(p.bg!.items.get('j1')!.dueAt, nextCronTime('*/10 * * * *', ms(601)))
  assert.equal(p.turn!.prompt, 'scheduled: Check the canary error rate', 'its run is a turn')
  assert.equal(events.filter((e) => e.kind === 'prompt').length, 1, 'the hidden prompt row does not start a second turn')
  assert.deepEqual(ids(p, ms(2) + 30 * DAY + 61_000), [], 'expired')
})

test('a one-shot cron job goes once it runs; CronDelete removes one', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '30 10 1 1 *', prompt: 'make the bucket private', recurring: false } }] }),
    result(2, 'c1', { toolUseResult: { id: 'j1', humanSchedule: '30 10 1 1 *', recurring: false, durable: false, nextFireAt: ms(1800) } }),
    assistant(3, { tools: [{ id: 'c2', name: 'CronCreate', input: { cron: '0 18 1 1 *', prompt: 'post the video' } }] }),
    result(4, 'c2', { toolUseResult: { id: 'j2', humanSchedule: '0 18 1 1 *', recurring: false, durable: true, nextFireAt: ms(28800) } })
  ])
  assert.deepEqual(ids(p), ['j1', 'j2'], 'soonest first')
  assert.equal(p.bg!.items.get('j1')!.endsAt, null)
  assert.equal(p.bg!.items.get('j2')!.detail, 'Kept across restarts')
  for (const l of fired(1800, { taskId: 'j1', cron: '30 10 1 1 *', prompt: 'make the bucket private' })) p.line(l)
  assert.deepEqual(ids(p, ms(1801)), ['j2'])
  p.line(assistant(1900, { tools: [{ id: 'd1', name: 'CronDelete', input: { id: 'j2' } }] }))
  p.line(result(1901, 'd1', { text: 'Cancelled job j2.' }))
  assert.deepEqual(ids(p, ms(1902)), [])
})

test('a cron job is read from the text when there is no toolUseResult', () => {
  const { p } = feed([
    blob('assistant', [{ type: 'tool_use', id: 'c1', name: 'CronCreate', input: { cron: '0 * * * *', prompt: 'hourly check' } }]),
    apiAt(5),
    blob('user', [{ type: 'tool_result', tool_use_id: 'c1', content: `Scheduled recurring job ab12cd34 (Every hour). Next run: ${nextRunText(nextCronTime('0 * * * *', ms(5))! + 7 * 60_000)}. Auto-expires after 30 days.` }])
  ])
  const j = p.bg!.items.get('ab12cd34')!
  assert.equal(j.schedule, 'Every hour')
  assert.equal(j.recurring, true)
  assert.equal(j.dueAt, nextCronTime('0 * * * *', ms(5))! + 7 * 60_000, 'the next run as the text states it, offset included')
  assert.equal(j.endsAt, ms(5) + 30 * DAY)
})

test('a failed CronCreate schedules nothing', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: 'bad', prompt: 'x' } }] }),
    result(2, 'c1', { isError: true, text: 'Invalid cron expression' })
  ])
  assert.deepEqual(ids(p), [])
})

// ---- the /loop wakeup ------------------------------------------------------------------

test('one wakeup at a time: a new one replaces it, stop and its run clear it', () => {
  const wake = (s: number, id: string, input: Record<string, unknown>, res?: Record<string, unknown>) => [
    assistant(s, { tools: [{ id, name: 'ScheduleWakeup', input }] }),
    result(s + 1, id, { text: `Next wakeup scheduled for 10:20:00 (in ${input.delaySeconds}s).`, toolUseResult: res })
  ]
  const { p } = feed([wake(1, 'w1', { delaySeconds: 1200, prompt: 'check the deploy', reason: 'watching CI' }, { scheduledFor: ms(1202) })])
  let [w] = p.bg!.pending(ms(10), null)
  assert.equal(w.kind, 'wakeup')
  assert.equal(w.label, 'check the deploy')
  assert.equal(w.detail, 'watching CI')
  assert.equal(w.dueAt, ms(1202))
  for (const l of wake(20, 'w2', { delaySeconds: 300, prompt: 'check again' })) p.line(l)
  ;[w] = p.bg!.pending(ms(30), null)
  assert.equal(p.bg!.items.size, 1)
  assert.equal(w.dueAt, ms(21) + 300_000, 'read from the result text')
  for (const l of fired(321, { taskId: 'f1', cron: '26 10 * * *', prompt: 'check again', taskKind: 'loop', cronKind: 'loop' })) p.line(l)
  assert.deepEqual(ids(p, ms(322)), [])
  assert.equal(p.turn!.prompt, 'loop: check again')
  for (const l of wake(400, 'w3', { delaySeconds: 60, prompt: '<<autonomous-loop-dynamic>>', reason: 'idle tick' })) p.line(l)
  assert.equal(p.bg!.items.get('wakeup')!.label, 'autonomous loop: idle tick')
  for (const l of wake(410, 'w4', { stop: true })) p.line(l)
  assert.deepEqual(ids(p, ms(420)), [])
})

test('the wakeup time falls back to the clamped delay', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'w1', name: 'ScheduleWakeup', input: { delaySeconds: 99999, prompt: 'later' } }] }),
    result(2, 'w1', { text: 'ok' })
  ])
  assert.equal(p.bg!.items.get('wakeup')!.dueAt, ms(2) + 3_600_000)
})

test('the state carried over a compaction or resume replaces the schedules', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '0 * * * *', prompt: 'hourly' } }] }),
    result(2, 'c1', { toolUseResult: { id: 'j1', humanSchedule: 'Every hour', recurring: true, nextFireAt: ms(3600) } }),
    attachment(10, { type: 'session_cron_carry', tasks: [], wakeup: { prompt: 'resume the review', scheduledFor: ms(900), reason: 'waiting on reviewers' } })
  ])
  const [w] = p.bg!.pending(ms(20), null)
  assert.deepEqual(ids(p, ms(20)), ['wakeup'], 'an empty task list means no cron jobs')
  assert.equal(w.dueAt, ms(900))
  p.line(attachment(30, { type: 'session_cron_carry', tasks: [] }))
  assert.deepEqual(ids(p, ms(40)), [], 'no wakeup carried means none')
})

test('a carried task list Pitwall cannot read leaves the cron jobs as they were', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '0 * * * *', prompt: 'hourly' } }] }),
    result(2, 'c1', { toolUseResult: { id: 'j1', recurring: true, nextFireAt: ms(3600) } }),
    attachment(10, { type: 'session_cron_carry', tasks: [{ something: 'new' }] }),
    attachment(11, { type: 'session_cron_carry', tasks: [{ id: 'j1' }, { id: 'j2', cron: '0 9 * * *', prompt: 'daily', recurring: true, createdAt: ms(0) }] })
  ])
  assert.deepEqual(ids(p, ms(20)).sort(), ['j1', 'j2'])
  assert.equal(p.bg!.items.get('j2')!.cron, '0 9 * * *')
})

// ---- what pending() shows --------------------------------------------------------------

test('a schedule past due waits while the agent is busy, and goes once it sits idle too long', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '30 10 1 1 *', prompt: 'once' } }] }),
    result(2, 'c1', { toolUseResult: { id: 'j1', recurring: false, nextFireAt: ms(1800) } })
  ])
  const at = (s: number, idle: number | null) => p.bg!.pending(ms(s), idle === null ? null : ms(idle))
  assert.equal(at(1800, null)[0].overdue, false, 'at its time: running now, not late')
  assert.equal(at(1900, null)[0].overdue, true, 'busy: it waits')
  assert.equal(at(1800 + STALE_MS / 1000 + 600, null)[0].overdue, true, 'still busy: still waits')
  assert.equal(at(1900, 1850)[0].overdue, true, 'idle for a moment: due')
  assert.equal(at(1850 + STALE_MS / 1000 + 1, 1850).length, 0, 'idle long past its time: its session is gone')
  assert.equal(at(1000 + STALE_MS / 1000 + 1, 1000).length, 1, 'idle since before its time: counted from its time')
})

test('a job\'s own offset is learned from its first run time and kept for the next ones', () => {
  // Every 6 hours at :13, reported to run at :43: a 30-minute offset.
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '13 */6 * * *', prompt: 'six-hourly', recurring: true } }] }),
    result(2, 'c1', { text: 'Scheduled recurring job j1 (Every 6 hours at :13). Auto-expires after 7 days.', toolUseResult: { id: 'j1', recurring: true, nextFireAt: nextCronTime('13 */6 * * *', ms(2))! + 30 * 60_000 } })
  ])
  const first = { ...p.bg!.items.get('j1')! }
  assert.equal(first.endsAt, ms(2) + 7 * DAY)
  assert.equal(new Date(first.dueAt!).getMinutes(), 43)
  const ranAt = first.dueAt! + 4000
  for (const l of fired((ranAt - ms(0)) / 1000, { taskId: 'j1', cron: '13 */6 * * *', prompt: 'six-hourly' })) p.line(l)
  const next = first.dueAt! + 6 * 3600_000
  assert.equal(p.bg!.items.get('j1')!.dueAt, next)
  // Known offset: late by more than a minute past it is overdue.
  assert.equal(p.bg!.pending(next + 30_000, null)[0].overdue, false)
  assert.equal(p.bg!.pending(next + 90_000, null)[0].overdue, true)
})

test('a reported run just after a slot before the job was made still gives the offset', () => {
  // Made at 10:20 for "13 * * * *"; Claude Code reports 10:43 (the 10:13 slot plus 30 minutes).
  const made = 20 * 60
  const { p } = feed([
    assistant(made - 1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '13 * * * *', prompt: 'hourly' } }] }),
    result(made, 'c1', { toolUseResult: { id: 'j1', recurring: true, nextFireAt: nextCronTime('13 * * * *', ms(0))! + 30 * 60_000 } })
  ])
  const j = p.bg!.items.get('j1')!
  assert.equal(j.offset, 30 * 60_000)
  assert.equal(j.slack, 0)
})

test('without a reported time, a recurring job may run up to half its period late, at most 30 minutes', () => {
  const { p } = feed([
    blob('assistant', [{ type: 'tool_use', id: 'c1', name: 'CronCreate', input: { cron: '*/10 * * * *', prompt: 'often' } }]),
    apiAt(1),
    blob('user', [{ type: 'tool_result', tool_use_id: 'c1', content: 'Scheduled recurring job jq1abcde (Every 10 minutes).' }]),
    blob('assistant', [{ type: 'tool_use', id: 'c2', name: 'CronCreate', input: { cron: '0 */6 * * *', prompt: 'rarely' } }]),
    blob('user', [{ type: 'tool_result', tool_use_id: 'c2', content: 'Scheduled recurring job jq2abcde (Every 6 hours).' }])
  ])
  assert.equal(p.bg!.items.get('jq1abcde')!.slack, 5 * 60_000)
  assert.equal(p.bg!.items.get('jq2abcde')!.slack, 30 * 60_000)
  assert.equal(p.bg!.items.get('jq1abcde')!.endsAt, null, 'no expiry stated: none assumed')
  const due = p.bg!.items.get('jq1abcde')!.dueAt!
  assert.equal(p.bg!.pending(due + 5 * 60_000, null).find((x) => x.id === 'jq1abcde')!.overdue, false)
  assert.equal(p.bg!.pending(due + 6 * 60_000 + 1000, null).find((x) => x.id === 'jq1abcde')!.overdue, true)
})

test('running work first by start, then schedules by next run', () => {
  const { p } = feed([
    assistant(1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '0 12 * * *', prompt: 'noon' } }] }),
    result(2, 'c1', { toolUseResult: { id: 'j1', recurring: true, nextFireAt: ms(7200) } }),
    assistant(3, { tools: [{ id: 'w1', name: 'ScheduleWakeup', input: { delaySeconds: 600, prompt: 'soon' } }] }),
    result(4, 'w1', { toolUseResult: { scheduledFor: ms(604) } }),
    bash(5, 't2', 'second'),
    started(6, 't2', 'b2'),
    bash(3, 't1', 'first'),
    started(4, 't1', 'b1')
  ])
  assert.deepEqual(ids(p), ['b1', 'b2', 'wakeup', 'j1'])
})

test('a subagent transcript tracks no background work', () => {
  const p = new TranscriptParser(() => {}, { background: false })
  p.line(bash(1, 't1', 'x'))
  p.line(started(2, 't1', 'b1'))
  assert.equal(p.bg, null)
})

test('notification blocks: only the ones with a status end a task', () => {
  const text = `${notification('a', 'completed')}\n<task-notification>\n<task-id>b</task-id>\n<summary>Monitor event</summary>\n</task-notification>\n${notification('c', 'failed')}`
  assert.deepEqual(endedTasks(text), [
    { id: 'a', status: 'completed' },
    { id: 'c', status: 'failed' }
  ])
  assert.deepEqual(endedTasks('no notifications here'), [])
})

test('the next run read from text: local time, this year or the next', () => {
  const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
  assert.equal(nextRunOf('Next run: Nov 21 6:43pm. Session-only', local(2026, 11, 21, 18, 3)), local(2026, 11, 21, 18, 43))
  assert.equal(nextRunOf('Next run: Nov 16 12:05am.', local(2026, 11, 15, 23, 0)), local(2026, 11, 16, 0, 5))
  assert.equal(nextRunOf('Next run: Dec 1 12:30pm.', local(2026, 11, 30, 9, 0)), local(2026, 12, 1, 12, 30))
  assert.equal(nextRunOf('Next run: Jan 1 9:00am.', local(2026, 12, 31, 22, 0)), local(2027, 1, 1, 9, 0))
  // A one-shot may be reported a little before now.
  assert.equal(nextRunOf('Next run: Nov 21 6:00pm.', local(2026, 11, 21, 18, 1)), local(2026, 11, 21, 18, 0))
  assert.equal(nextRunOf('no time here', local(2026, 1, 1)), null)
  assert.equal(nextRunOf('Next run: Foo 1 9:00am.', local(2026, 1, 1)), null)
})

test('a run shows the job\'s offset when it was not known', () => {
  const { p } = feed([
    blob('assistant', [{ type: 'tool_use', id: 'c1', name: 'CronCreate', input: { cron: '*/20 * * * *', prompt: 'often' } }]),
    apiAt(1),
    blob('user', [{ type: 'tool_result', tool_use_id: 'c1', content: 'Scheduled recurring job jz1abcde (Every 20 minutes).' }])
  ])
  const j = p.bg!.items.get('jz1abcde')!
  assert.ok(j.slack > 0)
  const slot = j.dueAt!
  for (const l of fired((slot + 7 * 60_000 - ms(0)) / 1000, { taskId: 'jz1abcde', cron: '*/20 * * * *', prompt: 'often' })) p.line(l)
  assert.equal(j.offset, 7 * 60_000)
  assert.equal(j.slack, 0)
  assert.equal(j.dueAt, slot + 27 * 60_000)
})

test('a run picks the latest cron time before it, not an earlier one', () => {
  // "0,40 * * * *" made at 12:41 and reported for 13:05: the 13:00 time plus 5 minutes.
  const made = new Date(2026, 0, 1, 12, 41).getTime()
  const reported = new Date(2026, 0, 1, 13, 5).getTime()
  const p = new TranscriptParser()
  const s = (t: number) => (t - ms(0)) / 1000
  p.line(assistant(s(made) - 1, { tools: [{ id: 'c1', name: 'CronCreate', input: { cron: '0,40 * * * *', prompt: 'x' } }] }))
  p.line(result(s(made), 'c1', { toolUseResult: { id: 'jy1abcde', recurring: true, nextFireAt: reported } }))
  const j = p.bg!.items.get('jy1abcde')!
  assert.equal(j.offset, 5 * 60_000)
  for (const l of fired(s(reported), { taskId: 'jy1abcde', cron: '0,40 * * * *', prompt: 'x' })) p.line(l)
  assert.equal(j.dueAt, new Date(2026, 0, 1, 13, 45).getTime())
})
