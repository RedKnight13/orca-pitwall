// File access for the Claude Code adapter: where transcripts live, reading them as they grow,
// and the one setting the context gauge needs. Read-only; never writes anywhere.
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export function claudeDir(setting?: unknown): string {
  const raw = typeof setting === 'string' && setting.trim() ? setting.trim() : process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw
}

/** Finds <claudeDir>/projects/<any>/<sessionId>.jsonl; caches the folder list for 5 s. */
export class TranscriptLocator {
  private dirs: string[] = []
  private listedAt = 0
  private readonly found = new Map<string, string>()

  constructor(private readonly root: () => string) {}

  async find(sessionId: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) return null
    const hit = this.found.get(sessionId)
    if (hit && (await exists(hit))) return hit
    const projects = join(this.root(), 'projects')
    if (Date.now() - this.listedAt > 5000) {
      this.listedAt = Date.now()
      try {
        const entries = await fs.readdir(projects, { withFileTypes: true })
        this.dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        this.dirs = []
      }
    }
    for (const d of this.dirs) {
      const p = join(projects, d, sessionId + '.jsonl')
      if (await exists(p)) {
        this.found.set(sessionId, p)
        return p
      }
    }
    return null
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export interface SubagentFile {
  agentId: string
  path: string
  meta: { agentType?: string; description?: string; toolUseId?: string; finished?: boolean; model?: string; pickedEffortModel?: string }
}

/**
 * Subagent transcripts of one session: <dir>/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json).
 * Reads the meta only for ids `wantMeta` accepts (new or still running ones); the others get `meta: null`.
 */
export async function listSubagents(transcript: string, wantMeta: (agentId: string) => boolean = () => true): Promise<(Omit<SubagentFile, 'meta'> & { meta: SubagentFile['meta'] | null })[]> {
  const dir = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents')
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: (Omit<SubagentFile, 'meta'> & { meta: SubagentFile['meta'] | null })[] = []
  for (const n of names) {
    const m = /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(n)
    if (!m) continue
    if (!wantMeta(m[1])) {
      out.push({ agentId: m[1], path: join(dir, n), meta: null })
      continue
    }
    let meta: SubagentFile['meta'] = {}
    try {
      meta = JSON.parse(await fs.readFile(join(dir, `agent-${m[1]}.meta.json`), 'utf8'))
    } catch {
      /* no meta yet */
    }
    out.push({ agentId: m[1], path: join(dir, n), meta })
  }
  return out
}

/** Reads a file as it grows, one complete line at a time. Restarts when the file shrinks. */
export class Tail {
  offset = 0
  mtime = 0
  private rest = ''
  private decoder = new StringDecoder('utf8')
  private busy = false
  /** False until a poll has read to the end of the file once (a long transcript takes several polls). */
  caughtUp = false

  constructor(readonly path: string) {}

  /** Calls onLine for each new complete line; returns 'reset' when the file was rewritten. */
  async poll(onLine: (line: string) => void, maxBytes = 16 * 1024 * 1024): Promise<'none' | 'read' | 'reset' | 'gone'> {
    if (this.busy) return 'none'
    this.busy = true
    try {
      let st
      try {
        st = await fs.stat(this.path)
      } catch (err) {
        // Only a missing file is gone; a passing error (too many open files, permissions) is retried.
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'none'
      }
      this.mtime = st.mtimeMs
      let result: 'none' | 'read' | 'reset' = 'none'
      if (st.size < this.offset) {
        this.offset = 0
        this.rest = ''
        this.decoder = new StringDecoder('utf8')
        result = 'reset'
      }
      if (st.size === this.offset) {
        this.caughtUp = true
        return result
      }
      const fh = await fs.open(this.path, 'r')
      try {
        const end = Math.min(st.size, this.offset + maxBytes)
        // Sized to what is new: a live session appends a few KB per poll.
        const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, end - this.offset))
        while (this.offset < end) {
          const { bytesRead } = await fh.read(chunk, 0, Math.min(chunk.length, end - this.offset), this.offset)
          if (bytesRead <= 0) break
          this.offset += bytesRead
          const text = this.rest + this.decoder.write(chunk.subarray(0, bytesRead))
          const lines = text.split('\n')
          this.rest = lines.pop() ?? ''
          for (const l of lines) onLine(l)
        }
      } finally {
        await fh.close()
      }
      this.caughtUp = this.offset >= st.size
      return result === 'reset' ? 'reset' : 'read'
    } finally {
      this.busy = false
    }
  }
}

export interface CompactSettings {
  enabled: boolean
  windows: Record<string, number>
}

let cache: { path: string; mtime: number; value: CompactSettings } | null = null

/** Claude Code's auto-compact window per model, from <claudeDir>/settings.json. */
export async function compactSettings(root: string): Promise<CompactSettings> {
  const path = join(root, 'settings.json')
  try {
    const st = await fs.stat(path)
    if (cache && cache.path === path && cache.mtime === st.mtimeMs) return cache.value
    const json = JSON.parse(await fs.readFile(path, 'utf8')) as {
      autoCompactEnabled?: boolean
      autoCompactWindow?: number
      modelSettings?: Record<string, { autoCompactWindow?: number }>
    }
    const windows: Record<string, number> = {}
    if (typeof json.autoCompactWindow === 'number') windows['*'] = json.autoCompactWindow
    for (const [model, s] of Object.entries(json.modelSettings ?? {}))
      if (s && typeof s.autoCompactWindow === 'number') windows[model] = s.autoCompactWindow
    const value = { enabled: json.autoCompactEnabled !== false, windows }
    cache = { path, mtime: st.mtimeMs, value }
    return value
  } catch {
    return { enabled: true, windows: {} }
  }
}
