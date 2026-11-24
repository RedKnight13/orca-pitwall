// The Pitwall panel (HTML frame). Asks the worker for a snapshot, then redraws each section only
// when its markup changes; clocks tick once a second without a redraw.
import '../shared/protocol'
import { fmtDuration, fmtUntil } from '../shared/format'
import { EMPTY_SNAPSHOT, type Scope, type Snapshot, type ToolFamily } from '../shared/types'
import { stable } from './diff'
import { INITIAL_UI, LITELLM_URL, REPO_URL, render, sectionOpen, type Rendered, type UiState } from './render'
import { CSS } from './styles'

let snap: Snapshot = EMPTY_SNAPSHOT
const ONLY_KEY = 'pitwall.only'
let ui: UiState = { ...INITIAL_UI, expanded: {}, only: readOnly() }

// The "show only this agent" choice survives a panel reload; it is a per-viewer convenience.
function readOnly(): string | null {
  try {
    return localStorage.getItem(ONLY_KEY) || null
  } catch {
    return null
  }
}

function writeOnly(key: string | null): void {
  try {
    if (key) localStorage.setItem(ONLY_KEY, key)
    else localStorage.removeItem(ONLY_KEY)
  } catch {
    // Storage blocked: the choice lasts until the panel reloads.
  }
}
let loaded = false
const parts: Record<keyof Rendered, HTMLElement> = {} as Record<keyof Rendered, HTMLElement>
const last: Partial<Rendered> = {}

function mountShell(): void {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  for (const k of ['header', 'alerts', 'agents', 'crew', 'gate', 'log', 'footer'] as (keyof Rendered)[]) {
    const el = document.createElement('div')
    el.dataset.part = k
    document.body.appendChild(el)
    parts[k] = el
  }
  document.body.addEventListener('click', onClick)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.menu) setUi({ menu: false })
    // Rows that act like buttons (role="button") answer Enter and Space as buttons do.
    const el = document.activeElement as HTMLElement | null
    if ((e.key === 'Enter' || e.key === ' ') && el?.getAttribute('role') === 'button' && el.dataset.action) {
      e.preventDefault()
      el.click()
    }
  })
}

function draw(): void {
  if (!loaded) {
    parts.agents.innerHTML = '<div class="muted small" style="padding:20px 4px">Loading…</div>'
    return
  }
  const out = render(snap, ui, Date.now())
  // A redraw replaces the markup; keep keyboard focus on the same control.
  const active = document.activeElement as HTMLElement | null
  // Only while the panel has focus: restoring it otherwise would pull typing away from the terminal.
  const sig = document.hasFocus() && active && active !== document.body ? focusSig(active) : null
  for (const k of Object.keys(out) as (keyof Rendered)[]) {
    // Clocks tick on their own (tickClocks): a render that differs only in them changes nothing.
    const same = stable(out[k])
    if (last[k] === same) continue
    last[k] = same
    if (k === 'crew') {
      patch(parts[k], out[k])
      playOnce(parts[k])
      phase(parts[k])
    } else parts[k].innerHTML = out[k]
  }
  if (sig && (document.activeElement === document.body || !document.activeElement?.isConnected)) restoreFocus(sig)
  crewVisibility()
}

// ---- Crew: redraw only what changed, by task and seat ------------------------------------------

const keyOf = (n: Node): string => (n instanceof HTMLElement ? `${n.tagName}|${n.dataset.k ?? ''}` : `#${n.nodeType}`)
const markup = (n: Node): string => stable(n instanceof Element ? n.outerHTML : (n.textContent ?? ''))
const attrsOf = (el: Element): string => stable(el.cloneNode(false) instanceof Element ? (el.cloneNode(false) as Element).outerHTML : '')

/**
 * Puts `html` into `root`, keeping every node whose markup (clocks aside) did not change. A task
 * card or seat row (data-k) that changed is updated inside; one that did not is left alone, so its
 * face keeps moving and its focus stays.
 */
function patch(root: HTMLElement, html: string): void {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  morph(root, tpl.content)
}

function morph(dst: Node, src: Node): void {
  const a = Array.from(dst.childNodes)
  const b = Array.from(src.childNodes)
  if (a.length === b.length && a.every((n, i) => keyOf(n) === keyOf(b[i]))) {
    a.forEach((n, i) => {
      const m = b[i]
      if (markup(n) === markup(m)) return
      if (n instanceof Element && m instanceof Element && attrsOf(n) === attrsOf(m)) return morph(n, m)
      n.parentNode?.replaceChild(m.cloneNode(true), n)
    })
    return
  }
  // Blocks came or went: reuse each unchanged keyed node, take the rest from the new markup.
  const old = new Map<string, Node>()
  for (const n of a) if (n instanceof HTMLElement && n.dataset.k) old.set(n.dataset.k, n)
  const next = b.map((m) => {
    const k = m instanceof HTMLElement ? m.dataset.k : undefined
    const prev = k ? old.get(k) : undefined
    if (prev && markup(prev) === markup(m)) return prev
    if (prev instanceof Element && m instanceof Element && attrsOf(prev) === attrsOf(m)) {
      morph(prev, m)
      return prev
    }
    return m.cloneNode(true)
  })
  ;(dst as Element | DocumentFragment).replaceChildren(...next)
}

/** All looping motion shares this period; a face that appears starts at the wall clock's phase, so faces move in step. */
const LOOP_MS = 2400
function phase(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.bob, .zz').forEach((el) => {
    if (el.dataset.ph) return
    el.dataset.ph = '1'
    el.style.animationDelay = `-${Date.now() % LOOP_MS}ms`
  })
}

// ---- Crew: tell the worker when the section is on screen ---------------------------------------
// It reads card temperatures only then (and only while a task runs). A lease: the panel repeats it,
// so a closed panel stops the reads within a minute and a half.
let shownSent: boolean | null = null
let shownAt = 0
let onScreen = true

function crewVisibility(): void {
  const shown = !!snap.crew && sectionOpen(ui, 'crew') && !document.hidden && onScreen
  document.documentElement.classList.toggle('paused', !shown)
  if (shown === shownSent && (!shown || Date.now() - shownAt < 45_000)) return
  shownSent = shown
  shownAt = Date.now()
  void request(() => orca.plugin.request('pitwall.crewVisible', { visible: shown }))
}

// The crew's one-shot effects (a hand-off, confetti) play once each, however often the section
// redraws: a redraw resumes one where it was (a negative delay), and hides it once it has played.
const ONE_SHOT_MS = 4000
const played = new Map<string, number>()
function playOnce(root: HTMLElement): void {
  const now = Date.now()
  root.querySelectorAll<HTMLElement>('[data-once]').forEach((el) => {
    const key = el.dataset.once ?? ''
    const first = played.get(key) ?? now
    played.set(key, first)
    const elapsed = now - first
    if (elapsed > ONE_SHOT_MS) el.classList.add('played')
    else el.style.setProperty('--el', `-${elapsed}ms`)
  })
  if (played.size > 200) for (const k of [...played.keys()].slice(0, 100)) played.delete(k)
}

function focusSig(el: HTMLElement): string | null {
  const a = el.dataset.action
  if (!a) return null
  return [a, el.dataset.key ?? '', el.dataset.keyX ?? '', el.dataset.scope ?? '', el.dataset.family ?? ''].join('|')
}

function restoreFocus(sig: string): void {
  const els = document.querySelectorAll<HTMLElement>('[data-action]')
  for (let i = 0; i < els.length; i++) {
    if (focusSig(els[i]) === sig) {
      els[i].focus({ preventScroll: true })
      return
    }
  }
}

function tickClocks(): void {
  if (document.hidden) return
  const now = Date.now()
  document.querySelectorAll<HTMLElement>('[data-grow]').forEach((el) => {
    el.style.flexGrow = Math.max((now - Number(el.dataset.grow)) / 1000, 1).toFixed(1)
  })
  document.querySelectorAll<HTMLElement>('[data-since]').forEach((el) => {
    el.textContent = fmtDuration(now - Number(el.dataset.since))
  })
  document.querySelectorAll<HTMLElement>('[data-ago]').forEach((el) => {
    el.textContent = fmtDuration(now - Number(el.dataset.ago))
  })
  document.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => {
    el.textContent = fmtUntil(Number(el.dataset.until) - now)
  })
}

function setUi(patch: Partial<UiState>): void {
  ui = { ...ui, ...patch }
  draw()
}

function accept(s: Snapshot): void {
  snap = s
  loaded = true
  draw()
}

async function request<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.error('pitwall:', (err as Error).message)
    return null
  }
}

function onClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')
  if (!target) {
    if (ui.menu) setUi({ menu: false })
    return
  }
  const action = target.dataset.action
  if (action === 'menu') return setUi({ menu: !ui.menu })
  if (action === 'scope') {
    const scope = target.dataset.scope as Scope
    snap = { ...snap, scope }
    draw()
    void request(() => orca.plugin.request('pitwall.setScope', { scope })).then((s) => s && accept(s))
    return
  }
  if (action === 'demo') {
    setUi({ menu: false })
    void request(() => orca.plugin.request('pitwall.setDemo', { on: !snap.demo })).then((s) => s && accept(s))
    return
  }
  if (action === 'focus') {
    const key = target.dataset.key ?? ''
    target.blur()
    void request(() => orca.plugin.request('pitwall.focus', { key })).then((r) => {
      if (r && !r.focused) console.warn('pitwall: could not focus the terminal:', r.reason ?? 'unknown')
    })
    return
  }
  if (action === 'crew') {
    setUi({ menu: false })
    void request(() => orca.plugin.request('pitwall.setCrew', { on: !snap.crew })).then((s) => s && accept(s))
    return
  }
  if (action === 'litellm') {
    // Only on this click, in the person's browser; Orca asks once before opening the host.
    void request(async () => (orca.shell ? orca.shell.openExternal(LITELLM_URL) : null))
    return
  }
  if (action === 'github') {
    setUi({ menu: false })
    // Only on this click, in the person's browser; Orca asks once before opening github.com.
    void request(async () => (orca.shell ? orca.shell.openExternal(REPO_URL) : null))
    return
  }
  if (action === 'reset') {
    setUi({ menu: false })
    void request(() => orca.plugin.request('pitwall.reset')).then((s) => s && accept(s))
    return
  }
  if (action === 'only') {
    const key = target.dataset.key || null
    writeOnly(key)
    return setUi({ only: key, family: null })
  }
  if (action === 'family') {
    const f = target.dataset.family as ToolFamily
    return setUi({ family: ui.family === f ? null : f })
  }
  if (action === 'expand') {
    const key = target.dataset.keyX ?? target.dataset.key ?? ''
    // A section starts open or closed by default; toggle what the person sees, not the stored flag.
    // A control that starts open or closed by default says which (data-open); toggle what the person sees.
    const open = target.dataset.open !== undefined ? target.dataset.open === '1' : key.startsWith('sec:') ? sectionOpen(ui, key.slice(4)) : !!ui.expanded[key]
    // Opening an agent counts as looking at its finished turn.
    if (!open && key.startsWith('car:')) void request(() => orca.plugin.request('pitwall.seen', { key: key.slice(4) }))
    return setUi({ expanded: { ...ui.expanded, [key]: !open } })
  }
}

mountShell()
draw()
orca.plugin.on('pitwall.snapshot', (s) => accept(s))
void request(() => orca.plugin.request('pitwall.snapshot')).then((s) => s && accept(s))
setInterval(tickClocks, 1000)
setInterval(crewVisibility, 15_000)
document.addEventListener('visibilitychange', () => {
  crewVisibility()
  tickClocks()
})
// Scrolled out of view counts as hidden: the faces stop and the card reads stop.
if (typeof IntersectionObserver === 'function')
  new IntersectionObserver((entries) => {
    onScreen = entries.some((e) => e.isIntersecting)
    crewVisibility()
  }).observe(parts.crew)
