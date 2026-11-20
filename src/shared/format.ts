// Number and time formatting shared by the panel and the status bar.

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '') + 'M'
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  if (n < 100) return '$' + n.toFixed(2)
  return '$' + Math.round(n).toLocaleString('en-US')
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's'
  const h = Math.floor(m / 60)
  return h + 'h' + String(m % 60).padStart(2, '0') + 'm'
}

export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

/** Short model label: claude-opus-5-5 -> Opus 5.5, claude-sonnet-4-5-20250929 -> Sonnet 4.5. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return '–'
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?/i.exec(model)
  if (!m) return model
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `${name} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' 1M' : ''}`
}
