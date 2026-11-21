import { assert, test } from 'orca/testing'
import { nextCronTime, parseCron } from './cron'

// Local time, like Claude Code's own schedules: the tests hold in any time zone.
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime()

test('every few minutes: the next step after now', () => {
  assert.equal(nextCronTime('*/3 * * * *', local(2026, 1, 1, 10, 0, 20)), local(2026, 1, 1, 10, 3))
  assert.equal(nextCronTime('*/3 * * * *', local(2026, 1, 1, 10, 58)), local(2026, 1, 1, 11, 0))
  assert.equal(nextCronTime('* * * * *', local(2026, 1, 1, 10, 0, 59)), local(2026, 1, 1, 10, 1))
})

test('strictly after: a time on the schedule gives the following one', () => {
  assert.equal(nextCronTime('0 * * * *', local(2026, 1, 1, 10, 0)), local(2026, 1, 1, 11, 0))
})

test('a one-shot date, like the ones Claude Code writes', () => {
  assert.equal(nextCronTime('39 9 16 11 *', local(2026, 11, 16, 9, 9)), local(2026, 11, 16, 9, 39))
  // Past this year's date: next year's.
  assert.equal(nextCronTime('39 9 16 11 *', local(2026, 11, 16, 9, 40)), local(2027, 11, 16, 9, 39))
})

test('lists, ranges and steps in a range', () => {
  assert.equal(nextCronTime('15,45 9-17 * * *', local(2026, 1, 1, 17, 50)), local(2026, 1, 2, 9, 15))
  assert.equal(nextCronTime('0 8-18/5 * * *', local(2026, 1, 1, 9, 0)), local(2026, 1, 1, 13, 0))
  assert.equal(nextCronTime('0 10/6 * * *', local(2026, 1, 1, 17, 0)), local(2026, 1, 1, 22, 0))
})

test('days of the week, with Sunday as 0 or 7', () => {
  // 2026-01-01 is a Thursday.
  assert.equal(nextCronTime('0 9 * * 1-5', local(2026, 1, 2, 10, 0)), local(2026, 1, 5, 9, 0))
  assert.equal(nextCronTime('0 9 * * 0', local(2026, 1, 1)), local(2026, 1, 4, 9, 0))
  assert.equal(nextCronTime('0 9 * * 7', local(2026, 1, 1)), local(2026, 1, 4, 9, 0))
})

test('day of month and day of week both set: either one fires', () => {
  // The 15th, or any Monday: Monday Jan 5 comes first.
  assert.equal(nextCronTime('0 0 15 * 1', local(2026, 1, 1)), local(2026, 1, 5, 0, 0))
})

test('a day field with a step still counts as unrestricted, as in Vixie cron', () => {
  // Odd days that are Mondays: Jan 5 2026 is a Monday and odd.
  assert.equal(nextCronTime('0 9 */2 * 1', local(2026, 1, 1)), local(2026, 1, 5, 9, 0))
})

test('month boundaries and a day that only some months have', () => {
  assert.equal(nextCronTime('0 0 31 * *', local(2026, 2, 1)), local(2026, 3, 31))
  assert.equal(nextCronTime('0 0 29 2 *', local(2026, 1, 1)), local(2028, 2, 29))
})

test('a schedule that never fires, or one Pitwall does not read, gives null', () => {
  assert.equal(nextCronTime('0 0 30 2 *', local(2026, 1, 1)), null)
  for (const expr of ['@hourly', '0 9 * * MON', '0 0 * *', '0 0 * * * *', '61 * * * *', '5-1 * * * *', '*/0 * * * *', '']) {
    assert.equal(parseCron(expr), null, expr)
    assert.equal(nextCronTime(expr, local(2026, 1, 1)), null, expr)
  }
  assert.equal(nextCronTime('* * * * *', NaN), null)
})

test('a time skipped by a daylight-saving change is never returned', () => {
  // Whatever the machine's zone, every answer is a real local time on the schedule, and never the input.
  for (let day = 0; day < 366; day++) {
    const from = local(2026, 1, 1) + day * 86_400_000
    const t = nextCronTime('30 2 * * *', from)!
    const d = new Date(t)
    assert.ok(t > from)
    assert.equal(d.getMinutes(), 30)
    assert.ok(d.getHours() === 2 || d.getHours() === 3, `hour ${d.getHours()}`)
  }
})
