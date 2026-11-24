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

/* Crew mode: the sidebar is one dark operations console. Colour carries state: mint live and
   passing, amber queued or waiting on the owner, coral failed or blocked, violet reserve roles. */
body.crew-mode { --c-bg:#0a0f16; --c-panel:#0f1720; --c-line:#223240; --c-line-2:#2e4352; --c-fg:#e6eef3; --c-2:#b4c4ce; --c-3:#8399a6;
  --c-live:#7cf5c8; --c-warn:#ffc46b; --c-bad:#ff8a6b; --c-res:#bea4ef; background:var(--c-bg); color:var(--c-fg); min-height:100vh; padding:0 10px 24px }
.crew-mode [data-part]:empty { display:none }
.crew-mode code { color:var(--c-2); font-size:11px }
.cm-bar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:8px; margin:0 -10px; padding:8px 10px; background:color-mix(in srgb,var(--c-bg) 92%,transparent); backdrop-filter:blur(6px); border-bottom:1px solid var(--c-line) }
.cm-back { font:600 12px/1 system-ui; color:var(--c-2); padding:6px 9px; border:1px solid var(--c-line-2); border-radius:6px; flex:none }
.cm-back:hover { color:var(--c-fg); border-color:var(--c-3); background:#152230 }
.cm-title { font:700 12px system-ui; letter-spacing:.14em; text-transform:uppercase; color:var(--c-live) }
.cm-fresh { margin-left:auto; display:flex; align-items:center; gap:5px; font:11px ui-monospace,monospace; color:var(--c-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0 }
.cm-fresh.f-stale { color:var(--c-warn) } .cm-fresh.f-unreachable { color:var(--c-bad) }
.cm-dot { width:7px; height:7px; flex:none; border-radius:50%; background:var(--c-live); box-shadow:0 0 6px var(--c-live) }
.crew-console { display:grid; gap:12px; padding-top:12px; font:12.5px/1.45 system-ui }
.cm-now { position:relative; padding:12px 12px 10px; border-radius:10px; background:linear-gradient(160deg,#13212b,#0e161f 70%); border:1px solid var(--c-line-2); overflow:hidden }
.cm-now.run { border-color:color-mix(in srgb,var(--c-live) 45%,var(--c-line)); box-shadow:inset 3px 0 0 var(--c-live) }
.cm-now.off { box-shadow:inset 3px 0 0 var(--c-bad) }
.cm-kicker { display:flex; align-items:center; gap:8px; font:600 10px/1 ui-monospace,monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--c-3) }
.cm-now.run .cm-kicker > span:first-child { color:var(--c-live) } .cm-now.off .cm-kicker > span:first-child { color:var(--c-bad) }
.cm-kicker code { letter-spacing:0; text-transform:none; font-size:10.5px }
.cm-stage { display:flex; align-items:baseline; gap:10px; margin-top:6px }
.cm-stage h1 { margin:0; font:650 26px/1.1 system-ui; letter-spacing:-.025em; color:#fbfaf6; text-transform:capitalize; overflow-wrap:anywhere; min-width:0 }
.cm-now.idle h1, .cm-now.off h1 { font-size:20px; text-transform:none; color:var(--c-2) }
.cm-elapsed { margin-left:auto; font:600 15px ui-monospace,monospace; color:var(--c-live); font-variant-numeric:tabular-nums }
.cm-prompt { margin:6px 0 0; color:var(--c-2); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden }
.cm-last { margin:8px 0 0; color:var(--c-2) } .cm-last .cpill { margin:0 2px }
.cm-wait { margin-top:8px; padding:6px 8px; border-radius:6px; background:color-mix(in srgb,var(--c-warn) 12%,transparent); color:var(--c-warn); overflow-wrap:anywhere }
.cm-facts { display:grid; grid-template-columns:58px minmax(0,1fr); gap:5px 8px; margin:10px 0 0 }
.cm-facts dt { font:600 9.5px/1.9 ui-monospace,monospace; letter-spacing:.1em; text-transform:uppercase; color:var(--c-3) }
.cm-facts dd { margin:0; color:var(--c-fg); overflow-wrap:anywhere; min-width:0 }
.cm-who { list-style:none; margin:0; padding:0; display:grid; gap:3px }
.cm-who b { font-weight:650 } .cm-who b[class] { color:color-mix(in srgb,var(--mc,#9fd) 75%,#fff) }
.cm-who span { color:var(--c-2) } .cm-quiet { color:var(--c-3) }
.cm-t, .cm-hw { color:var(--c-3); font:10.5px ui-monospace,monospace; margin-left:4px }
.cm-hw { display:block; margin:0 }
.cm-events { display:grid; gap:4px; margin-top:8px; color:var(--c-2) }
.cm-block h2, .crew-deck h2 { margin:0; font:700 10px/1 ui-monospace,monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--c-3) }
.cm-block h2 span { color:var(--c-warn); margin-left:4px }
.cm-needs { display:grid; gap:8px }
.cm-incident { padding:9px 10px; border-radius:8px; background:var(--c-panel); border:1px solid var(--c-line); box-shadow:inset 3px 0 0 var(--c-warn) }
.cm-inc-head { display:flex; align-items:baseline; gap:7px; flex-wrap:wrap }
.cm-inc-head b { color:var(--c-warn); font-weight:650 } .cm-inc-head .cm-t { margin-left:auto }
.cm-incident .cm-facts { margin-top:6px }
.cm-link { color:var(--c-2); font-size:11.5px; text-decoration:underline; text-underline-offset:2px; justify-self:start }
.cm-note { margin:4px 0 0; color:var(--c-3); font-size:11.5px; overflow-wrap:anywhere }
.cm-seats { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:4px }
.cm-seats li { display:grid; grid-template-columns:8px 62px minmax(0,1fr) auto; gap:7px; align-items:center; color:var(--c-2); font-size:12px }
.cm-seats li i { width:7px; height:7px; border-radius:50% } .cm-seats b { font-weight:600; color:var(--c-fg) }
.cm-seats .s-up i { background:var(--c-live) } .cm-seats .s-busy i { background:var(--c-warn) } .cm-seats .s-down i { background:var(--c-bad) }
.cm-seats li > span { font:11px ui-monospace,monospace; color:var(--c-3) } .cm-seats .s-down > span { color:var(--c-bad) } .cm-seats .s-busy > span { color:var(--c-warn) }
.cm-history { border-top:1px solid var(--c-line); padding-top:4px }
.cm-fold { width:100%; display:flex; align-items:center; justify-content:space-between; padding:8px 0 }
.cm-fold span { font:11px ui-monospace,monospace; color:var(--c-3) }
.cm-history .line, .cm-history .card { --fg:var(--c-fg); --text-2:var(--c-2); --muted:var(--c-3); --surface:var(--c-panel); --line:var(--c-line); --hover:#152230 }
.crew-mode button:focus-visible, .crew-mode [role="button"]:focus-visible { outline:2px solid var(--c-live); outline-offset:2px }

.crew-deck { color:var(--c-fg); background:var(--c-panel); border:1px solid var(--c-line); border-radius:10px; overflow:hidden; min-width:0; padding:10px; font-family:ui-monospace,monospace }
.crew-deck header, .deck-tools, .deck-event { display:flex; align-items:center; gap:7px }
.crew-deck header { justify-content:space-between }
.deck-mode { font:600 10px ui-monospace,monospace; padding:3px 6px; border-radius:4px; color:var(--c-3); border:1px solid var(--c-line-2) }
.d-live .deck-mode { color:var(--c-live); border-color:color-mix(in srgb,var(--c-live) 50%,transparent) }
.d-replay .deck-mode { color:var(--c-res); border-color:color-mix(in srgb,var(--c-res) 55%,transparent) }
.d-replay { border-color:color-mix(in srgb,var(--c-res) 45%,var(--c-line)) }
.deck-label { margin-top:6px; color:var(--c-3); font-size:10.5px; overflow-wrap:anywhere }
.command-map { display:block; width:100%; margin:8px 0 0; border-radius:6px; background:radial-gradient(ellipse at center,#182b34 0%,#101922 65%,#0b1018) }
.d-last .command-map { opacity:.82; filter:saturate(.7) }
.command-map text { text-anchor:middle; font-family:ui-monospace,monospace } .role-label { fill:#9caeba; font-size:7px; letter-spacing:1px }
.command-map .role-name { fill:#ecf2f4; font:650 13px system-ui } .role-detail { fill:var(--ink); font-size:8px }
.role-orbit { fill:#0b1620; stroke:var(--ink); stroke-opacity:.45; stroke-width:.7 } .orbit-tick, .insignia { fill:none; stroke:var(--ink); stroke-width:1.6; stroke-linejoin:round; stroke-linecap:round }
.role-core { fill:#1b2633; stroke:var(--ink); stroke-opacity:.25 } .route-base { fill:none; stroke:#3e5862; stroke-width:1 } .route-base.reserve { stroke:#625278; stroke-dasharray:2 3 }
.signal { fill:none; stroke-width:2; filter:drop-shadow(0 0 2px #8affdc) }
.crew-deck.moving .signal { stroke-dasharray:7 10; animation:deck-packet 1.1s linear infinite }
@keyframes deck-packet { to { stroke-dashoffset:-34 } }
.command-hub { fill:#1e3335; stroke:#648b82 } .command-map .hub-name { fill:#d5f4e8; font:650 11px system-ui } .hub-route { fill:#a2c1b3; font-size:7px }
.deck-files { border-top:1px solid var(--c-line); padding-top:7px; margin-top:7px; color:var(--c-2); font-size:10px; overflow-wrap:anywhere }
.deck-tools { margin:10px 0 4px } .deck-tools b { font-size:10px; letter-spacing:.12em; flex:1; color:var(--c-3); text-transform:uppercase }
.deck-tools button { border:1px solid #4a6470; padding:4px 8px; border-radius:5px; color:#e0f9fa; font-size:11px; background:#17222c }
.deck-tools button:hover { background:#1f2f3b }
.deck-event { width:100%; background:transparent; color:inherit; text-align:left; border-radius:0; border-top:1px solid var(--c-line); font-size:10.5px; padding:5px 3px; overflow-wrap:anywhere }
.deck-event b { flex:1; font-weight:600 } .deck-event time { color:var(--c-3); font-variant-numeric:tabular-nums }
.deck-event.t-pass span { color:var(--c-live) } .deck-event.t-fail span { color:var(--c-bad) } .deck-event.t-wait span { color:var(--c-warn) }
.deck-event.current { box-shadow:inset 2px 0 0 var(--c-warn); padding-left:7px }
.deck-event:hover, .deck-event:focus-visible { background:#1a2733 }

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
