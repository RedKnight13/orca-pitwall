// The two scripts the Crew section runs, sent to `ssh <host> python3 -` on stdin: nothing is
// installed on the hosts and no port is opened. Both are read-only, use the standard library only,
// and print exactly one JSON line. Each sends back a whitelist of fields, never a whole record.

/**
 * Runs on agnx. Reads `crew status` (the crew's own view of each task's status), the task records,
 * the stage lines of every events.jsonl (with a few short words and file names for the mascots), the
 * per-seat start and stop lines of Agni-crew #42 (schema agni.crew.seat_event/1 only), the seat lock's
 * status, each seat's /health on loopback, and which model each seat uses (crew.toml and its
 * agni1-only fallback: the seat and model names only).
 *
 * The event logs are tailed, not reread: the worker sends back the cursor the last run printed
 * (see agnxScript), and the script reads only the bytes after it. A new, rotated or shrunk log, or a
 * first run, reads the last 2 MB of every log afresh ("mode": "full").
 */
export const AGNX_PY = String.raw`
import glob, json, os, re, subprocess, urllib.error, urllib.request

HOME = os.path.expanduser("~")
STATE = os.path.join(HOME, ".local/state/agni-crew-three-seat")
CREW = os.path.join(HOME, "agni/bin/crew")
MAX_TASKS = 20
TAIL_BYTES = 2 * 1024 * 1024
SEAT_SCHEMA = "agni.crew.seat_event/1"
SEATS = (("leader", 28084), ("helper", 28085), ("reviewer", 8093))


def clip(v, n):
    return v[:n] if isinstance(v, str) else None


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def run(cmd, timeout):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"exit": r.returncode, "out": r.stdout[-60000:]}
    except Exception as e:
        return {"exit": None, "out": "", "error": type(e).__name__}


def task_row(t):
    res = t.get("result") if isinstance(t.get("result"), dict) else {}
    wait = t.get("waiting_on_seat") if isinstance(t.get("waiting_on_seat"), dict) else None
    return {
        "id": clip(t.get("id"), 64),
        "status": clip(t.get("status"), 32),
        "stage": clip(t.get("stage"), 32),
        "attempts": num(t.get("attempts")),
        "prompt": clip(t.get("prompt"), 240),
        "created": clip(t.get("created"), 40),
        "updated": clip(t.get("updated"), 40),
        "has_test_command": bool(t.get("test_command")),
        "error": clip(t.get("error"), 240),
        "waiting_on_seat": {"seat": clip(wait.get("seat"), 32), "holder": clip(wait.get("holder"), 128)} if wait else None,
        "result": {
            "verdict": clip(res.get("verdict"), 32),
            "test_exit": num(res.get("test_exit")),
            "decision": clip(res.get("decision"), 32),
            "next_actor": clip(res.get("next_actor"), 32),
        },
    }


def tasks():
    rows = []
    for path in glob.glob(os.path.join(STATE, "tasks", "*.json")):
        try:
            with open(path) as f:
                t = json.load(f)
        except Exception:
            continue
        if isinstance(t, dict) and isinstance(t.get("id"), str):
            rows.append(t)
    rows.sort(key=lambda t: str(t.get("updated") or t.get("created") or ""), reverse=True)
    return [task_row(t) for t in rows[:MAX_TASKS]], len(rows)


def load_cursor():
    try:
        c = json.loads(globals().get("CURSOR_JSON") or "{}")
    except Exception:
        return {}
    return c if isinstance(c, dict) else {}


def logs():
    paths = sorted(glob.glob(os.path.join(HOME, ".local/state/agni-crew*/events.jsonl")))
    return {os.path.relpath(p, HOME): p for p in paths}


def plan_reads(files, cursor):
    """Where to start each log. Delta only when every log is the one the cursor saw, and no shorter."""
    prev = cursor.get("files") if isinstance(cursor.get("files"), dict) else {}
    stats = {}
    for rel, path in files.items():
        try:
            stats[rel] = os.stat(path)
        except Exception:
            pass
    delta = bool(prev) and set(prev) == set(stats)
    if delta:
        for rel, st in stats.items():
            c = prev.get(rel)
            if not (isinstance(c, list) and len(c) == 2 and c[0] == st.st_ino and isinstance(c[1], int) and 0 <= c[1] <= st.st_size):
                delta = False
                break
    return delta, {rel: (prev[rel][1] if delta else max(0, st.st_size - TAIL_BYTES), st) for rel, st in stats.items()}


def events(ids, cursor):
    files = logs()
    delta, starts = plan_reads(files, cursor)
    out, seen = [], {}
    for rel, (start, st) in starts.items():
        try:
            with open(files[rel], "rb") as f:
                f.seek(start)
                data = f.read(min(st.st_size - start, TAIL_BYTES))
        except Exception:
            continue
        # Complete lines only; a partial last line waits for the next read.
        cut = data.rfind(b"\n")
        data = data[: cut + 1] if cut >= 0 else b""
        pos = start
        if not delta and start > 0:
            # A tail starts mid-line: skip to the first whole one.
            skip = data.find(b"\n") + 1
            data, pos = data[skip:], start + skip
        seen[rel] = [st.st_ino, pos + len(data)]
        for raw in data.split(b"\n")[:-1]:
            at, pos = pos, pos + len(raw) + 1
            row = event_row(raw, ids, rel, at)
            if row:
                out.append(row)
    return {"mode": "delta" if delta else "full", "events": out, "cursor": {"files": seen}}


def event_row(raw, ids, rel, at):
    try:
        e = json.loads(raw.decode("utf-8", "replace"))
    except Exception:
        return None
    if not isinstance(e, dict) or e.get("task") not in ids:
        return None
    if "seat_event" in e:
        if e.get("schema") != SEAT_SCHEMA:
            return None
        row = seat_row(e)
        if row["seat_event"] == "start":
            # Where the line is, so the next run can stat its output again without rereading the log.
            row["ref"] = "%s:%d" % (rel, at)
        return row
    row = {
        "ts": clip(e.get("ts"), 40),
        "task": e.get("task"),
        "stage": clip(e.get("stage"), 32),
        "attempt": num(e.get("attempt")),
        "outcome": clip(str(e.get("outcome")), 32) if e.get("outcome") is not None else None,
        "seconds": num(e.get("seconds")),
    }
    # Short words and numbers for the mascots; free text (reasons, prompts) stays on agnx.
    for k in ("mode", "gate", "decision", "verdict"):
        if word(e.get(k)):
            row[k] = e[k]
    for k in ("test_exit", "input_tokens"):
        if num(e.get(k)) is not None:
            row[k] = e[k]
    if isinstance(e.get("referee_calls"), list):
        row["referee_calls"] = len(e["referee_calls"])
    if isinstance(e.get("evidence"), list):
        row["evidence"] = [n for n in (file_name(x) for x in e["evidence"][:8]) if n]
    return row


def open_sizes(cursor):
    """The output size of each seat run still open, by its line's ref: one seek and one line each."""
    files = logs()
    sizes = {}
    refs = cursor.get("open") if isinstance(cursor.get("open"), list) else []
    for ref in refs[:16]:
        rel, _, off = ref.rpartition(":") if isinstance(ref, str) else ("", "", "")
        if rel not in files or not off.isdigit():
            continue
        try:
            with open(files[rel], "rb") as f:
                f.seek(int(off))
                e = json.loads(f.readline(65536).decode("utf-8", "replace"))
        except Exception:
            continue
        if isinstance(e, dict) and e.get("schema") == SEAT_SCHEMA and e.get("seat_event") == "start":
            sizes[ref] = output_bytes(e)
    return sizes


def seat_models():
    """Seat and model names from the crew config and its agni1-only fallback; nothing else in them."""
    out = {"primary": {}, "fallback": {}}
    try:
        import tomllib
    except Exception:
        return out
    path = os.path.expanduser(os.environ.get("CREW_CONFIG") or "~/agni/crew/crew.toml")
    for kind in ("primary", "fallback"):
        try:
            with open(path, "rb") as f:
                raw = tomllib.load(f)
        except Exception:
            break
        seats = raw.get("seats") if isinstance(raw.get("seats"), dict) else {}
        for name, seat in seats.items():
            model = seat.get("model") if isinstance(seat, dict) else None
            short = model.rsplit("/", 1)[-1] if isinstance(model, str) else None
            if word(name) and word(short):
                out[kind][name] = short
        fb = raw.get("fallback") if isinstance(raw.get("fallback"), dict) else {}
        nxt = fb.get("config")
        if not isinstance(nxt, str):
            break
        path = os.path.expanduser(nxt)
    return out


def word(v):
    return isinstance(v, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,31}", v) is not None


def file_name(v):
    """A path's last part when it looks like a file name; never a path, never contents."""
    if not isinstance(v, str):
        return None
    n = v.replace("\\", "/").rsplit("/", 1)[-1]
    return n if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,54}\.[A-Za-z0-9]{1,8}", n) else None


def output_bytes(e):
    """Size of a running seat's growing output file, for a typing bar. Stat only: never read."""
    wt, rel = e.get("worktree"), e.get("output")
    if not (isinstance(wt, str) and isinstance(rel, str) and os.path.isabs(wt)) or os.path.isabs(rel) or ".." in rel.split("/"):
        return None
    try:
        return os.stat(os.path.join(wt, rel)).st_size
    except Exception:
        return None


def seat_row(e):
    """One agni.crew.seat_event/1 line (Agni-crew #42), whitelisted. No worktree, no model or lease names."""
    row = {
        "schema": SEAT_SCHEMA,
        "seat_event": e.get("seat_event") if e.get("seat_event") in ("start", "stop") else None,
        "ts": clip(e.get("ts"), 40),
        "task": e.get("task"),
        "stage": e.get("stage") if word(e.get("stage")) else None,
        "attempt": num(e.get("attempt")),
        "seat": e.get("seat") if word(e.get("seat")) else None,
        "slot": "helper_" if e.get("slot") == "helper_" else "",
        "output": file_name(e.get("output")),
        "seconds": num(e.get("seconds")),
        "exit": num(e.get("exit")),
        "timed_out": e.get("timed_out") if isinstance(e.get("timed_out"), bool) else None,
    }
    if row["seat_event"] == "start":
        row["output_bytes"] = output_bytes(e)
    return row


def health(port):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=2) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return None


def seat_lock():
    try:
        with open(CREW) as f:
            m = re.search(r'exec\s+"([^"]+)/crew"', f.read())
    except Exception:
        m = None
    if not m:
        return {"deployed": False, "seats": []}
    helper = os.path.join(m.group(1).replace("$HOME", HOME), "helpers", "agni-seat-lock")
    if not os.path.exists(helper):
        return {"deployed": False, "seats": []}
    r = run(["python3", helper, "status"], 10)
    try:
        rows = json.loads(r["out"]).get("seats") or []
    except Exception:
        return {"deployed": True, "seats": [], "error": "bad_output"}
    return {"deployed": True, "seats": [
        {"seat": clip(x.get("seat"), 32), "holder": clip(x.get("holder"), 128), "priority": clip(x.get("priority"), 16)}
        for x in rows if isinstance(x, dict)
    ]}


def main():
    cursor = load_cursor()
    listed, total = tasks()
    status = run([CREW, "status"], 20)
    ev = events({t["id"] for t in listed}, cursor)
    print(json.dumps({
        "schema": "pitwall.crew/1",
        "status": {"exit": status["exit"], "text": status["out"], "error": status.get("error")},
        "tasks": listed,
        "total": total,
        "mode": ev["mode"],
        "events": ev["events"],
        "cursor": ev["cursor"],
        "sizes": open_sizes(cursor),
        "seats": [{"seat": s, "port": p, "health": health(p)} for s, p in SEATS],
        "lock": seat_lock(),
        "models": seat_models(),
    }))


if __name__ == "__main__":
    main()
`

/** What the worker sends back each poll: where each log was read up to, and the seat runs still open. */
export interface AgnxCursor {
  files: Record<string, [number, number]>
  open: string[]
}

/** The agnx script with the last run's cursor in front. JSON inside a JSON string is a valid Python string literal. */
export function agnxScript(cursor: AgnxCursor | null): string {
  return cursor ? `CURSOR_JSON = ${JSON.stringify(JSON.stringify(cursor))}\n${AGNX_PY}` : AGNX_PY
}

/**
 * Runs on agni1. Reads the LiteLLM master key from the gateway's environment file there, asks the
 * admin API on loopback for the keys, and prints only alias, spend, budget and expiry of the crew's
 * two keys. The master key never leaves agni1 and is never printed; no key value or hash is sent.
 */
export const GATEWAY_PY = String.raw`
import json, os, urllib.error, urllib.request

ALIASES = ("agni-crew-jev", "agni-crew-claude")
ENV = "~/.local/share/agni-inference-stack/gateway-current/environment/gateway.env"
URL = "http://127.0.0.1:4000/key/list?return_full_object=true&size=100&page=%d"


def master_key(path):
    with open(os.path.expanduser(path)) as f:
        for line in f:
            if line.startswith("LITELLM_MASTER_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return None


def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def text(v):
    return v[:40] if isinstance(v, str) else None


def main(urlopen=urllib.request.urlopen, env_path=ENV):
    try:
        key = master_key(env_path)
    except Exception:
        key = None
    if not key:
        print(json.dumps({"schema": "pitwall.gateway/1", "error": "no_master_key"}))
        return
    found = {}
    try:
        page = 1
        while page <= 20:
            req = urllib.request.Request(URL % page, headers={"Authorization": "Bearer " + key})
            with urlopen(req, timeout=5) as r:
                d = json.load(r)
            for k in d.get("keys") or []:
                alias = k.get("key_alias") if isinstance(k, dict) else None
                if alias in ALIASES:
                    found[alias] = {
                        "alias": alias,
                        "spend": num(k.get("spend")),
                        "max_budget": num(k.get("max_budget")),
                        "expires": text(k.get("expires")),
                    }
            if page >= int(d.get("total_pages") or 1):
                break
            page += 1
    except urllib.error.HTTPError as e:
        print(json.dumps({"schema": "pitwall.gateway/1", "error": "http_%d" % e.code}))
        return
    except Exception as e:
        print(json.dumps({"schema": "pitwall.gateway/1", "error": type(e).__name__}))
        return
    finally:
        key = None
    print(json.dumps({
        "schema": "pitwall.gateway/1",
        "keys": [found[a] for a in ALIASES if a in found],
        "missing": [a for a in ALIASES if a not in found],
    }))


if __name__ == "__main__":
    main()
`
