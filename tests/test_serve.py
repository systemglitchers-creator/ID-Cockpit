import json
import threading
import time
import urllib.error
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


def test_status_reports_done(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        st, body = _get(port, "/api/status")
        data = json.loads(body)
        assert st == 200
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


def test_bad_content_length_does_not_crash(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/session/ch1-p1/done",
            data=b"{}",
            headers={"Content-Type": "application/json", "Content-Length": "notanumber"},
            method="POST",
        )
        # urllib may recompute Content-Length; force the bad header through the raw path instead:
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", port)
        conn.putrequest("POST", "/api/session/ch1-p1/done")
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", "notanumber")
        conn.endheaders()
        conn.send(b"{}")
        resp = conn.getresponse()
        assert resp.status == 200
        conn.close()
    finally:
        httpd.shutdown()


def test_unknown_routes_return_404(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        for path in ("/api/nope", "/random"):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}{path}")
                assert False, "expected 404"
            except urllib.error.HTTPError as e:
                assert e.code == 404
    finally:
        httpd.shutdown()


def test_toggle_done_false_over_http(tmp_path):
    httpd, port = _start_server(tmp_path)
    try:
        _post(port, "/api/session/ch1-p1/done", {"done": True})
        st, body = _post(port, "/api/session/ch1-p1/done", {"done": False})
        assert st == 200
        assert json.loads(body)["done"] is False
        _, sbody = _get(port, "/api/status")
        assert json.loads(sbody)["done"]["ch1-p1"]["done"] is False
    finally:
        httpd.shutdown()
