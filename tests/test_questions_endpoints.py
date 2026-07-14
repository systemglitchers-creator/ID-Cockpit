import json, threading, time, urllib.request
import fitz, serve, cards_core


def _pdf():
    doc = fitz.open(); p = doc.new_page()
    s = "Ceftaroline has MRSA activity."
    p.insert_text((72, 100), s, fontsize=12)
    for r in p.search_for(s): p.add_highlight_annot(r)
    b = doc.tobytes(); doc.close(); return b


STUB_QS = [{"stem": "A patient with MRSA bacteremia.", "archetype": "clinical",
            "subquestions": [{"prompt": "Name 1 agent", "count": 1, "marks": 1, "answer": ["ceftaroline"]}]}]


def _start(base):
    httpd = serve.make_server(host="127.0.0.1", port=0, base_dir=str(base),
                              platform_dir=str(base),
                              draft_fn=lambda p: [{"Text": "x", "Extra": ""}],
                              q_draft_fn=lambda p: STUB_QS)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.05)
    return httpd, httpd.server_address[1]


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as r:
        return r.status, r.read().decode()


def _get_raw(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}") as r:
        return r.status, r.read()


def _post(port, path, obj=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else None)
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method="POST",
                                 headers={"Content-Type": ctype} if data else {})
    with urllib.request.urlopen(req) as r:
        return r.status, r.read().decode()


def test_precheck(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, b = _get(port, "/api/questions/precheck?nn=31&title=Foo")
        assert st == 200 and json.loads(b) == {"hasCards": False, "hasPdf": False}
    finally:
        httpd.shutdown()


def test_generate_then_save_then_export(tmp_path):
    httpd, port = _start(tmp_path)
    try:
        st, b = _post(port, "/api/questions/generate?sessionId=ch31-p1&nn=31&title=Ceftaroline",
                      raw=_pdf(), ctype="application/pdf")
        assert st == 200
        jid = json.loads(b)["jobId"]
        ok = False
        for _ in range(50):
            _, jb = _get(port, "/api/questions/jobs")
            if any(r["id"] == jid and r["status"] == "drafted" for r in json.loads(jb)):
                ok = True; break
            time.sleep(0.1)
        assert ok
        st, sv = _post(port, f"/api/questions/job/{jid}/save", obj={"questions": STUB_QS})
        assert st == 200 and json.loads(sv)["saved"] == 1
        # per-session export streams a PDF
        st, pdf = _get_raw(port, "/api/questions/export?nn=31&title=Ceftaroline&session=ch31-p1")
        assert st == 200 and pdf[:4] == b"%PDF"
        # combined chapter export also works
        st, pdf2 = _get_raw(port, "/api/questions/export?nn=31&title=Ceftaroline")
        assert st == 200 and pdf2[:4] == b"%PDF"
    finally:
        httpd.shutdown()
