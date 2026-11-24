// Card temperature and VRAM for the crew's mascots. A read-only script runs on each card host over
// the person's own SSH (`ssh <host> python3 -`, nothing installed, no port opened). It calls only
// tools already there: nvidia-smi (agni2) and rocm-smi (agni1). The worker parses their output here,
// so the parsers are tested against recorded samples. A host that is off, or a tool that is missing,
// leaves the fields empty: the panel hides them rather than show a guess.

/** Prints one JSON line: each tool's raw stdout, or null when the tool is absent or fails. */
export const GPU_PY = String.raw`
import json, os, shutil, subprocess


def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        return r.stdout[-20000:] if r.returncode == 0 else None
    except Exception:
        return None


out = {"schema": "pitwall.gpu/1", "nvidia": None, "rocm": None}
if shutil.which("nvidia-smi"):
    out["nvidia"] = run(["nvidia-smi", "--query-gpu=name,temperature.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"])
if shutil.which("rocm-smi") and os.path.exists("/sys/module/amdgpu"):
    out["rocm"] = run(["rocm-smi", "--showtemp", "--showmeminfo", "vram", "--showproductname", "--json"])
print(json.dumps(out))
`

export interface GpuCard {
  /** Short card name, as the mascots show it: R9700, RX 9070 XT, RTX 5060. */
  card: string
  tempC: number | null
  vramGb: { used: number; total: number } | null
}

/** Amber from here, red from TEMP_BAD_C; the lab cuts power at 100 °C. */
export const TEMP_WARN_C = 85
export const TEMP_BAD_C = 95

const GB = 1024 ** 3
const MB_PER_GB = 1024

/** PCI device ids rocm-smi prints as "Card Model", for the cards the crew runs on. */
const AMD_MODEL: Record<string, string> = { '0x7551': 'R9700', '0x7550': 'RX 9070 XT' }

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(x) ? x : null
}

/** nvidia-smi --query-gpu=name,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits */
export function parseNvidiaSmi(text: string | null | undefined): GpuCard[] {
  const cards: GpuCard[] = []
  for (const line of String(text ?? '').split('\n')) {
    const f = line.split(',').map((x) => x.trim())
    if (f.length < 4 || !f[0]) continue
    const used = n(f[2])
    const total = n(f[3])
    cards.push({
      card: f[0].replace(/^NVIDIA\s+/, '').replace(/^GeForce\s+/, ''),
      tempC: n(f[1]),
      vramGb: used !== null && total !== null && total > 0 ? { used: used / MB_PER_GB, total: total / MB_PER_GB } : null
    })
  }
  return cards
}

/**
 * rocm-smi --showtemp --showmeminfo vram --showproductname --json. It may print warnings before the
 * JSON. Integrated graphics (under 4 GB of VRAM) are left out: the crew never runs on them.
 */
export function parseRocmSmi(text: string | null | undefined): GpuCard[] {
  const s = String(text ?? '')
  const start = s.indexOf('{"card')
  if (start < 0) return []
  let d: Record<string, Record<string, unknown>>
  try {
    d = JSON.parse(s.slice(start, s.lastIndexOf('}') + 1))
  } catch {
    return []
  }
  const cards: GpuCard[] = []
  for (const key of Object.keys(d).sort()) {
    const c = d[key]
    if (!c || typeof c !== 'object') continue
    const total = n(c['VRAM Total Memory (B)'])
    const used = n(c['VRAM Total Used Memory (B)'])
    if (total !== null && total < 4 * GB) continue
    const model = String(c['Card Model'] ?? '').toLowerCase()
    const series = typeof c['Card Series'] === 'string' && c['Card Series'] !== 'N/A' ? c['Card Series'] : null
    cards.push({
      card: AMD_MODEL[model] ?? series ?? (model ? `AMD ${model}` : key),
      tempC: n(c['Temperature (Sensor edge) (C)']),
      vramGb: used !== null && total !== null && total > 0 ? { used: used / GB, total: total / GB } : null
    })
  }
  return cards
}

/** Parses the GPU script's JSON line. Throws on output that is not the script's. */
export function parseGpuReport(raw: string): GpuCard[] {
  const d = JSON.parse(raw) as { schema?: unknown; nvidia?: unknown; rocm?: unknown }
  if (!d || d.schema !== 'pitwall.gpu/1') throw new Error('bad output')
  return [...parseNvidiaSmi(typeof d.nvidia === 'string' ? d.nvidia : null), ...parseRocmSmi(typeof d.rocm === 'string' ? d.rocm : null)]
}

/**
 * Where each model the crew config names is served. crew.toml says which model each seat uses (and
 * crew-agni1-only.toml which it falls back to); it does not say which card serves a model, so that
 * one fact lives here. A model not listed gets no card, and its mascot shows none.
 */
export const MODEL_CARD: Record<string, { host: string; card: string }> = {
  'agni-qwen27': { host: 'agni1', card: 'R9700' },
  'gemma-rx': { host: 'agni1', card: 'RX 9070 XT' },
  inkling: { host: 'agni2', card: 'RTX 5060' }
}

/** Seat → model, as read from the crew config on agnx: the normal set and the agni1-only fallback. */
export interface SeatModels {
  primary: Record<string, string>
  fallback: Record<string, string>
}

export interface Placement {
  host: string
  card: string
}

/** The card a seat runs on now: from the config in use (the fallback while agni2 is off), then MODEL_CARD. */
export function seatPlacement(models: SeatModels | null, agni1Only: boolean, seat: string): Placement | null {
  if (!models) return null
  const set = agni1Only && Object.keys(models.fallback).length ? models.fallback : models.primary
  const model = set[seat]
  return model ? (MODEL_CARD[model] ?? null) : null
}

/** A card's reading on its host, matched by name; null when the host or the card did not answer. */
export function cardReading(readings: Map<string, GpuCard[]>, p: Placement): GpuCard | null {
  return readings.get(p.host)?.find((c) => c.card === p.card) ?? null
}

export function tempTone(c: number | null): '' | 'warn' | 'bad' {
  if (c === null) return ''
  return c >= TEMP_BAD_C ? 'bad' : c >= TEMP_WARN_C ? 'warn' : ''
}
