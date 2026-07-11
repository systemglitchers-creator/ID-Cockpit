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
    httpd, port = _start_server(tmp_path)
    try:
        st, body = _get(port, "/")
        assert st == 200
        assert "<html" in body.lower() or "<!doctype" in body.lower()
    finally:
        httpd.shutdown()


def test_import_non_list_ids_reports_zero(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        st, body = _post(port, "/api/import", {"ids": "abcd"})
        assert st == 200
        assert json.loads(body)["imported"] == 0
        # and nothing was actually imported
        _, sbody = _get(port, "/api/status")
        assert json.loads(sbody)["done"] == {}
    finally:
        httpd.shutdown()
