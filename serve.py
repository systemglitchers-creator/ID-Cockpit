"""Local server for the ID Study reading schedule. Python stdlib only.

Serves the Skill Tree dashboard and tracks read-state. Card/question generation
was removed — that work is done via the Claude Code skills (id-anki-cards, etc.).
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import platform_core as core


def _sync_cfg():
    return core.load_sync_config(PLATFORM_DIR)


PLATFORM_DIR = Path(__file__).resolve().parent
DEFAULT_BASE = PLATFORM_DIR.parent  # the "8. Claude" artifact root
STATIC_FILES = {
    "/": "dashboard.html",
    "/dashboard.html": "dashboard.html",
}
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}


class Handler(BaseHTTPRequestHandler):
    # base_dir is injected via the server instance (see make_server)
    def _state_path(self):
        # state.json lives under <base>/<platform folder>/ (created on first write).
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
        route = urlparse(self.path).path
        if route in STATIC_FILES:
            self._send_file(STATIC_FILES[route])
            return
        if route == "/api/status":
            state = core.load_state(self._state_path())
            self._send_json({"done": state["sessions"]})
            return
        self.send_error(404, "Not found")

    def do_POST(self):
        route = urlparse(self.path).path
        if route.startswith("/api/session/") and route.endswith("/done"):
            session_id = route[len("/api/session/"):-len("/done")]
            body = self._read_body()
            entry = core.toggle_done(self._state_path(), session_id, bool(body.get("done")))
            cfg = _sync_cfg()
            if cfg:
                try: core.push_remote(cfg, core.load_state(self._state_path()))
                except Exception: pass
            self._send_json(entry)
            return
        if route == "/api/import":
            body = self._read_body()
            ids = body.get("ids", [])
            if not isinstance(ids, list):
                ids = []
            core.import_ids(self._state_path(), ids)
            cfg = _sync_cfg()
            if cfg:
                try: core.push_remote(cfg, core.load_state(self._state_path()))
                except Exception: pass
            self._send_json({"imported": len(ids)})
            return
        self.send_error(404, "Not found")

    def log_message(self, *args):
        pass  # keep the console quiet


# Note: ThreadingHTTPServer + unlocked read-modify-write of state.json is fine for
# single-user local use. Do not add multi-client usage without a lock in platform_core.
def make_server(host="127.0.0.1", port=8756, base_dir=None):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.base_dir = base_dir or str(os.environ.get("ID_PLATFORM_BASE", DEFAULT_BASE))
    cfg = core.load_sync_config(PLATFORM_DIR)
    if cfg:
        try:
            state_path = Path(httpd.base_dir) / PLATFORM_DIR.name / "state.json"
            local = core.load_state(state_path)
            merged = {"sessions": core.merge_sessions(local["sessions"], core.pull_remote(cfg))}
            core._save_state(state_path, merged)
        except Exception:
            pass  # offline / bad token: keep local
    return httpd


if __name__ == "__main__":
    server = make_server(port=int(os.environ.get("ID_PLATFORM_PORT", 8756)))
    host, port = server.server_address
    print(f"ID Study reading schedule → http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
