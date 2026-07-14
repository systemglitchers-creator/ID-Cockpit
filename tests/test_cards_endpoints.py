import json, threading, time, urllib.request
import fitz
import serve


def _highlighted_pdf_bytes():
    doc = fitz.open(); page = doc.new_page()
    s = "Vancomycin inhibits bacterial cell wall synthesis."
    page.insert_text((72, 100), s, fontsize=12)
    for r in page.search_for(s):
        page.add_highlight_annot(r)
    data = doc.tobytes(); doc.close(); return data


STUB_CARDS = [{"Text": "Vanco inhibits {{c1::cell wall}} synthesis", "Extra": ""}]


def _start(base_dir):
    # base_dir doubles as the platform dir in tests (config/queue land under it)
    httpd = serve.make_server(host="127.0.0.1", port=0, base_dir=str(base_dir),
                              platform_dir=str(base_dir), draft_fn=lambda prompt: STUB_CARDS)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.05)
    return httpd, httpd.server_address[1]


def _req(port, path, data=None, method="GET", ctype="application/json"):
    url = f"http://127.0.0.1:{port}{path}"
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": ctype} if data else {})
    with urllib.request.urlopen(r) as resp:
        return resp.status, resp.read().decode()


def test_config_reports_unconfigured(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, body = _req(port, "/api/cards/config")
        assert st == 200 and json.loads(body)["configured"] is False
    finally:
        httpd.shutdown()


def test_upload_then_draft_then_list(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, body = _req(port, "/api/cards/upload?sessionId=ch29-p1&nn=29&title=Glycopeptides",
                        data=_highlighted_pdf_bytes(), method="POST", ctype="application/pdf")
        assert st == 200
        job_id = json.loads(body)["jobId"]
        drafted = False
        for _ in range(50):
            _, jb = _req(port, "/api/cards/jobs")
            if any(r["id"] == job_id and r["status"] == "drafted" for r in json.loads(jb)):
                drafted = True; break
            time.sleep(0.1)
        assert drafted, "job should reach drafted"
        _, jd = _req(port, f"/api/cards/job/{job_id}")
        assert json.loads(jd)["cards"][0]["Text"].startswith("Vanco")
    finally:
        httpd.shutdown()


def test_push_endpoint_calls_core(tmp_path, monkeypatch):
    import cards_core
    monkeypatch.setattr(cards_core, "push",
        lambda pdir, job, cards, **kw: {"anki": "ok", "detail": "added"})
    httpd, port = _start(tmp_path)
    try:
        cards_core.ensure_queue(tmp_path)
        job = cards_core.create_job(tmp_path, "29", "Glyco", [])
        cards_core.set_status(tmp_path, job, "drafted", cards=[{"Text": "a", "Extra": ""}])
        body = json.dumps({"cards": [{"Text": "a", "Extra": ""}]}).encode()
        st, resp = _req(port, f"/api/cards/job/{job['id']}/push", data=body, method="POST")
        assert st == 200 and json.loads(resp)["anki"] == "ok"
    finally:
        httpd.shutdown()
