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

/**
 * Mascot fixtures. crew-live.json: two tasks recorded from agnx on 2026-11-25 with the mascot fields
 * (1124-2051-8e7f merge-ready, solo; 1124-2056-0510 stopped in a split build) and one synthetic running
 * task, 1125-1012-ab12, with per-seat lines in the shape of Agni-crew #42 (agni.crew.seat_event/1).
 * crew-seat-events.jsonl: that task's raw events.jsonl lines, every #42 field included.
 */
export const liveLine = () => JSON.stringify(JSON.parse(read('crew-live.json')))
export const liveReport = () => JSON.parse(read('crew-live.json')) as Record<string, any>
export const seatEventsJsonl = () => read('crew-seat-events.jsonl')

/** A moment in the synthetic running task: the leader and the helper are both writing. */
export const LIVE_AT = Date.parse('2026-11-25T10:15:12Z')

/**
 * GPU tool output recorded on 2026-11-25: rocm-smi on agni1 (RX 9070 XT, R9700 and the CPU's
 * integrated graphics, with the warnings it prints first) and nvidia-smi on agni2 (RTX 5060).
 * Card names, temperatures and VRAM only; serials, GUIDs and SKUs were taken out.
 */
export const rocmSmiSample = () => read('rocm-smi-sample.txt')
export const nvidiaSmiSample = () => read('nvidia-smi-sample.csv')
