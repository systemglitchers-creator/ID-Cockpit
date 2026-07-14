"""Local cockpit server for the ID Study Platform. Python stdlib only."""
from __future__ import annotations

import json
import os
import queue as _queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import platform_core as core
import cards_core
import ai_engine
import questions_core
import export_pdf

PLATFORM_DIR = Path(__file__).resolve().parent
DEFAULT_BASE = PLATFORM_DIR.parent  # the "8. Claude" artifact root
STATIC_FILES = {
    "/": "dashboard.html",
    "/dashboard.html": "dashboard.html",
    "/cockpit.js": "cockpit.js",
}
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}


def _load_prompts():
    return json.loads((PLATFORM_DIR / "prompts.json").read_text(encoding="utf-8"))


def _real_draft_fn(platform_dir):
    """Build a draft_fn that runs headless Claude using config.json, or errors."""
    def draft_fn(prompt):
        cfg = cards_core.load_config(platform_dir)
        raw = ai_engine.draft(prompt, claude_path=cfg.get("claudePath"),
                              model=cfg.get("model"), timeout=cfg.get("timeoutSec", 240))
        return ai_engine.parse_cards(raw)
    return draft_fn


def _real_q_draft_fn(platform_dir):
    def q_draft_fn(prompt):
        cfg = cards_core.load_config(platform_dir)
        raw = ai_engine.draft(prompt, claude_path=cfg.get("claudePath"),
                              model=cfg.get("model"), timeout=cfg.get("timeoutSec", 240))
        return ai_engine.parse_questions(raw)
    return q_draft_fn


class Handler(BaseHTTPRequestHandler):
    # base_dir is injected via the server instance (see make_server)
    def _base_dir(self):
        return self.server.base_dir

    def _pdir(self):
        # cards_core operates on the PLATFORM dir (config.json/queue/), which
        # differs from base_dir (the artifact root used by platform_core).
        return self.server.platform_dir

    def _state_path(self):
        # state.json always lives under <base>/<platform folder>/ (created on first write).
        return Path(self.server.base_dir) / PLATFORM_DIR.name / "state.json"

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
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
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            return {}
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
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
            counts = core.scan_counts(self._base_dir())
            self._send_json({"done": state["sessions"], "chapters": counts})
            return
        if route == "/api/prompt":
            q = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            prompts = _load_prompts()
            template = prompts.get(q.get("action", ""), "")
            fields = {k: q.get(k, "") for k in ("NN", "title", "ps", "pe")}
            self._send_json({"prompt": core.fill_prompt(template, fields)})
            return
        if route == "/api/cards/config":
            self._send_json({"configured": cards_core.is_configured(self._pdir())})
            return
        if route == "/api/cards/jobs":
            self._send_json(cards_core.list_jobs(self._pdir()))
            return
        if route.startswith("/api/cards/job/"):
            jid = route[len("/api/cards/job/"):]
            job = cards_core.load_job(self._pdir(), jid)
            if job is None:
                self.send_error(404, "no such job")
                return
            self._send_json(job)
            return
        if route == "/api/questions/precheck":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            self._send_json(questions_core.precheck(self._pdir(), q.get("nn", ""),
                                                    q.get("title", ""), q.get("sessionId", "")))
            return
        if route == "/api/questions/jobs":
            self._send_json(cards_core.list_jobs(self._pdir(), kind="questions"))
            return
        if route.startswith("/api/questions/job/"):
            jid = route[len("/api/questions/job/"):]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job is None:
                self.send_error(404, "no such job"); return
            self._send_json(job)
            return
        if route == "/api/questions/export":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            nn, title, sess = q.get("nn", ""), q.get("title", ""), q.get("session")
            if sess:
                qs = questions_core.load_session_questions(self._pdir(), nn, title, sess)
                sub = "session " + sess + " · practice questions"
                fname = sess + ".pdf"
            else:
                qs = questions_core.load_all_questions(self._pdir(), nn, title)
                sub = "all sessions · practice questions"
                fname = str(nn) + " - " + title + " - all questions.pdf"
            header = {"chapter": "Chapter " + str(nn) + " — " + title, "subtitle": sub}
            data = export_pdf.build(header, qs)
            # durable copy alongside the question JSON
            outdir = questions_core._chapter_q_dir(self._pdir(), nn, title)
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / fname).write_bytes(data)
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Disposition", 'attachment; filename="' + fname + '"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
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
            if not isinstance(ids, list):
                ids = []
            core.import_ids(self._state_path(), ids)
            self._send_json({"imported": len(ids)})
            return
        if route == "/api/cards/upload":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            length = int(self.headers.get("Content-Length", 0))
            pdf = self.rfile.read(length) if length else b""
            job = cards_core._ingest_upload(self._pdir(), q.get("sessionId", ""),
                                            q.get("nn", ""), q.get("title", ""), pdf)
            self.server.card_q.put(("cards", job["id"]))
            self._send_json({"jobId": job["id"]})
            return
        if route.startswith("/api/cards/job/") and route.endswith("/push"):
            jid = route[len("/api/cards/job/"):-len("/push")]
            job = cards_core.load_job(self._pdir(), jid)
            if job is None:
                self.send_error(404, "no such job")
                return
            body = self._read_body()
            self._send_json(cards_core.push(self._pdir(), job, body.get("cards", [])))
            return
        if route.startswith("/api/cards/job/") and route.endswith("/discard"):
            jid = route[len("/api/cards/job/"):-len("/discard")]
            cards_core.discard_job(self._pdir(), jid)
            self._send_json({"discarded": jid})
            return
        if route.startswith("/api/cards/job/") and route.endswith("/retry"):
            jid = route[len("/api/cards/job/"):-len("/retry")]
            job = cards_core.load_job(self._pdir(), jid)
            if job:
                cards_core.set_status(self._pdir(), job, "pending")
                self.server.card_q.put(("cards", jid))
            self._send_json({"retry": jid})
            return
        if route == "/api/questions/generate":
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            length = int(self.headers.get("Content-Length", 0))
            pdf = self.rfile.read(length) if length else None
            try:
                job = questions_core.ingest(self._pdir(), q.get("sessionId", ""),
                                            q.get("nn", ""), q.get("title", ""), pdf)
            except FileNotFoundError:
                self.send_error(409, "no source PDF; upload one"); return
            self.server.card_q.put(("questions", job["id"]))
            self._send_json({"jobId": job["id"]})
            return
        if route.startswith("/api/questions/job/") and route.endswith("/save"):
            jid = route[len("/api/questions/job/"):-len("/save")]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job is None:
                self.send_error(404, "no such job"); return
            body = self._read_body()
            self._send_json(questions_core.save(self._pdir(), job, body.get("questions", [])))
            return
        if route.startswith("/api/questions/job/") and route.endswith("/discard"):
            jid = route[len("/api/questions/job/"):-len("/discard")]
            cards_core.discard_job(self._pdir(), jid, kind="questions")
            self._send_json({"discarded": jid})
            return
        if route.startswith("/api/questions/job/") and route.endswith("/retry"):
            jid = route[len("/api/questions/job/"):-len("/retry")]
            job = cards_core.load_job(self._pdir(), jid, kind="questions")
            if job:
                cards_core.set_status(self._pdir(), job, "pending", kind="questions")
                self.server.card_q.put(("questions", jid))
            self._send_json({"retry": jid})
            return
        self.send_error(404, "Not found")

    def log_message(self, *args):
        pass  # keep the console quiet


# Note: ThreadingHTTPServer + unlocked read-modify-write of state.json is fine for
# single-user local use. Do not add multi-client usage without a lock in platform_core.
def make_server(host="127.0.0.1", port=8756, base_dir=None, platform_dir=None, draft_fn=None,
                q_draft_fn=None):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.base_dir = base_dir or str(os.environ.get("ID_PLATFORM_BASE", DEFAULT_BASE))
    httpd.platform_dir = platform_dir or str(PLATFORM_DIR)
    httpd.draft_fn = draft_fn or _real_draft_fn(httpd.platform_dir)
    httpd.q_draft_fn = q_draft_fn or _real_q_draft_fn(httpd.platform_dir)
    httpd.card_q = _queue.Queue()
    def _worker():
        while True:
            item = httpd.card_q.get()
            if item is None:
                return
            kind, jid = item
            try:
                if kind == "questions":
                    questions_core.process_job(httpd.platform_dir, jid, httpd.q_draft_fn)
                else:
                    cards_core.process_job(httpd.platform_dir, jid, httpd.draft_fn)
            except Exception:
                pass
            finally:
                httpd.card_q.task_done()
    t = threading.Thread(target=_worker, daemon=True); t.start()
    httpd.card_worker = t
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
