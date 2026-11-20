// Short, credential-masked summaries of tool calls. Nothing here leaves the machine; masking
// keeps secrets off screen and out of screenshots people share.
import type { ToolFamily } from '../shared/types'

// Every pattern is linear in the input, and mask() looks at most MASK_MAX characters, so a minified
// bundle passed to `node -e` cannot stall the worker (and with it Orca's tool hooks).
const MASK_MAX = 4096
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|rk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,}|dckr_pat_[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{20,})\b/g, '***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***'],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1***'],
  [/(discord(?:app)?\.com\/api\/webhooks\/)[^\s"']+/g, '$1***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1***@'],
  // --password x, --token=x, curl -u user:pass, aws configure set <secret name> x
  [/((?:^|\s)--?(?:password|passwd|pass|token|secret|api-key|apikey|auth-token|access-token)(?:=|\s+))(?!\*\*\*)[^\s"']+/gi, '$1***'],
  [/((?:^|\s)(?:-u|--user)\s+[^\s:"']+:)[^\s"']+/g, '$1***'],
  [/(\baws\s+configure\s+set\s+\S*(?:secret|token|key)\S*\s+)\S+/gi, '$1***']
]

// name=value or "name": value, where the name ends like a secret.
const KEY_VALUE = /(^|[\s"'&?;,{(])([A-Za-z0-9_.][A-Za-z0-9_.-]{0,63})(["']?\s*[=:]\s*)(?!\/\/|(?:Bearer|Basic|Token)\s)("[^"]*"|'[^']*'|[^\s&;,"')}]+)/g
const SECRET_NAME_END = /(?:pass(?:word|wd)|secret|token|api_?key|access_?key|secret_?key|private_?key|credentials?|cookie)$/i
const SECRET_NAME_PART = /(?:^|[-_.])(?:key|sig|signature|auth|pwd|pass)$/i

/** Masks credential shapes in text bound for the screen. Looks at the first 4096 characters only. */
export function mask(text: string): string {
  let out = text.length > MASK_MAX ? text.slice(0, MASK_MAX) : text
  // An unterminated "-p" for login commands (mysql -pSECRET, docker login -p SECRET).
  if (/\b(?:mysql|mysqldump|mariadb|login|sshpass)\b/.test(out)) out = out.replace(/(\s-p\s*)(?!\*\*\*)[^\s"']+/g, '$1***')
  if (/\bredis-cli\b/.test(out)) out = out.replace(/(\s-a\s+)(?!\*\*\*)[^\s"']+/g, '$1***')
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep)
  return out.replace(KEY_VALUE, (all, pre: string, name: string, sep: string, value: string) =>
    value !== '***' && (SECRET_NAME_END.test(name) || SECRET_NAME_PART.test(name)) ? `${pre}${name}${sep}***` : all
  )
}

export function oneLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

export function familyOf(tool: string): ToolFamily {
  if (tool.startsWith('mcp__')) return 'mcp'
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead|Glob|Grep|LS|apply_patch|read_file|write_file|edit_file)$/i.test(tool)) return 'file'
  if (/^(Bash|BashOutput|KillBash|KillShell|PowerShell|shell|exec_command|local_shell|Monitor)$/i.test(tool)) return 'shell'
  if (/^(WebFetch|WebSearch|web_search|web_fetch)$/i.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage|TaskCreate|TaskUpdate|TaskStop|Workflow)$/i.test(tool)) return 'agent'
  return 'other'
}

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'write_file', 'edit_file'])

/** Shortens an absolute path to its last two segments, relative to cwd when inside it. */
export function shortPath(p: string, cwd?: string | null): string {
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1)
  const parts = p.split('/').filter(Boolean)
  return parts.length <= 2 ? p : '…/' + parts.slice(-2).join('/')
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** The summary shown in the gate and the log: tool-specific, masked, one line. */
export function summarizeTool(tool: string, input: unknown, cwd?: string | null): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const path = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path)
  let s: string
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'shell') s = str(i.description) ?? str(i.command) ?? ''
  else if (tool === 'Grep') s = `${str(i.pattern) ?? ''}${path ? ' in ' + shortPath(path, cwd) : ''}`
  else if (tool === 'Glob') s = str(i.pattern) ?? ''
  else if (path) s = shortPath(path, cwd)
  else if (tool === 'WebFetch') s = mask(str(i.url) ?? '').replace(/^https?:\/\//, '').replace(/[?#].*$/, '')
  else if (tool === 'WebSearch') s = str(i.query) ?? ''
  else if (tool === 'Agent' || tool === 'Task') s = `${str(i.subagent_type) ?? 'agent'}: ${str(i.description) ?? ''}`
  else if (tool.startsWith('mcp__')) s = tool.split('__').slice(1).join(' · ')
  else s = str(i.description) ?? str(i.command) ?? str(i.query) ?? ''
  return oneLine(mask(s))
}

/** The tool name as people read it: mcp__server__tool -> server.tool. */
export function toolLabel(tool: string): string {
  if (tool.startsWith('mcp__')) {
    const [, server, ...rest] = tool.split('__')
    return `${server}.${rest.join('_')}`
  }
  return tool
}
