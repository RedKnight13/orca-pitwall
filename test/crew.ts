// Recorded output of the Crew scripts (src/worker/crew/scripts.ts), read from agnx and agni1 on
// 2026-11-24. The crew tasks are its synthetic fixture packages; no key, hash or secret is in them.
import { readFileSync } from 'node:fs'

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** The agnx report as one JSON line, as the script prints it. */
export const agnxLine = () => JSON.stringify(JSON.parse(read('crew-agnx.json')))
export const agnxReport = () => JSON.parse(read('crew-agnx.json')) as Record<string, any>
export const gatewayLine = () => JSON.stringify(JSON.parse(read('crew-gateway.json')))

/** When the fixtures were recorded. */
export const RECORDED_AT = Date.parse('2026-11-24T16:45:00Z')
