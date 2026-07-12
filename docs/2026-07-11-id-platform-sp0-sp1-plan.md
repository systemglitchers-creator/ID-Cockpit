# ID Study Platform SP0+SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a free local cockpit — a Python stdlib server plus the existing ID Study Schedule rewired — that shows per-session read/card/question status and offers copy-a-prompt buttons, with no card/question generation yet.

**Architecture:** A single-file `http.server` (`serve.py`) delegates all logic to a pure, unit-tested `platform_core.py` (state read/write, artifact-folder counting, prompt-template filling). The curated reading plan stays embedded in the schedule HTML; the server owns only read-state (`state.json`) and derives card/question counts live by scanning the `ID Anki Cards/` and `ID Practice Questions/` folders. The schedule HTML is copied to `dashboard.html` and augmented by a separate `cockpit.js` that loads after the page's inline script and hooks its script-scoped `SECTIONS`/`done`/`save` globals.

**Tech Stack:** Python 3.9 standard library only (`http.server`, `json`, `pathlib`, `urllib`), pytest for tests, vanilla JS for the client layer. No pip installs. Git history scoped to the `ID Platform/` folder.

**Working directory for all commands:** `/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform`

**Note on the base folder:** The `8. Claude/` directory (parent of `ID Platform/`) is the artifact root holding `ID Anki Cards/` and (later) `ID Practice Questions/`. `serve.py` and `platform_core.py` read this root from the `ID_PLATFORM_BASE` environment variable, defaulting to the real parent folder, so tests can point at a temp dir.

---

## File Structure

```
8. Claude/ID Platform/
  serve.py              # HTTP routing + static serving; thin, delegates to platform_core
  platform_core.py      # pure logic: parse_chapter_num, scan_counts, state I/O, fill_prompt
  prompts.json          # copy-a-prompt templates (cards, questions)
  dashboard.html        # copy of the schedule HTML + one injected <script src="cockpit.js">
  cockpit.js            # client layer: server sync, badges, detail panel, legacy import
  .gitignore            # ignores state.json and __pycache__
  state.json            # runtime read-state (created by server; gitignored)
  tests/
    test_platform_core.py
    test_serve.py
  docs/                 # spec + this plan (already present)
```

Responsibilities:
- **platform_core.py** — all logic, no HTTP. Easy to hold in context and test.
- **serve.py** — routing only; parses the request, calls a core function, writes JSON.
- **cockpit.js** — all client augmentation, isolated from the big inline script.

---

## Task 1: Scaffold the platform folder and folder contract

**Files:**
- Create: `.gitignore`
- Create: `prompts.json`
- Create: `tests/test_platform_core.py` (structural check only in this task)

- [ ] **Step 1: Initialize git scoped to this folder**

Run (from the `ID Platform` directory):
```bash
git init
```
Expected: `Initialized empty Git repository in .../ID Platform/.git/`

- [ ] **Step 2: Create `.gitignore`**

Create `.gitignore` with exactly:
```
state.json
__pycache__/
*.pyc
.DS_Store
```

- [ ] **Step 3: Create `prompts.json`**

Create `prompts.json` with exactly:
```json
{
  "cards": "Using the id-anki-cards skill, make Anki cards from the highlighted PDF for Chapter {NN} — {title}, pages {ps}-{pe}. Confirm the PDF path with me before extracting.",
  "questions": "Using the id-practice-questions skill, make RC-format practice questions for Chapter {NN} — {title} from my existing Anki cards."
}
```

- [ ] **Step 4: Write a structural test for prompts.json**

Create `tests/test_platform_core.py` with:
```python
import json
from pathlib import Path

PLATFORM_DIR = Path(__file__).resolve().parent.parent


def test_prompts_json_has_both_templates():
    data = json.loads((PLATFORM_DIR / "prompts.json").read_text())
    assert "cards" in data and "questions" in data
    assert "{NN}" in data["cards"] and "{title}" in data["cards"]
    assert "{NN}" in data["questions"] and "{title}" in data["questions"]
```

- [ ] **Step 5: Run the test**

Run: `python3 -m pytest tests/test_platform_core.py -v`
Expected: PASS (1 passed)

- [ ] **Step 6: Commit**

```bash
git add .gitignore prompts.json tests/test_platform_core.py
git commit -m "chore: scaffold ID Platform folder, prompts, gitignore"
```

---

## Task 2: platform_core.py — pure logic (state, counts, prompts)

**Files:**
- Create: `platform_core.py`
- Test: `tests/test_platform_core.py`

### Task 2a: parse_chapter_num

- [ ] **Step 1: Write the failing test**

Append to `tests/test_platform_core.py`:
```python
import platform_core as core


def test_parse_chapter_num_extracts_leading_number():
    assert core.parse_chapter_num("Chapter 20 — Penicillins · Part 1 of 3") == "20"
    assert core.parse_chapter_num("20 - Penicillins and Beta-Lactamase Inhibitors") == "20"
    assert core.parse_chapter_num("Chapter 5 — Something") == "5"


def test_parse_chapter_num_returns_none_when_absent():
    assert core.parse_chapter_num("Antimicrobial Stewardship overview") is None
```

To let the test import `platform_core`, add a `conftest.py` so the platform dir is on `sys.path`. Create `tests/conftest.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_platform_core.py::test_parse_chapter_num_extracts_leading_number -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'platform_core'` or `AttributeError`.

- [ ] **Step 3: Write minimal implementation**

Create `platform_core.py`:
```python
"""Pure logic for the ID Study Platform cockpit. No HTTP here."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

_CHAPTER_RE = re.compile(r"(?:Chapter\s+)?(\d+)")


def parse_chapter_num(title):
    """Return the chapter number as a string, or None if the title has none.

    Matches 'Chapter 20 — ...' and '20 - ...'. Returns the first integer that
    appears at, or right after an optional 'Chapter ' prefix at, the start.
    """
    m = _CHAPTER_RE.match(title.strip())
    return m.group(1) if m else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_platform_core.py -k parse_chapter_num -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add platform_core.py tests/
git commit -m "feat: parse_chapter_num in platform_core"
```

### Task 2b: scan_counts

- [ ] **Step 1: Write the failing test**

Append to `tests/test_platform_core.py`:
```python
def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))


def test_scan_counts_counts_cards_and_questions(tmp_path):
    cards_dir = tmp_path / "ID Anki Cards" / "20 - Penicillins"
    _write_json(cards_dir / "2026-07-01.json", {"cards": [{"Text": "a"}, {"Text": "b"}]})
    _write_json(cards_dir / "2026-07-02.json", {"cards": [{"Text": "c"}]})
    q_dir = tmp_path / "ID Practice Questions" / "20 - Penicillins"
    _write_json(q_dir / "2026-07-03.json", {"questions": [{"stem": "x"}]})

    counts = core.scan_counts(tmp_path)
    assert counts["20"]["cards"] == 3
    assert counts["20"]["questions"] == 1


def test_scan_counts_handles_missing_folders(tmp_path):
    assert core.scan_counts(tmp_path) == {}


def test_scan_counts_ignores_nonjson_and_bad_json(tmp_path):
    d = tmp_path / "ID Anki Cards" / "21 - Cephalosporins"
    d.mkdir(parents=True)
    (d / "notes.txt").write_text("ignore me")
    (d / "broken.json").write_text("{not valid json")
    _write_json(d / "2026-07-01.json", {"cards": [{"Text": "a"}]})
    counts = core.scan_counts(tmp_path)
    assert counts["21"]["cards"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_platform_core.py -k scan_counts -v`
Expected: FAIL with `AttributeError: module 'platform_core' has no attribute 'scan_counts'`.

- [ ] **Step 3: Write minimal implementation**

Append to `platform_core.py`:
```python
CARDS_SUBDIR = "ID Anki Cards"
QUESTIONS_SUBDIR = "ID Practice Questions"


def _count_items(json_path, key):
    """Number of items under `key` in a JSON file; 0 if unreadable or absent."""
    try:
        obj = json.loads(json_path.read_text())
    except (ValueError, OSError):
        return 0
    items = obj.get(key)
    return len(items) if isinstance(items, list) else 0


def _scan_subdir(base_dir, subdir, key, counts):
    root = Path(base_dir) / subdir
    if not root.is_dir():
        return
    for chapter_dir in root.iterdir():
        if not chapter_dir.is_dir():
            continue
        nn = parse_chapter_num(chapter_dir.name)
        if nn is None:
            continue
        total = sum(_count_items(f, key) for f in chapter_dir.glob("*.json"))
        counts.setdefault(nn, {"cards": 0, "questions": 0})
        counts[nn][key if key == "cards" else "questions"] = total


def scan_counts(base_dir):
    """Map chapter number -> {'cards': n, 'questions': m} by scanning artifact folders."""
    counts = {}
    _scan_subdir(base_dir, CARDS_SUBDIR, "cards", counts)
    _scan_subdir(base_dir, QUESTIONS_SUBDIR, "questions", counts)
    return counts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_platform_core.py -k scan_counts -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add platform_core.py tests/test_platform_core.py
git commit -m "feat: scan_counts derives card/question counts per chapter"
```

### Task 2c: state I/O (load, toggle, import)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_platform_core.py`:
```python
def test_load_state_returns_empty_when_missing(tmp_path):
    assert core.load_state(tmp_path / "state.json") == {"sessions": {}}


def test_toggle_done_sets_and_persists(tmp_path):
    sp = tmp_path / "state.json"
    entry = core.toggle_done(sp, "ch20-p1", True)
    assert entry["done"] is True and entry["doneAt"]
    reloaded = core.load_state(sp)
    assert reloaded["sessions"]["ch20-p1"]["done"] is True


def test_toggle_done_false_clears_flag(tmp_path):
    sp = tmp_path / "state.json"
    core.toggle_done(sp, "ch20-p1", True)
    entry = core.toggle_done(sp, "ch20-p1", False)
    assert entry["done"] is False


def test_import_ids_unions_without_clobbering(tmp_path):
    sp = tmp_path / "state.json"
    core.toggle_done(sp, "ch20-p1", True)
    core.import_ids(sp, ["ch20-p1", "ch21-p1", "ch21-p2"])
    state = core.load_state(sp)
    assert set(state["sessions"]) == {"ch20-p1", "ch21-p1", "ch21-p2"}
    assert all(state["sessions"][k]["done"] for k in state["sessions"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_platform_core.py -k "state or toggle or import" -v`
Expected: FAIL with `AttributeError` on `load_state`.

- [ ] **Step 3: Write minimal implementation**

Append to `platform_core.py`:
```python
def _now_iso():
    return datetime.now().isoformat(timespec="seconds")


def load_state(state_path):
    """Read state.json, returning {'sessions': {...}}; tolerant of missing/corrupt file."""
    p = Path(state_path)
    if not p.exists():
        return {"sessions": {}}
    try:
        data = json.loads(p.read_text())
    except (ValueError, OSError):
        return {"sessions": {}}
    if not isinstance(data, dict) or "sessions" not in data:
        return {"sessions": {}}
    return data


def _save_state(state_path, state):
    p = Path(state_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2))


def toggle_done(state_path, session_id, done):
    """Set a session's read-state and persist. Returns the updated entry."""
    state = load_state(state_path)
    entry = {"done": bool(done), "doneAt": _now_iso() if done else None}
    state["sessions"][session_id] = entry
    _save_state(state_path, state)
    return entry


def import_ids(state_path, ids):
    """One-time seed: mark each id done if not already present. Idempotent union."""
    state = load_state(state_path)
    for sid in ids:
        if sid not in state["sessions"]:
            state["sessions"][sid] = {"done": True, "doneAt": _now_iso()}
    _save_state(state_path, state)
    return state
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_platform_core.py -k "state or toggle or import" -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add platform_core.py tests/test_platform_core.py
git commit -m "feat: state load/toggle/import in platform_core"
```

### Task 2d: fill_prompt

- [ ] **Step 1: Write the failing test**

Append to `tests/test_platform_core.py`:
```python
def test_fill_prompt_substitutes_all_fields(tmp_path):
    template = "Chapter {NN} — {title}, pages {ps}-{pe}."
    out = core.fill_prompt(template, {"NN": "20", "title": "Penicillins", "ps": "263", "pe": "268"})
    assert out == "Chapter 20 — Penicillins, pages 263-268."


def test_fill_prompt_leaves_unknown_placeholders_untouched():
    out = core.fill_prompt("Ch {NN} {missing}", {"NN": "20"})
    assert out == "Ch 20 {missing}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_platform_core.py -k fill_prompt -v`
Expected: FAIL with `AttributeError` on `fill_prompt`.

- [ ] **Step 3: Write minimal implementation**

Append to `platform_core.py`:
```python
def fill_prompt(template, fields):
    """Replace {key} placeholders with values. Unknown placeholders are left as-is."""
    out = template
    for key, val in fields.items():
        out = out.replace("{" + key + "}", str(val))
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_platform_core.py -k fill_prompt -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full core suite**

Run: `python3 -m pytest tests/test_platform_core.py -v`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add platform_core.py tests/test_platform_core.py
git commit -m "feat: fill_prompt template substitution"
```

---

## Task 3: serve.py — HTTP routing and static serving

**Files:**
- Create: `serve.py`
- Test: `tests/test_serve.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_serve.py`:
```python
import json
import threading
import time
import urllib.request
from pathlib import Path

import serve  # noqa: E402


def _start_server(base_dir):
    httpd = serve.make_server(host="127.0.0.1", port=0, base_dir=str(base_dir))
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    port = httpd.server_address[1]
    time.sleep(0.05)
    return httpd, port


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as r:
        return r.status, r.read().decode()


def _post(port, path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return r.status, r.read().decode()


def test_status_reports_counts(tmp_path):
    cards = tmp_path / "ID Anki Cards" / "20 - Penicillins"
    cards.mkdir(parents=True)
    (cards / "2026-07-01.json").write_text(json.dumps({"cards": [{"Text": "a"}, {"Text": "b"}]}))
    httpd, port = _start_server(tmp_path)
    try:
        st, body = _get(port, "/api/status")
        data = json.loads(body)
        assert st == 200
        assert data["chapters"]["20"]["cards"] == 2
        assert data["done"] == {}
    finally:
        httpd.shutdown()


def test_toggle_then_status_roundtrip(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        st, _ = _post(port, "/api/session/ch20-p1/done", {"done": True})
        assert st == 200
        _, body = _get(port, "/api/status")
        assert json.loads(body)["done"]["ch20-p1"]["done"] is True
    finally:
        httpd.shutdown()


def test_import_seeds_done(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        st, _ = _post(port, "/api/import", {"ids": ["ch20-p1", "ch21-p1"]})
        assert st == 200
        _, body = _get(port, "/api/status")
        assert set(json.loads(body)["done"]) == {"ch20-p1", "ch21-p1"}
    finally:
        httpd.shutdown()


def test_prompt_endpoint_fills_template(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        _, body = _get(port, "/api/prompt?action=cards&NN=20&title=Penicillins&ps=263&pe=268")
        prompt = json.loads(body)["prompt"]
        assert "Chapter 20" in prompt and "Penicillins" in prompt and "263-268" in prompt
    finally:
        httpd.shutdown()


def test_root_serves_dashboard(tmp_path):
    # dashboard.html must resolve relative to the platform dir, not base_dir
    httpd, port = _start_server(tmp_path)
    try:
        st, body = _get(port, "/")
        assert st == 200
        assert "<html" in body.lower() or "<!doctype" in body.lower()
    finally:
        httpd.shutdown()
```

For imports to resolve, extend `tests/conftest.py` (already adds the platform dir to `sys.path`, so `import serve` works). No change needed.

Note: `test_root_serves_dashboard` requires a `dashboard.html` to exist. Create a temporary stub now so this task is self-contained; Task 4 replaces it with the real copy:
```bash
printf '<!doctype html><html><body>stub</body></html>' > dashboard.html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_serve.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'serve'`.

- [ ] **Step 3: Write minimal implementation**

Create `serve.py`:
```python
"""Local cockpit server for the ID Study Platform. Python stdlib only."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import platform_core as core

PLATFORM_DIR = Path(__file__).resolve().parent
DEFAULT_BASE = PLATFORM_DIR.parent  # the "8. Claude" artifact root
STATIC_FILES = {
    "/": "dashboard.html",
    "/dashboard.html": "dashboard.html",
    "/cockpit.js": "cockpit.js",
}
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}


def _load_prompts():
    return json.loads((PLATFORM_DIR / "prompts.json").read_text())


class Handler(BaseHTTPRequestHandler):
    # base_dir and state_path are injected via the server instance (see make_server)
    def _base(self):
        return self.server.base_dir

    def _state_path(self):
        # state.json always lives under <base>/ID Platform/ (created on first write).
        return Path(self.server.base_dir) / "ID Platform" / "state.json"

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, filename):
        path = PLATFORM_DIR / filename
        if not path.exists():
            self.send_error(404, "Not found")
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode())
        except ValueError:
            return {}

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        if route in STATIC_FILES:
            self._send_file(STATIC_FILES[route])
            return
        if route == "/api/status":
            state = core.load_state(self._state_path())
            counts = core.scan_counts(self._base())
            self._send_json({"done": state["sessions"], "chapters": counts})
            return
        if route == "/api/prompt":
            q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            prompts = _load_prompts()
            template = prompts.get(q.get("action", ""), "")
            fields = {k: q.get(k, "") for k in ("NN", "title", "ps", "pe")}
            self._send_json({"prompt": core.fill_prompt(template, fields)})
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        route = urlparse(self.path).path
        if route.startswith("/api/session/") and route.endswith("/done"):
            session_id = route[len("/api/session/"):-len("/done")]
            body = self._read_body()
            entry = core.toggle_done(self._state_path(), session_id, bool(body.get("done")))
            self._send_json(entry)
            return
        if route == "/api/import":
            body = self._read_body()
            ids = body.get("ids", [])
            core.import_ids(self._state_path(), ids if isinstance(ids, list) else [])
            self._send_json({"imported": len(ids)})
            return
        self.send_error(404, "Not found")

    def log_message(self, *args):
        pass  # keep the console quiet


def make_server(host="127.0.0.1", port=8756, base_dir=None):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.base_dir = base_dir or str(os.environ.get("ID_PLATFORM_BASE", DEFAULT_BASE))
    return httpd


if __name__ == "__main__":
    server = make_server(port=int(os.environ.get("ID_PLATFORM_PORT", 8756)))
    host, port = server.server_address
    print(f"ID Study Platform cockpit → http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
```

Note on `_state_path`: state always lands at `<base>/ID Platform/state.json`, and `_save_state` creates that parent dir on first write. In tests, `base_dir` is a temp dir, so state lands at `<tmp>/ID Platform/state.json` (parent auto-created). In production, `base_dir` is `8. Claude`, so state lands at `8. Claude/ID Platform/state.json` — matching the folder contract. (The `serve.py`/`state.json` files are the same `ID Platform/` dir; this resolves to the real folder in production.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_serve.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add serve.py tests/test_serve.py dashboard.html
git commit -m "feat: stdlib cockpit server with status/toggle/import/prompt endpoints"
```

---

## Task 4: dashboard.html + cockpit.js — the client cockpit

**Files:**
- Overwrite: `dashboard.html` (replace the stub with a copy of the schedule HTML + one injected script tag)
- Create: `cockpit.js`

- [ ] **Step 1: Copy the schedule HTML and inject the cockpit script**

Run (single command; copies the real schedule then injects the script tag before `</body>`):
```bash
SRC="/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/1. Fellowship/Study Schedule/ID Study Schedule.html"
python3 - "$SRC" <<'PY'
import sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
tag = '<script src="/cockpit.js"></script>'
assert tag not in src
if "</body>" in src:
    src = src.replace("</body>", tag + "\n</body>", 1)
else:
    src = src + "\n" + tag
pathlib.Path("dashboard.html").write_text(src, encoding="utf-8")
print("dashboard.html written, cockpit tag injected")
PY
```
Expected: `dashboard.html written, cockpit tag injected`

- [ ] **Step 2: Create `cockpit.js`**

Create `cockpit.js` with exactly:
```javascript
/* ID Study Platform cockpit layer.
   Loads AFTER the schedule's inline script, so its script-scoped globals
   (SECTIONS, done, save, build, refresh) are reachable as lexical globals.
   Everything here is additive: server sync, status badges, a detail panel,
   and a one-time import of legacy localStorage read-state. */
(function () {
  "use strict";

  var STATUS = { done: {}, chapters: {} };

  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  // Build id -> {NN, title, ps, pe} from the plan the page already holds.
  function planIndex() {
    var idx = {};
    if (typeof SECTIONS === "undefined") return idx;
    SECTIONS.forEach(function (s) {
      (s.rows || []).forEach(function (r) {
        var m = /(?:Chapter\s+)?(\d+)/.exec((r.r || "").trim());
        idx[r.id] = {
          NN: m ? m[1] : "",
          title: (r.r || "").replace(/\s+·.*$/, "").replace(/^(?:Chapter\s+)?\d+\s*[—-]\s*/, "").trim(),
          ps: r.ps || "", pe: r.pe || r.ps || ""
        };
      });
    });
    return idx;
  }

  var PLAN = {};

  // One-time import of legacy read-state into the server, if server is empty.
  function importLegacyOnce() {
    if (Object.keys(STATUS.done).length > 0) return Promise.resolve();
    var ids = [];
    if (typeof done === "object" && done) ids = Object.keys(done).filter(function (k) { return done[k]; });
    if (!ids.length) return Promise.resolve();
    return api("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids })
    });
  }

  // Reflect server read-state onto the in-page `done` map, then re-render.
  function adoptServerReadState() {
    if (typeof done !== "object" || !done) return;
    Object.keys(done).forEach(function (k) { delete done[k]; });
    Object.keys(STATUS.done).forEach(function (k) {
      if (STATUS.done[k] && STATUS.done[k].done) done[k] = 1;
    });
    if (typeof build === "function") build();
    if (typeof refresh === "function") refresh();
  }

  // Add card/question badges to each rendered row.
  function applyBadges() {
    document.querySelectorAll(".rw").forEach(function (el) {
      if (el.querySelector(".cockpit-badges")) return;
      var info = PLAN[el.dataset.id];
      if (!info || !info.NN) return;
      var c = STATUS.chapters[info.NN] || { cards: 0, questions: 0 };
      var span = document.createElement("span");
      span.className = "cockpit-badges";
      span.innerHTML =
        '<em class="cb cb-c" title="Anki cards">◆ ' + c.cards + "</em>" +
        '<em class="cb cb-q" title="Practice questions">● ' + c.questions + "</em>";
      var mid = el.querySelector(".mid");
      (mid || el).appendChild(span);
    });
  }

  // Wrap the page's save() so every read-toggle also writes through to the server.
  function hookSave() {
    if (typeof save !== "function") return;
    var origSave = save;
    // eslint-disable-next-line no-global-assign
    save = function () {
      origSave();
      var ids = (typeof done === "object" && done) ? Object.keys(done).filter(function (k) { return done[k]; }) : [];
      // Push the full done-set as the source of truth by diffing against STATUS.
      var serverIds = Object.keys(STATUS.done).filter(function (k) { return STATUS.done[k] && STATUS.done[k].done; });
      var setNow = {};
      ids.forEach(function (id) { setNow[id] = true; });
      // Toggled on:
      ids.forEach(function (id) {
        if (serverIds.indexOf(id) === -1) postDone(id, true);
      });
      // Toggled off:
      serverIds.forEach(function (id) {
        if (!setNow[id]) postDone(id, false);
      });
    };
  }

  function postDone(id, val) {
    STATUS.done[id] = { done: val, doneAt: new Date().toISOString() };
    api("/api/session/" + encodeURIComponent(id) + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: val })
    });
  }

  // Detail panel with copy-a-prompt buttons.
  function buildPanel() {
    var panel = document.createElement("div");
    panel.id = "cockpit-panel";
    panel.style.cssText =
      "position:fixed;right:0;top:0;bottom:0;width:min(380px,90vw);background:var(--surf2,#1c2726);" +
      "border-left:1px solid var(--line,#26312f);box-shadow:-8px 0 30px rgba(0,0,0,.4);" +
      "padding:22px 20px;transform:translateX(100%);transition:transform .2s ease;z-index:9999;" +
      "color:var(--txt,#eef3f0);font-family:inherit;overflow:auto";
    panel.innerHTML =
      '<button id="cockpit-close" style="float:right;background:none;border:0;color:var(--soft,#a9b6b0);font-size:20px;cursor:pointer">×</button>' +
      '<div id="cockpit-body"></div>';
    document.body.appendChild(panel);
    panel.querySelector("#cockpit-close").onclick = function () { panel.style.transform = "translateX(100%)"; };
    return panel;
  }

  function copyPrompt(action, info) {
    var qs = "action=" + action + "&NN=" + encodeURIComponent(info.NN) +
      "&title=" + encodeURIComponent(info.title) +
      "&ps=" + encodeURIComponent(info.ps) + "&pe=" + encodeURIComponent(info.pe);
    return api("/api/prompt?" + qs).then(function (d) {
      return navigator.clipboard.writeText(d.prompt).then(function () { return d.prompt; });
    });
  }

  function openPanel(panel, id) {
    var info = PLAN[id];
    if (!info) return;
    var c = STATUS.chapters[info.NN] || { cards: 0, questions: 0 };
    var body = panel.querySelector("#cockpit-body");
    body.innerHTML =
      '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint,#748078)">Chapter ' + (info.NN || "—") + "</div>" +
      '<h3 style="margin:6px 0 4px;font-size:16px">' + info.title + "</h3>" +
      '<div style="color:var(--soft,#a9b6b0);font-size:13px;margin-bottom:16px">pp. ' + info.ps + "–" + info.pe +
      " · ◆ " + c.cards + " cards · ● " + c.questions + " questions</div>" +
      '<button class="cockpit-act" data-act="cards" style="display:block;width:100%;margin:8px 0;padding:11px;border-radius:8px;border:1px solid var(--acc-line,#3a5);background:var(--acc-wash,rgba(79,216,160,.10));color:var(--txt,#eef3f0);cursor:pointer;text-align:left">Copy: make Anki cards →</button>' +
      '<button class="cockpit-act" data-act="questions" style="display:block;width:100%;margin:8px 0;padding:11px;border-radius:8px;border:1px solid var(--acc-line,#3a5);background:var(--acc-wash,rgba(79,216,160,.10));color:var(--txt,#eef3f0);cursor:pointer;text-align:left">Copy: make RC questions →</button>' +
      '<div id="cockpit-toast" style="margin-top:12px;font-size:12px;color:var(--acc,#4fd8a0);min-height:16px"></div>';
    body.querySelectorAll(".cockpit-act").forEach(function (btn) {
      btn.onclick = function () {
        copyPrompt(btn.dataset.act, info).then(function () {
          body.querySelector("#cockpit-toast").textContent = "Copied — paste into Claude Code.";
        });
      };
    });
    panel.style.transform = "translateX(0)";
  }

  // Add an info affordance to each row that opens the panel (without disturbing
  // the existing row-click read-toggle).
  function wirePanel(panel) {
    document.querySelectorAll(".rw").forEach(function (el) {
      if (el.querySelector(".cockpit-info")) return;
      var info = PLAN[el.dataset.id];
      if (!info || !info.NN) return;
      var b = document.createElement("button");
      b.className = "cockpit-info";
      b.textContent = "ⓘ";
      b.title = "Actions";
      b.style.cssText = "margin-left:8px;background:none;border:0;color:var(--faint,#748078);cursor:pointer;font-size:14px";
      b.onclick = function (ev) { ev.stopPropagation(); openPanel(panel, el.dataset.id); };
      var mid = el.querySelector(".mid .rtitle") || el;
      mid.appendChild(b);
    });
  }

  // Idempotent decoration; safe to call after every re-render of #wrap.
  function decorate(panel) {
    applyBadges();
    wirePanel(panel);
  }

  function observeWrap(panel) {
    var wrap = document.getElementById("wrap");
    if (!wrap) return;
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; decorate(panel); });
    }).observe(wrap, { childList: true, subtree: true });
  }

  function boot() {
    PLAN = planIndex();
    api("/api/status").then(function (s) {
      STATUS = s;
      return importLegacyOnce();
    }).then(function () {
      return api("/api/status");
    }).then(function (s) {
      STATUS = s;
      adoptServerReadState();
      hookSave();
      var panel = buildPanel();
      decorate(panel);
      observeWrap(panel);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
```

- [ ] **Step 3: Add badge styles**

The badges reference class `.cb`. Add minimal styling by appending a `<style>` block to `dashboard.html` head. Run:
```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path("dashboard.html")
html = p.read_text(encoding="utf-8")
css = ("<style>.cockpit-badges{margin-left:auto;display:inline-flex;gap:8px;padding-left:10px}"
       ".cb{font-style:normal;font-size:11px;color:var(--faint,#748078);white-space:nowrap}"
       ".cb-q{color:var(--gold,#e8c26a)}.rw .mid{display:flex;align-items:center;gap:6px}</style>")
assert ".cockpit-badges" not in html
html = html.replace("</head>", css + "\n</head>", 1)
p.write_text(html, encoding="utf-8")
print("badge styles appended")
PY
```
Expected: `badge styles appended`

- [ ] **Step 4: Re-run the server test suite (dashboard.html now real)**

Run: `python3 -m pytest tests/ -v`
Expected: PASS (all tests, including `test_root_serves_dashboard`)

- [ ] **Step 5: Commit**

```bash
git add dashboard.html cockpit.js
git commit -m "feat: cockpit dashboard — badges, detail panel, server-synced read-state"
```

---

## Task 5: End-to-end verification in the preview browser

**Files:** none (verification only)

- [ ] **Step 1: Start the server**

Run the server in the background from the `ID Platform` dir:
```bash
python3 serve.py
```
Expected console line: `ID Study Platform cockpit → http://127.0.0.1:8756`

- [ ] **Step 2: Open the dashboard in the preview browser**

Use `preview_start` with `{url: "http://127.0.0.1:8756/"}`.

- [ ] **Step 3: Verify the plan renders with its original look**

Use `read_page`. Confirm the year headers ("Year One · Core Fellowship"), section titles, and session rows are present and styled (dark theme intact).

- [ ] **Step 4: Verify card badges for an already-carded chapter**

Confirm that a chapter with an existing `8. Claude/ID Anki Cards/<NN - …>/` folder shows a non-zero `◆ N` badge. If none of Tyler's carded chapters are visible without scrolling, use `find` to locate one by its `data-id` and confirm its badge count matches the JSON in that folder.

- [ ] **Step 5: Verify read-toggle persists to the server**

Click a session row (via `computer`), then check `state.json` was written:
```bash
cat "state.json"
```
Expected: JSON containing that session id with `"done": true`. Reload the page (`navigate` to the same URL) and confirm the row stays marked read.

- [ ] **Step 6: Verify copy-a-prompt**

Click a row's `ⓘ` affordance to open the panel, click "Copy: make RC questions", and confirm the toast "Copied — paste into Claude Code." appears. Read the clipboard via `javascript_tool`: `navigator.clipboard.readText()` and confirm it contains `Chapter <NN>` and the chapter title.

- [ ] **Step 7: Check the console for errors**

Use `read_console_messages` with `onlyErrors: true`. Expected: no errors. If any appear, read `cockpit.js`, fix, and re-verify from Step 2.

- [ ] **Step 8: Take a screenshot as proof**

Use `computer {action: "screenshot"}` to capture the cockpit with badges and the open detail panel.

- [ ] **Step 9: Stop the server and commit any fixes**

Stop the background server. If Steps 3–8 required fixes:
```bash
git add -A
git commit -m "fix: cockpit verification adjustments"
```

---

## Self-Review Notes

- **Spec §3 (architecture):** stdlib server (Task 3), plan stays in HTML (Task 4 copy), server owns state + derived counts (Tasks 2b–2c), session→chapter mapping (Task 2a). Covered.
- **Spec §4 (folder contract):** `state.json`/`prompts.json` locations (Tasks 1, 3), derived counts over both artifact folders (Task 2b), `ID Practice Questions/` mirrors `ID Anki Cards/` (Task 2b constants). Covered.
- **Spec §5 (API):** `/api/status`, `/api/session/{id}/done`, `/api/import`, `/api/prompt`, `GET /` — all in Task 3 with tests. Covered.
- **Spec §6 (dashboard):** badges, detail panel with copy-a-prompt, localStorage→server with one-time import — Task 4 (`applyBadges`, `openPanel`, `hookSave`/`importLegacyOnce`). Covered.
- **Spec §7 (defaults):** port 8756 (Task 3), state.json not SQLite (Task 2c), cards prompt defers PDF path (Task 1 template). Covered.
- **Spec §8 (verification):** all six spec checks map to Task 5 steps. Covered.
- **Type consistency:** `scan_counts` returns `{NN: {"cards","questions"}}` consumed identically by serve `/api/status` and cockpit `STATUS.chapters`. `toggle_done`/`import_ids` operate on `state["sessions"]`, exposed as `STATUS.done`. Consistent.
- **Placeholder scan:** no TBD/TODO; every code step contains full code.
