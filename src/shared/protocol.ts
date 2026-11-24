// The panel <-> worker contract, declared once for both sides.
import type { Scope, Snapshot } from './types'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** The current snapshot; the worker starts tracking when a panel first asks. */
    'pitwall.snapshot': { output: Snapshot }
    /** Switch between the focused workspace and every workspace. */
    'pitwall.setScope': { input: { scope: Scope }; output: Snapshot }
    /** Turn the synthetic demo session on or off. */
    'pitwall.setDemo': { input: { on: boolean }; output: Snapshot }
    /** Bring an agent's terminal to the front, as clicking it in Orca does. */
    'pitwall.focus': { input: { key: string }; output: { focused: boolean; reason?: string } }
    /** The person looked at an agent in the panel: its finished turn is no longer new. */
    'pitwall.seen': { input: { key: string }; output: Snapshot }
    /** Turn the optional Agni crew section on or off. */
    'pitwall.setCrew': { input: { on: boolean }; output: Snapshot }
    /** Whether the Crew section is on screen: the worker reads card temperatures only while it is and a task runs. */
    'pitwall.crewVisible': { input: { visible: boolean }; output: { ok: true } }
    /** Clear tool calls and the log. */
    'pitwall.reset': { output: Snapshot }
  }
  interface PluginPanelEvents {
    /** A fresh snapshot, at most a few times a second. */
    'pitwall.snapshot': Snapshot
  }
}
