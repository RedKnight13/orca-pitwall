import { assert, test } from 'orca/testing'
import { fmtClock, fmtUntil } from './format'

test('time left reads coarse', () => {
  assert.equal(fmtUntil(-5000), '0s')
  assert.equal(fmtUntil(44_200), '45s')
  assert.equal(fmtUntil(14 * 60_000 + 5000), '14m')
  assert.equal(fmtUntil(2 * 3600_000 + 5 * 60_000), '2h05m')
  assert.equal(fmtUntil(3 * 86_400_000 + 4 * 3600_000), '3d4h')
  assert.equal(fmtUntil(NaN), '0s')
})

test('a clock time: the hour today, the date otherwise', () => {
  const now = new Date(2026, 10, 21, 9, 0).getTime()
  assert.equal(fmtClock(new Date(2026, 10, 21, 14, 5).getTime(), now), '14:05')
  assert.equal(fmtClock(new Date(2026, 10, 16, 9, 39).getTime(), now), 'Nov 16 09:39')
})
