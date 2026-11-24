// Runs a script on another host over the person's own SSH setup: `ssh <alias> python3 -`, the
// script on stdin. No shell on this side, no port opened anywhere, nothing installed remotely.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Runs `script` on `host` and resolves with its stdout; rejects with a short reason. */
export type Runner = (host: string, script: string, timeoutMs: number) => Promise<string>

/** An SSH alias or host name. Rejects anything ssh could read as an option (a leading dash) or that holds spaces or shell characters. */
export function validHost(host: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._-]{0,62}$/.test(host)
}

const SSH = existsSync('/usr/bin/ssh') ? '/usr/bin/ssh' : 'ssh'

export const sshRunner: Runner = (host, script, timeoutMs) =>
  new Promise((resolve, reject) => {
    if (!validHost(host)) return reject(new Error('bad host name'))
    const args = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '--', host, 'python3', '-']
    const child = execFile(SSH, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (!err) return resolve(stdout)
      const e = err as { killed?: boolean; code?: unknown }
      // ssh exits 255 when it cannot reach the host or log in.
      reject(new Error(e.killed ? 'timeout' : e.code === 255 ? 'unreachable' : e.code === 'ENOENT' ? 'no ssh' : `exit ${e.code ?? '?'}`))
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(script)
  })
