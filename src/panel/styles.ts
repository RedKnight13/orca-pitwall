// Panel CSS. Every surface and text colour derives from Orca's theme variables, so the panel follows
// light and dark. Active agents sit on a raised card; idle ones are one line each. Colour marks state
// only: blue working, amber needs you, red failed. The one exception is the crew's mascots: each role
// has its colour, and they move a little (a bob, a snooze, a hand-off, confetti), never under
// prefers-reduced-motion.
export const CSS = `
:root {
  --bg: var(--orca-background, #111);
  --fg: var(--orca-foreground, #eee);
  --text-2: color-mix(in srgb, var(--fg) 72%, var(--bg));
  --muted: color-mix(in srgb, var(--fg) 52%, var(--bg));
  --line: var(--orca-border, #2a2a2a);
  --surface: color-mix(in srgb, var(--fg) 5%, var(--bg));
  --surface-2: color-mix(in srgb, var(--fg) 9%, var(--bg));
  --hover: color-mix(in srgb, var(--fg) 7%, var(--bg));
  --radius: var(--orca-radius, 8px);
  --run: #60a5fa; --warn: #fbbf24; --bad: #f87171; --ok: #4ade80;
  --warn-bg: color-mix(in srgb, var(--warn) 12%, var(--bg));
  --warn-edge: color-mix(in srgb, var(--warn) 45%, transparent);
}
/* Light text needs more weight to stay readable (WCAG AA 4.5:1 on cards). */
html.light {
  --run: #1d4ed8; --warn: #92400e; --bad: #b91c1c; --ok: #15803d;
  --text-2: color-mix(in srgb, var(--fg) 80%, var(--bg));
  --muted: color-mix(in srgb, var(--fg) 64%, var(--bg));
  --warn-bg: #fef3c7; --warn-edge: #f59e0b;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font: 12.5px/1.45 var(--orca-font-sans, system-ui, sans-serif); }
body { padding: 8px 8px 20px; overflow-x: hidden; }
/* Orca's own "sleek" scrollbars: thin thumb, no track. */
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--muted) 28%, transparent); background-clip: padding-box; border: 3px solid transparent; border-radius: 0; min-height: 28px; }
::-webkit-scrollbar-thumb:hover { background-color: color-mix(in srgb, var(--muted) 48%, transparent); }
::-webkit-scrollbar-thumb:active { background-color: color-mix(in srgb, var(--fg) 36%, transparent); }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; text-align: left; }
[role="button"]:focus-visible, button:focus-visible { outline: 2px solid var(--orca-ring, var(--run)); outline-offset: 1px; border-radius: 4px; }
code { font-family: var(--orca-font-mono, ui-monospace, monospace); font-size: 11.5px; }
b { font-weight: 600; }
.w5 { font-weight: 500; }
.muted { color: var(--muted); }
.sub-t { color: var(--text-2); }
.small { font-size: 11.5px; }
.right { margin-left: auto; white-space: nowrap; flex: none; }
.ell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.bad-t { color: var(--bad); } .ok-t { color: var(--ok); } .warn-t { color: var(--warn); }
.row { display: flex; align-items: center; gap: 6px; min-width: 0; }

.top { display: flex; align-items: center; gap: 6px; position: relative; padding: 0 2px 8px; }
.title { font-weight: 600; font-size: 13px; }
.badge { font-size: 11px; color: var(--text-2); background: var(--surface-2); border-radius: 4px; padding: 0 6px; }
.seg { margin-left: auto; display: flex; background: var(--surface); border-radius: 6px; padding: 2px; }
.seg button { padding: 1px 10px; border-radius: 4px; color: var(--text-2); }
.seg button.on { background: var(--surface-2); color: var(--fg); font-weight: 500; }
.icon { width: 24px; height: 24px; border-radius: 5px; color: var(--text-2); text-align: center; flex: none; }
.icon:hover { background: var(--hover); color: var(--fg); }
.small-icon { width: 20px; height: 20px; font-size: 12px; opacity: .8; }
.small-icon:hover { opacity: 1; }
.menu { position: absolute; right: 0; top: 28px; z-index: 5; background: var(--orca-popover, var(--bg)); color: var(--orca-popover-foreground, var(--fg)); border: 1px solid var(--line); border-radius: var(--radius); padding: 4px; min-width: 190px; box-shadow: 0 8px 22px rgba(0,0,0,.28); }
.menu button { display: block; width: 100%; padding: 6px 8px; border-radius: 5px; }
.menu button:hover { background: var(--hover); }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--line); }
.quiet-link { color: var(--muted); font-size: 11px; padding: 0; }
.quiet-link:hover, .quiet-link:focus-visible { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
.foot { padding: 14px 4px 6px; text-align: center; font-size: 11px; color: var(--muted); }
.foot .dot-sep { margin: 0 6px; }

.summary { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 0 2px 8px; font-size: 12px; color: var(--text-2); }
.sum { white-space: nowrap; }
.sum::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: var(--muted); vertical-align: 1px; }
.sum.run::before { background: var(--run); } .sum.warn::before { background: var(--warn); }
.sum.right::before { display: none; }
.only-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; padding: 5px 8px; border-radius: var(--radius); background: var(--surface); }
.chip-btn { margin-left: auto; flex: none; font-size: 11.5px; padding: 1px 8px; border-radius: 10px; background: var(--surface-2); }
.chip-btn:hover { color: var(--fg); background: var(--hover); }

.alerts { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; margin-bottom: 8px; }
.alert { padding: 8px 10px; border-radius: var(--radius); background: var(--warn-bg); border: 1px solid var(--warn-edge); }
.badge-warn { flex: none; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 4px; color: var(--bg); background: var(--warn); }
.alert .what { margin-top: 5px; padding: 4px 6px; border-radius: 4px; background: var(--surface); font-family: var(--orca-font-mono, ui-monospace, monospace); font-size: 11.5px; overflow-wrap: anywhere; max-height: 4.5em; overflow: hidden; }
.alert-foot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.alert .hint { font-size: 11px; color: var(--text-2); }
.go { margin-left: auto; flex: none; font-size: 11.5px; font-weight: 500; padding: 2px 9px; border-radius: 5px; background: var(--warn); color: var(--bg); }
.go:hover { filter: brightness(1.08); }
.alert.soft { background: var(--surface); border-color: color-mix(in srgb, var(--warn) 30%, var(--line)); }
.badge-soft { flex: none; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 4px; color: var(--warn); background: color-mix(in srgb, var(--warn) 15%, transparent); }
.go.soft, .go-soft { margin-left: auto; flex: none; font-size: 11.5px; font-weight: 500; padding: 2px 9px; border-radius: 5px; background: var(--surface-2); color: var(--fg); }
.new-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--run); }
.sum.new::before { background: var(--run); }

.cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-bottom: 8px; }
.card { position: relative; min-width: 0; overflow: hidden; padding: 10px 10px 8px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.card.working { border-color: color-mix(in srgb, var(--run) 35%, var(--line)); }
.card.blocked { border-color: color-mix(in srgb, var(--warn) 55%, var(--line)); }
.card-tools { position: absolute; top: 6px; right: 6px; display: flex; gap: 2px; }
.card-head { padding-right: 66px; }
.card-head.clickable { cursor: pointer; }
.name { font-weight: 600; font-size: 13px; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.link.inline { font-size: inherit; text-decoration: underline dotted; text-underline-offset: 2px; }
.state { flex: none; font-size: 11px; font-weight: 500; padding: 0 7px; border-radius: 10px; background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
.state.working { color: var(--run); background: color-mix(in srgb, var(--run) 15%, transparent); }
.state.blocked { color: var(--warn); background: color-mix(in srgb, var(--warn) 16%, transparent); }
.card-head .row { margin-top: 3px; }
.block { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
.block-title { font-size: 11.5px; font-weight: 600; color: var(--text-2); }
.ctx { margin-top: 8px; }
.ctx-line { display: flex; align-items: baseline; gap: 6px; font-size: 11.5px; }
.ctx-num { font-weight: 600; font-size: 13px; color: var(--fg); }
.ctx-num.warn { color: var(--warn); } .ctx-num.bad { color: var(--bad); }
.meter { height: 4px; margin-top: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
.meter i { display: block; height: 100%; border-radius: 2px; background: var(--run); }
.meter.warn i { background: var(--warn); } .meter.bad i { background: var(--bad); }
.prompt { padding-left: 8px; border-left: 2px solid var(--surface-2); color: var(--fg); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.item { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 6px; align-items: center; font-size: 12px; }
.mark { text-align: center; font-size: 11px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); justify-self: center; }
.dot.run { background: var(--run); }
.link { color: var(--text-2); font-size: 11.5px; justify-self: start; }
.link:hover { color: var(--fg); text-decoration: underline; }

.sec { margin-top: 4px; }
.sec-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 4px; border-radius: 5px; }
.sec-head:hover { background: var(--hover); }
.chev { width: 10px; color: var(--muted); font-size: 11px; flex: none; }
.sec-title { font-weight: 600; white-space: nowrap; flex: none; }
.sec-head .right { min-width: 0; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
.sec-body { padding: 2px 4px 4px 20px; }
.lines { display: grid; grid-template-columns: minmax(0, 1fr); padding-left: 14px; }
.line { display: flex; align-items: center; gap: 6px; padding: 4px 2px 4px 4px; border-radius: 5px; cursor: pointer; min-width: 0; }
.line:hover { background: var(--hover); }
.line .name { font-weight: 500; font-size: 12.5px; }
.line .time { flex: none; font-size: 11.5px; min-width: 38px; text-align: right; }
.line .ell { flex: 1 1 auto; }
.hover-tools { display: none; flex: none; }
.line .chev, .card-head .chev { flex: none; }
.card-head .chev { display: inline-block; width: 14px; color: var(--muted); font-weight: 400; font-size: 11px; }
.go-icon { width: 24px; height: 24px; font-size: 13px; }
.inline-card { margin: 4px 0 6px; }
.line:hover .hover-tools, .line:focus-within .hover-tools { display: flex; }
.pill { flex: none; font-size: 11px; padding: 0 6px; border-radius: 9px; background: var(--surface-2); color: var(--text-2); }
.pill.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 15%, transparent); }
.pill.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 15%, transparent); }

.fams { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.fam { font-size: 11.5px; padding: 0 7px; border-radius: 10px; background: var(--surface); color: var(--text-2); }
.fam:hover { color: var(--fg); }
.fam.on { background: var(--fg); color: var(--bg); } .fam.on .muted { color: var(--bg); }
.calls { display: grid; gap: 1px; }
.call, .log-row { display: grid; grid-template-columns: 12px auto minmax(0, 1fr) auto; gap: 6px; align-items: baseline; font-size: 12px; padding: 1px 0; }
.log-row { grid-template-columns: 12px minmax(0, 1fr) auto; }
.log-who { font-size: 11.5px; font-weight: 600; margin-top: 6px; }
.log-who:first-child { margin-top: 0; }
.ico { text-align: center; color: var(--muted); }
.s-ok .ico, .k-done .ico { color: var(--ok); }
.s-error .ico, .s-denied .ico, .k-error .ico, .k-denied .ico { color: var(--bad); }
.s-asking .ico, .k-asking .ico { color: var(--warn); }
.s-running .ico, .k-spawn .ico { color: var(--run); }

.empty { padding: 28px 12px; text-align: center; }
.empty-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.empty p { margin: 0 0 8px; }
/* Agni crew: status pills and stage colours follow the Agni Crew Replay (pass, fail, wait, running). */
.crew-body { padding-left: 14px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.crew-body > .block-title { margin-top: 2px; }
.crew-body .cards { margin: 2px 0 4px; }
.crew-body .lines { padding-left: 0; }
.crew-card { padding: 8px 10px 8px; }
.crew-card .card-head { padding-right: 0; }
.crew-card.run { border-color: color-mix(in srgb, var(--run) 35%, var(--line)); }
.crew-card .prompt { margin-top: 5px; }
.tid { font-weight: 600; font-size: 12px; }
.cpill, .opill { flex: none; font-size: 10.5px; font-weight: 500; padding: 0 6px; border-radius: 9px; border: 1px solid var(--line); color: var(--text-2); white-space: nowrap; }
.cpill { margin-left: auto; }
.cpill.run, .opill.run { color: var(--run); border-color: color-mix(in srgb, var(--run) 50%, transparent); }
.cpill.pass, .opill.pass { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 50%, transparent); }
.cpill.wait, .opill.wait { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 50%, transparent); }
.cpill.fail, .opill.fail { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 50%, transparent); }
.crew-line .cpill { margin-left: 0; }
.crew-line .tid { flex: none; }
.strip { display: flex; gap: 1px; height: 6px; margin-top: 7px; border-radius: 3px; overflow: hidden; background: var(--surface-2); }
.strip i { display: block; min-width: 3px; flex-basis: 0; }
.seg-pass { background: var(--ok); } .seg-fail { background: var(--bad); } .seg-wait { background: var(--warn); } .seg-run { background: var(--run); }
.sheet { margin-top: 6px; display: grid; gap: 1px; }
.sheet-row { display: grid; grid-template-columns: minmax(0, 1fr) auto 44px; gap: 6px; align-items: center; font-size: 11.5px; padding: 1px 0; }
.sheet-row.current { color: var(--run); }
.secs { text-align: right; font-variant-numeric: tabular-nums; }
.seat { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 6px; align-items: center; font-size: 12px; }
.seat-holder { padding-left: 18px; }
.dot.seat-up { background: var(--ok); } .dot.seat-busy { background: var(--run); } .dot.seat-down { background: var(--bad); }
.seat-state { font-size: 11px; color: var(--text-2); } .seat-state.seat-down { color: var(--bad); } .seat-state.seat-busy { color: var(--run); }
.key { display: grid; gap: 2px; }
.key + .key { margin-top: 4px; }
.crew-off { padding: 6px 8px; border-radius: var(--radius); background: var(--surface); }

.crew-deck { color:#e4edf2; background:#0b1018; border:1px solid #354855; border-radius:8px; overflow:hidden; min-width:0; padding:10px; margin:2px 0 8px; font-family:ui-monospace,monospace; }
.crew-deck header,.deck-tools,.deck-event { display:flex; align-items:center; gap:7px }
.crew-deck header { justify-content:space-between; border-bottom:1px solid #34424d; padding-bottom:8px; font:bold 13px/1.3 system-ui; letter-spacing:.1em }
.crew-deck header span { color:#ff9757 }.crew-deck header small,.deck-label,.deck-seat small { color:#acbdc8;font:10px/1.4 ui-monospace,monospace;letter-spacing:0 }
.deck-screen { position:relative;isolation:isolate;padding:12px 1px 5px;background:linear-gradient(90deg,#16232f55 1px,transparent 1px),linear-gradient(#16232f55 1px,transparent 1px);background-size:16px 16px }
.crew-deck h2 { margin:4px 0 0;color:#faf7f1;font:800 clamp(22px,8vw,38px)/1 system-ui;text-transform:uppercase;letter-spacing:-.035em;overflow-wrap:anywhere }
.deck-screen strong { display:block;margin-top:5px;color:#ffc68d;font-size:11px;text-transform:uppercase }
.deck-screen p { font:12px/1.45 system-ui;color:#cdd5df;margin:6px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden }
/* Machined dies, etched traces and packet traffic scale together at sidebar width. */
.circuit-board {display:block;width:100%;max-height:290px;margin:8px 0 0;background:radial-gradient(ellipse at 50% 40%,#14334199,transparent 72%)}
.circuit-board .shadow {fill:#000;opacity:.65}
.circuit-board .edge {fill:#09121e;stroke:#4c6476;stroke-width:.8}
.circuit-board .plate {fill:#243b49;stroke:#66919c;stroke-width:.8}
.circuit-board .lid {fill:#2c4554;stroke:#8ba2aa;stroke-width:.8}
.circuit-board .ribs {fill:none;stroke:#455f6a;stroke-width:.8}
.circuit-board .die-core {fill:#14262f;stroke:#7baeb6}
.circuit-board .pilot {fill:#76999b}
.circuit-board .lit .die-core,.circuit-board .lit .pilot {fill:#acfff0;stroke:#4cf1d1;filter:drop-shadow(0 0 4px #40d8c2)}
.circuit-board text {text-anchor:middle;font-family:ui-monospace,monospace}
.chip-name {font-size:13px;font-weight:700;fill:#d6eaef}.chip-card {font-size:9px;fill:#9cb6c6}
.socket {fill:#10212c;stroke:#70a1ad}.host-label {fill:#c6f3ee;font-size:10px;letter-spacing:1px}
.trace,.signal {fill:none;stroke:#365b68;stroke-width:1.5}.signal {stroke:#81f9da;filter:drop-shadow(0 0 3px #43c5b6)}
.crew-deck.moving .signal {stroke-dasharray:9 19;animation:deck-packet 1.25s linear infinite}
@keyframes deck-packet {to {stroke-dashoffset:-56}}
.gate-stop path {stroke:#ffa36d;stroke-width:3}.gate-stop text {fill:#ffa36d;font-size:8px;text-anchor:start}.held .signal {stroke:#d68b59;stroke-dasharray:2 5}
.deck-sessions,.deck-files {border-top:1px solid #314350;padding-top:7px;margin-top:7px;color:#c5d6df;font-size:10px;overflow-wrap:anywhere}.deck-sessions > b {font-size:9px;color:#89a4af;letter-spacing:.1em}.deck-session {display:flex;gap:8px;align-items:center}.deck-session span {color:#bfcccf}.deck-session b {text-transform:capitalize}.deck-detail {color:#ffd6b2;border-left:2px solid #ff9254;padding-left:7px;margin-top:8px;font:12px/1.4 system-ui;overflow-wrap:anywhere}
.deck-tools {margin:10px 0 4px}.deck-tools b {font-size:10px;letter-spacing:.1em;flex:1;color:#acbdc8}
.deck-tools button {border:1px solid #57717a;padding:3px 7px;border-radius:3px;color:#e0f9fa;font-size:11px;background:#17222c}
.deck-event {border-top:1px solid #263540;font-size:10px;padding:4px 3px;overflow-wrap:anywhere}.deck-event b {flex:1}.deck-event time {color:#b2c1cb}.deck-event.current {border-left:2px solid #ff9757;padding-left:6px}
 .deck-runner { font:600 10px ui-monospace,monospace; letter-spacing:.06em; padding:5px 8px; border:1px solid #435663; color:#b7d4db; background:#101922; width:fit-content; margin:10px auto 0;position:relative }
.deck-runner:after {content:'';position:absolute;height:10px;border-left:1px solid #5c8591;top:100%;left:50%}
.deck-event {width:100%;background:transparent;color:inherit;text-align:left;border-radius:0}
.deck-event:hover,.deck-event:focus-visible {background:#23313e}

/* Crew mascots: one colour per role, as \`crew watch\` draws them. */
.live { --ph: 0ms; display: grid; gap: 4px; margin: 2px 0 6px; padding: 7px 8px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); position: relative; overflow: hidden; }
.live.asleep { display: block; padding: 5px 8px; }
.m-qwen { --mc: #ef4444; } .m-gemma { --mc: #f97316; } .m-inkling { --mc: #a855f7; } .m-jev { --mc: #ca8a04; }
.m-venice { --mc: #ec4899; } .m-codex { --mc: #14b8a6; } .m-tests { --mc: #22c55e; }
html.light .m-qwen { --mc: #b91c1c; } html.light .m-gemma { --mc: #c2410c; } html.light .m-inkling { --mc: #7e22ce; } html.light .m-jev { --mc: #854d0e; }
html.light .m-venice { --mc: #be185d; } html.light .m-codex { --mc: #0f766e; } html.light .m-tests { --mc: #15803d; }
.live-strip { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 5px; font-size: 11.5px; color: var(--text-2); }
.st { white-space: nowrap; } .st-active b { color: var(--run); font-weight: 600; } .st-failed { color: var(--bad); } .st-idle { color: var(--muted); }
.st-sep { color: var(--muted); font-size: 10px; }
.live-task { margin-left: auto; white-space: nowrap; font-size: 11px; }
.mascots { display: grid; gap: 3px; }
.mascot { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 6px; align-items: center; padding: 2px 4px 2px 3px; border-left: 2px solid color-mix(in srgb, var(--mc) 55%, transparent); border-radius: 3px; }
.mascot.is-active { background: color-mix(in srgb, var(--mc) 10%, transparent); border-left-color: var(--mc); }
.mascot.is-idle, .mascot.is-waiting { opacity: .72; }
.m-name { color: color-mix(in srgb, var(--mc) 70%, var(--fg)); flex: none; }
.m-main { min-width: 0; display: grid; gap: 0; }
.m-main .ell { flex: 1 1 auto; }
.face { position: relative; font-size: 16px; line-height: 1; text-align: center; display: inline-block; }
.face .zz { position: absolute; right: -7px; top: -6px; font-size: 10px; font-style: normal; }
.act { flex: none; font-size: 11px; font-weight: 600; color: var(--run); }
.tps { flex: none; font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.m-state { flex: none; font-size: 11px; color: var(--muted); } .m-state.m-done { color: var(--ok); } .m-state.m-failed { color: var(--bad); }
.m-say { flex-wrap: wrap; row-gap: 0; }
.bubble { color: var(--text-2); font-size: 11px; flex: 1 1 150px; }
.bubble::before { content: ''; font-size: 10px; }
.hw { flex: none; font-size: 10.5px; margin-left: auto; white-space: nowrap; }
.handoff { display: flex; align-items: center; gap: 4px; font-size: 12px; }
.handoff .parcel { display: inline-block; animation: pass 1.6s ease-in-out 2 both; animation-delay: var(--el, 0ms); }
.finale { font-size: 12px; position: relative; }
.finale.fin-ok b { color: var(--ok); } .finale.fin-bad b { color: var(--bad); }
.confetti { position: absolute; left: 0; right: 0; top: -4px; height: 0; pointer-events: none; }
.confetti i { position: absolute; left: calc(var(--i) * 12% + 4%); font-style: normal; font-size: 12px; opacity: 0; animation: fall 1.8s ease-out both; animation-delay: calc(var(--el, 0ms) + var(--i) * 70ms); }
.boom { display: inline-block; animation: boom .9s ease-out both; animation-delay: var(--el, 0ms); }
.bob { animation: bob 1.2s ease-in-out infinite; animation-delay: var(--ph); }
.sleepy .zz { animation: snooze 2.4s ease-in-out infinite; animation-delay: var(--ph); }
.played { display: none !important; }
@keyframes bob { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-2px) rotate(-6deg); } 50% { transform: translateY(0) rotate(0); } 75% { transform: translateY(-2px) rotate(6deg); } }
@keyframes snooze { 0%, 100% { opacity: .55; transform: translate(0, 0); } 50% { opacity: 1; transform: translate(2px, -3px); } }
@keyframes pass { 0% { transform: translateX(-10px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateX(10px); opacity: 0; } }
@keyframes fall { 0% { transform: translateY(-6px) rotate(0); opacity: 0; } 15% { opacity: 1; } 100% { transform: translateY(40px) rotate(200deg); opacity: 0; } }
@keyframes boom { 0% { transform: scale(.4); } 45% { transform: scale(1.5); } 70% { transform: scale(.9) rotate(-8deg); } 100% { transform: scale(1); } }
/* Still mascots for anyone who asks for less motion: the words carry everything. */
@media (prefers-reduced-motion: reduce) {
  .live, .live * { animation: none !important; transition: none !important; }
  .confetti, .boom, .handoff .parcel { display: none !important; }
  .crew-deck.moving .signal { animation: none !important; }
}
.badge-bad { flex: none; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 4px; color: var(--bg); background: var(--bad); }

.primary { margin-top: 6px; padding: 5px 14px; border-radius: var(--radius); background: var(--orca-primary, var(--fg)); color: var(--orca-primary-foreground, var(--bg)); font-weight: 500; }
`
