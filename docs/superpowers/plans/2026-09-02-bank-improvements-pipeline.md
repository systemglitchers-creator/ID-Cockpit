# Bank Improvements — Pipeline (Part B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every one of the 2,395 written questions a Mandell-grounded model answer and a cleaned stem, then rebuild and redeploy the bank as data.

**Architecture:** The pipeline in `RC Question Bank/` (Python, not a git repo, logged in `data/PIPELINE_LOG.md`) gains three small scripts: one that cuts all written questions into per-chapter batches with a bounded slice of Mandell text, one that validates worker results and folds them into `answers_drafted.jsonl`, and one status script that lists batches still missing so a rate-limit death loses nothing. Drafting itself is done by Claude subagents, one batch file in, one result file out, under a single prompt kept in the repo. `build_bundle.py` then writes cleaned wording into the existing `question`/`parts` fields (raw wording preserved alongside) and asserts full coverage before it will emit. The app needs one small change: render the new `cohort_conflict` note.

**Tech Stack:** Python 3.9 (`json`, `re`, `pathlib`; `pytest` 8 for tests), Claude subagents via the Agent tool for drafting, `node --test` for the one app change, Vercel for the data deploy.

**Spec:** `docs/superpowers/specs/2026-09-01-bank-improvements-design.md`, Part B (B1–B6). Part A shipped on `main` (commits `afb673f`…`2387886`); this plan assumes it.

**Paths**
```
APP  = /Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/ID Platform
PIPE = /Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank
```
`$PIPE` is not under git: every task ends by appending a dated entry to `$PIPE/data/PIPELINE_LOG.md` instead of committing. Only `$APP` changes are committed. Google Drive is slow for many small writes (the last bundle rebuild took 12 minutes); expect that.

**Read first:** `$PIPE/data/PIPELINE_LOG.md` from the heading "MAJOR CORRECTION" to the end (it explains why page ranges come from `chapter_title_match.json`, never from `chapters.json`), `$PIPE/scripts/build_bundle.py`, `$PIPE/scripts/extract_mandell.py`, one file each from `$PIPE/data/draft_batches/` and `$PIPE/data/draft_results/` (the previous run's formats), and the `id-cockpit` skill at `~/.claude/skills/id-cockpit/SKILL.md`.

---

## Data you will work with

`$PIPE/data/questions_mapped.jsonl` — one line per canonical question (2,837; 2,395 written):
```json
{"cqid":"Q0419","kind":"written","question":"19. A patient presents with …","parts":[{"text":"What is the pathogenesis of this infection (1.5)","marks":1.5}],
 "cohort_answer":{"text":"…","source":"AB 2018 (answer slide)"} | null,
 "chapters":["Chapter 101","Chapter 82"],"primary_chapter":"Chapter 101","recurrence":["AB 2018","MB 2018"],"appearances":[…]}
```
`$PIPE/data/chapters.json` — `{"chapter":"Chapter 20","id":"ch20","title":…,"sector":…,"weeks":[1],"ps":263,"pe":278}`; catch-alls have `weeks: []` and no `ps`/`pe`. **Ignore `ps`/`pe` here — they are the schedule's numbers and are wrong for this PDF.**
`$PIPE/data/chapter_title_match.json` — `{"Chapter 20": {"book_num":20,"book_title":…,"ps":253,"pe":267,"score":100.0,"tier":"good"|"weak"|"bad"}}`; these `ps`/`pe` are the BOOK's page numbers and are the only citable range.
`$PIPE/data/mandell_pages/<id>.txt` — extracted chapter text for 208 chapters (keyed by `chapters.json` `id`); 53 of them exceed 120 KB, the largest is 351 KB. Chapters with no file (catch-alls and the 33 weak/bad matches) must be drafted without a citation.
Previous run's formats (keep them): batch `{"chapter","title","book_chapter","cite_pages","pagefile","questions":[{"cqid","question","parts"}]}`; result `{"answers":[{"cqid","model_answer","cites","beyond_mandell"}]}`.

## File map

| File | Change | Responsibility |
|---|---|---|
| `$PIPE/scripts/make_draft_batches.py` | create | all written questions → `data/draft2/batches/b###.json` + bounded context text |
| `$PIPE/scripts/draft_status.py` | create | which batches lack a valid result → `data/draft2/missing.txt` |
| `$PIPE/scripts/validate_drafts.py` | create | schema/consistency checks on results → `data/answers_drafted.jsonl`, rejects listed |
| `$PIPE/docs/draft-prompt.md` | create | the one worker prompt |
| `$PIPE/scripts/build_bundle.py` | modify | cleaned wording into `question`/`parts`, raw preserved, `cohort_conflict`, assertions |
| `$PIPE/tests/test_draft_batches.py`, `test_validate_drafts.py`, `test_bundle.py` | create | pytest |
| `$APP/public/app.js`, `public/index.html`, `public/sw.js` | modify | render `cohort_conflict`; CACHE v24 |
| `$APP/tests/js/bank-view.test.mjs` | modify | one test |
| `$APP/public/qbank/*.json` | regenerate | data |

Run pipeline tests with `cd "$PIPE" && python3 -m pytest -q tests`. They are green now (2 tests).

---

### Task 1: `make_draft_batches.py` — every written question, once, with bounded context

**Files:**
- Create: `$PIPE/scripts/make_draft_batches.py`
- Test: `$PIPE/tests/test_draft_batches.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_draft_batches.py
import json, os, subprocess, sys
from pathlib import Path
PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")
sys.path.insert(0, str(PIPE / "scripts"))
import make_draft_batches as mdb   # noqa: E402

def test_pick_context_keeps_small_files_whole(tmp_path):
    f = tmp_path / "small.txt"; f.write_text("alpha beta gamma " * 100)
    text, note = mdb.pick_context(f, ["alpha"], limit=120_000)
    assert text == f.read_text() and note == "whole"

def test_pick_context_slices_big_files_by_keyword(tmp_path):
    filler = ("lorem ipsum dolor sit amet. " * 2500)          # ~70 KB per block
    hit = "Endocarditis prophylaxis is recommended for prosthetic valves. " * 400
    f = tmp_path / "big.txt"; f.write_text(filler + "\n\n" + hit + "\n\n" + filler)
    text, note = mdb.pick_context(f, ["endocarditis", "prosthetic"], limit=120_000)
    assert len(text.encode()) <= 130_000
    assert "prosthetic valves" in text
    assert note.startswith("sliced")

def test_keywords_come_from_stems_and_parts():
    q = {"question": "A 24-year-old with bloody diarrhea.", "parts": [{"text": "Name three risk factors for HUS (1.5)", "marks": 1.5}]}
    kw = mdb.keywords([q])
    assert "diarrhea" in kw and "factors" in kw and "hus" not in kw   # <4 chars dropped
    assert "with" not in kw                                            # stopword

def test_batches_cover_every_written_question_exactly_once(tmp_path):
    out = tmp_path / "draft2"
    mdb.main(out_dir=out, limit=12)
    batches = sorted(out.glob("batches/b*.json"))
    seen = {}
    for b in batches:
        d = json.load(open(b))
        assert 1 <= len(d["questions"]) <= 12
        assert d["contextfile"] is None or os.path.getsize(d["contextfile"]) <= 130_000
        for q in d["questions"]:
            assert q["cqid"] not in seen, "duplicate placement"
            seen[q["cqid"]] = b.name
            assert "cohort_answer" in q and "parts" in q
    written = [json.loads(l)["cqid"] for l in open(PIPE / "data/questions_mapped.jsonl") if json.loads(l)["kind"] == "written"]
    assert set(seen) == set(written) and len(written) == 2395
    ch = json.load(open(out / "chunking.json"))
    assert len(ch) == len(batches)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd "$PIPE" && python3 -m pytest -q tests/test_draft_batches.py`
Expected: `ModuleNotFoundError: No module named 'make_draft_batches'`.

- [ ] **Step 3: Write the script**

```python
#!/usr/bin/env python3
"""Cut every WRITTEN question into per-chapter batches for drafting.

Groups by primary_chapter, at most `limit` questions per batch. Each batch names
a bounded context file: the chapter's Mandell text whole when it is small, or
the keyword-best slices of it when it is large, so a worker never receives more
than ~120 KB. Citable page range comes from chapter_title_match.json (the BOOK's
pages), never from chapters.json. Chapters with no page text or a bad title
match get contextfile=null and cite_pages=null: the worker then drafts from
established knowledge and must leave cites null.
"""
import json, re, sys
from collections import defaultdict
from pathlib import Path

PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")
STOP = set("""a an the and or of to in on for with from by at as is are was were be been that this these those what
which who whom whose how why when where name list give describe explain outline state three four five two one
each other than into over under about between would could should does did has have had not its their there""".split())

def keywords(questions):
    words = set()
    for q in questions:
        blob = (q.get("question") or "") + " " + " ".join(p.get("text") or "" for p in q.get("parts") or [])
        for w in re.findall(r"[a-z][a-z\-]{3,}", blob.lower()):
            if w not in STOP: words.add(w)
    return words

def pick_context(pagefile, kws, limit=120_000):
    """Return (text, note). Whole file when it fits; else the intro plus the
    best-scoring ~50 KB slices by distinct keyword hits, in book order."""
    text = Path(pagefile).read_text()
    if len(text.encode()) <= limit:
        return text, "whole"
    paras = re.split(r"\n\s*\n", text)
    slices, cur = [], ""
    for p in paras:
        if len(cur) + len(p) > 50_000 and cur:
            slices.append(cur); cur = ""
        cur += p + "\n\n"
    if cur: slices.append(cur)
    scored = []
    for i, s in enumerate(slices):
        low = s.lower()
        scored.append((sum(1 for k in kws if k in low), -i, i))
    scored.sort(reverse=True)
    keep = {0}                                   # the chapter opening always rides along
    budget = limit - len(slices[0].encode())
    for _, _, i in scored:
        if i in keep: continue
        n = len(slices[i].encode())
        if n <= budget: keep.add(i); budget -= n
        if budget < 10_000: break
    chosen = [slices[i] for i in sorted(keep)]
    return "\n\n[…]\n\n".join(chosen), f"sliced {len(keep)}/{len(slices)}"

def main(out_dir=PIPE / "data/draft2", limit=12):
    out_dir = Path(out_dir)
    (out_dir / "batches").mkdir(parents=True, exist_ok=True)
    (out_dir / "context").mkdir(parents=True, exist_ok=True)
    chapters = {c["chapter"]: c for c in json.load(open(PIPE / "data/chapters.json"))}
    match = json.load(open(PIPE / "data/chapter_title_match.json"))
    rows = [json.loads(l) for l in open(PIPE / "data/questions_mapped.jsonl")]
    by_ch = defaultdict(list)
    for q in rows:
        if q["kind"] == "written": by_ch[q["primary_chapter"]].append(q)
    n, chunking = 0, {}
    for ch in sorted(by_ch, key=lambda c: (chapters[c]["weeks"] or [999])[0]):
        meta, m = chapters[ch], match.get(ch)
        pagefile = PIPE / "data/mandell_pages" / (meta["id"] + ".txt")
        citable = bool(m) and m.get("tier") in ("good", "weak") and pagefile.exists()
        qs = by_ch[ch]
        for start in range(0, len(qs), limit):
            group = qs[start:start + limit]
            name = f"b{n:03d}"
            contextfile = None
            note = "no page text"
            if citable:
                text, note = pick_context(pagefile, keywords(group))
                cf = out_dir / "context" / (name + ".txt"); cf.write_text(text)
                contextfile = str(cf)
            batch = {"batch": name, "chapter": ch, "title": meta["title"],
                     "book_chapter": (m or {}).get("book_num") if citable else None,
                     "cite_pages": f'{m["ps"]}-{m["pe"]}' if citable else None,
                     "contextfile": contextfile,
                     "questions": [{"cqid": q["cqid"], "question": q["question"], "parts": q["parts"],
                                    "cohort_answer": q.get("cohort_answer")} for q in group]}
            (out_dir / "batches" / (name + ".json")).write_text(json.dumps(batch, ensure_ascii=False, indent=1))
            chunking[name] = {"chapter": ch, "context": note, "questions": len(group)}
            n += 1
    (out_dir / "chunking.json").write_text(json.dumps(chunking, indent=1))
    print(f"{n} batches, {sum(len(v) for v in by_ch.values())} written questions, "
          f"{sum(1 for c in chunking.values() if c['context'] == 'no page text')} batches without page text")
    return n

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests, then the script for real**

Run: `python3 -m pytest -q tests/test_draft_batches.py` — 4 passed (the coverage test writes to a temp dir and takes ~1 min on Drive).
Run: `python3 scripts/make_draft_batches.py` — expected roughly `~250 batches, 2395 written questions, ~40 batches without page text`. Record the exact numbers.

- [ ] **Step 5: Log**

Append to `$PIPE/data/PIPELINE_LOG.md`:
```
## 2026-09-02 — Part B Task 1: draft batches for every written question

scripts/make_draft_batches.py -> data/draft2/batches/b###.json (+ data/draft2/context/, chunking.json).
<N> batches of <=12 over 2,395 written questions grouped by primary chapter; <K> batches have no
page text (catch-alls and weak/bad title matches) and must be drafted without citations. Files over
120 KB are sliced to the chapter opening plus the best keyword slices (see chunking.json).
Previous run's data/draft_batches and data/draft_results are left untouched for reference.
```

---

### Task 2: `validate_drafts.py` and `draft_status.py` — nothing enters the bundle unchecked

**Files:**
- Create: `$PIPE/scripts/validate_drafts.py`, `$PIPE/scripts/draft_status.py`
- Test: `$PIPE/tests/test_validate_drafts.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_validate_drafts.py
import json, sys
from pathlib import Path
PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")
sys.path.insert(0, str(PIPE / "scripts"))
import validate_drafts as vd   # noqa: E402

BATCH = {"batch": "b000", "chapter": "Chapter 101", "title": "Acute Dysentery", "cite_pages": "1240-1252",
         "contextfile": "x", "questions": [
            {"cqid": "Q1", "question": "19. A patient with bloody diarrhea.", "parts": [{"text": "Pathogenesis (1.5)", "marks": 1.5}, {"text": "Three HUS risk factors (1.5)", "marks": 1.5}], "cohort_answer": None},
            {"cqid": "Q2", "question": "HPV", "parts": [{"text": "Two serotypes", "marks": None}], "cohort_answer": {"text": "16, 18", "source": "H"}}]}

def good():
    return {"answers": [
        {"cqid": "Q1", "question_clean": "A patient presents with bloody diarrhea.", "parts_clean": ["What is the pathogenesis?", "Name three risk factors for HUS."],
         "model_answer": "a) …\nb) …", "cites": "Mandell pp. 1246–1249", "beyond_mandell": None, "uncertain": False, "cohort_conflict": None},
        {"cqid": "Q2", "question_clean": "Human papillomavirus and malignancy.", "parts_clean": ["Which two serotypes cause most malignancies?"],
         "model_answer": "16 and 18.", "cites": "Mandell pp. 1250-1251", "beyond_mandell": None, "uncertain": False, "cohort_conflict": None}]}

def test_good_result_passes():
    assert vd.check(BATCH, good()) == []

def test_missing_cqid_fails():
    r = good(); r["answers"].pop()
    assert any("Q2" in e for e in vd.check(BATCH, r))

def test_parts_length_mismatch_fails():
    r = good(); r["answers"][0]["parts_clean"] = ["only one"]
    assert any("parts_clean" in e for e in vd.check(BATCH, r))

def test_numbering_left_in_stem_fails():
    r = good(); r["answers"][0]["question_clean"] = "19. A patient presents"
    assert any("numbering" in e for e in vd.check(BATCH, r))

def test_cite_outside_chapter_range_fails():
    r = good(); r["answers"][0]["cites"] = "Mandell pp. 900-905"
    assert any("cites" in e for e in vd.check(BATCH, r))

def test_cite_without_page_text_fails():
    b = dict(BATCH, cite_pages=None, contextfile=None)
    assert any("cites" in e for e in vd.check(b, good()))
    r = good()
    for a in r["answers"]: a["cites"] = None
    assert vd.check(b, r) == []

def test_merge_writes_one_line_per_cqid(tmp_path):
    (tmp_path / "batches").mkdir(); (tmp_path / "results").mkdir()
    (tmp_path / "batches/b000.json").write_text(json.dumps(BATCH))
    (tmp_path / "results/b000.json").write_text(json.dumps(good()))
    out = tmp_path / "answers_drafted.jsonl"
    ok, bad = vd.merge(tmp_path, out)
    assert ok == ["b000"] and bad == {}
    lines = [json.loads(l) for l in open(out)]
    assert [l["cqid"] for l in lines] == ["Q1", "Q2"] and lines[0]["chapter"] == "Chapter 101"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest -q tests/test_validate_drafts.py` — `ModuleNotFoundError`.

- [ ] **Step 3: Write `validate_drafts.py`**

```python
#!/usr/bin/env python3
"""Check worker results against their batches and fold the good ones into
data/answers_drafted.jsonl. A batch with any error is rejected whole, listed in
data/draft2/rejected.json, and left for draft_status.py to re-queue."""
import json, re, sys
from pathlib import Path

PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")
CITE = re.compile(r"^Mandell pp\. (\d+)\s*[-–]\s*(\d+)$")
NUMBERED = re.compile(r"^\s*(\d+|[a-zA-Z]|[ivx]+)[.)]\s")

def check(batch, result):
    errs, byq = [], {}
    for a in (result or {}).get("answers", []):
        if not isinstance(a, dict) or "cqid" not in a: errs.append("answer without cqid"); continue
        byq[a["cqid"]] = a
    lo = hi = None
    if batch.get("cite_pages"):
        lo, hi = (int(x) for x in batch["cite_pages"].split("-"))
    for q in batch["questions"]:
        a = byq.get(q["cqid"])
        if not a: errs.append(f'{q["cqid"]}: missing'); continue
        qc = (a.get("question_clean") or "").strip()
        if not qc: errs.append(f'{q["cqid"]}: question_clean empty')
        if NUMBERED.match(qc): errs.append(f'{q["cqid"]}: numbering left in question_clean')
        pc = a.get("parts_clean")
        if not isinstance(pc, list) or len(pc) != len(q["parts"]):
            errs.append(f'{q["cqid"]}: parts_clean length {len(pc) if isinstance(pc, list) else "?"} != {len(q["parts"])}')
        elif any(not str(p).strip() for p in pc):
            errs.append(f'{q["cqid"]}: empty part in parts_clean')
        if not (a.get("model_answer") or "").strip(): errs.append(f'{q["cqid"]}: model_answer empty')
        c = a.get("cites")
        if c is not None:
            m = CITE.match(str(c).strip())
            if lo is None: errs.append(f'{q["cqid"]}: cites given but the batch has no page text')
            elif not m: errs.append(f'{q["cqid"]}: cites not "Mandell pp. A–B"')
            else:
                p1, p2 = int(m.group(1)), int(m.group(2))
                if p1 < lo - 2 or p2 > hi + 2 or p2 < p1: errs.append(f'{q["cqid"]}: cites {p1}-{p2} outside {lo}-{hi}')
        for k in ("beyond_mandell", "cohort_conflict"):
            if a.get(k) is not None and not isinstance(a[k], str): errs.append(f'{q["cqid"]}: {k} must be a string or null')
        if not isinstance(a.get("uncertain", False), bool): errs.append(f'{q["cqid"]}: uncertain must be boolean')
    extra = set(byq) - {q["cqid"] for q in batch["questions"]}
    if extra: errs.append(f"answers for unknown cqids: {sorted(extra)}")
    return errs

def merge(root, out):
    root = Path(root); ok, bad, lines = [], {}, []
    for bf in sorted((root / "batches").glob("b*.json")):
        batch = json.load(open(bf)); rf = root / "results" / bf.name
        if not rf.exists(): continue
        try: result = json.load(open(rf))
        except Exception as e: bad[bf.stem] = [f"unreadable result: {e}"]; continue
        errs = check(batch, result)
        if errs: bad[bf.stem] = errs; continue
        byq = {a["cqid"]: a for a in result["answers"]}
        for q in batch["questions"]:
            a = byq[q["cqid"]]
            lines.append({"cqid": q["cqid"], "chapter": batch["chapter"], "batch": bf.stem,
                          "question_clean": a["question_clean"].strip(), "parts_clean": [str(p).strip() for p in a["parts_clean"]],
                          "model_answer": a["model_answer"].strip(), "cites": a.get("cites"),
                          "beyond_mandell": a.get("beyond_mandell"), "uncertain": bool(a.get("uncertain", False)),
                          "cohort_conflict": a.get("cohort_conflict")})
        ok.append(bf.stem)
    Path(out).write_text("".join(json.dumps(l, ensure_ascii=False) + "\n" for l in lines))
    (root / "rejected.json").write_text(json.dumps(bad, indent=1))
    return ok, bad

if __name__ == "__main__":
    ok, bad = merge(PIPE / "data/draft2", PIPE / "data/answers_drafted.jsonl")
    print(f"accepted {len(ok)} batches, rejected {len(bad)}; see data/draft2/rejected.json")
    for b, errs in list(bad.items())[:20]: print(" ", b, errs[:3])
```

- [ ] **Step 4: Write `draft_status.py`**

```python
#!/usr/bin/env python3
"""List batches that still need a worker: no result file, or a rejected one.
Writes data/draft2/missing.txt (one batch name per line) and prints a summary."""
import json
from pathlib import Path
PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")
root = PIPE / "data/draft2"
batches = sorted(p.stem for p in (root / "batches").glob("b*.json"))
rejected = json.load(open(root / "rejected.json")) if (root / "rejected.json").exists() else {}
missing = [b for b in batches if not (root / "results" / (b + ".json")).exists() or b in rejected]
(root / "missing.txt").write_text("\n".join(missing) + ("\n" if missing else ""))
print(f"{len(batches)} batches | {len(batches) - len(missing)} done | {len(missing)} to do ({len(rejected)} rejected)")
```

- [ ] **Step 5: Run the tests**

Run: `python3 -m pytest -q tests/test_validate_drafts.py` — 7 passed. Then `python3 scripts/draft_status.py` — prints `<N> batches | 0 done | <N> to do (0 rejected)`.

- [ ] **Step 6: Log**

Append to `PIPELINE_LOG.md`:
```
## 2026-09-02 — Part B Task 2: result validation and status

scripts/validate_drafts.py checks every result against its batch (all cqids answered, parts_clean
aligned, no numbering in the cleaned stem, cites only when page text was supplied and only inside the
chapter's book page range ±2) and writes data/answers_drafted.jsonl; rejected batches go to
data/draft2/rejected.json. scripts/draft_status.py writes data/draft2/missing.txt for the next run.
```

---

### Task 3: The worker prompt

**Files:**
- Create: `$PIPE/docs/draft-prompt.md`

- [ ] **Step 1: Write the prompt file** (this exact text; the controller substitutes the three placeholders)

````markdown
You are writing Royal College Infectious Diseases exam answers for a fellow who has just read
Mandell 9e {CHAPTER} — {TITLE}. Work on exactly one batch file and write exactly one result file.

Batch file (read it): {BATCH_PATH}
Chapter text (read it if the batch's "contextfile" is not null): the path in the batch's "contextfile"
Result file (write it): {RESULT_PATH}

The batch's "cite_pages" is the book page range of that text (e.g. "1240-1252"). When "contextfile"
is null there is NO source text: answer from established knowledge and set "cites": null for every
question — never invent a page number.

For each question in the batch produce one object:

{"cqid": "...",
 "question_clean": "...",          // the stem, cleaned (rules below)
 "parts_clean": ["...", "..."],     // one per part, same order and COUNT as the batch's parts
 "model_answer": "...",            // exam-style, mirrors the marks (rules below)
 "cites": "Mandell pp. 1246–1249" or null,
 "beyond_mandell": "..." or null,
 "uncertain": false,
 "cohort_conflict": "..." or null}

Cleaning rules:
- Drop leading exam numbering ("19.", "8)") and part labels ("A)", "b.", "ii."). Keep every clinical
  detail and every requested count ("three", "4"). Keep the mark allocation OUT of the text — it is a
  separate field. A bare topic ("HPV", "Enterococcus IE") becomes one short prompt sentence
  ("Human papillomavirus and its associated malignancies."). Do not change the meaning, do not add
  facts to the question, do not merge or split parts.

Answer rules:
- Mirror the mark allocation: a part worth 1.5 asking for three items gets exactly three numbered
  points "(1) … (2) … (3) …"; a 0.5 part gets one crisp line. Label parts "a)", "b)" to match.
- Ground every point in the chapter text when you have it, and cite as "Mandell pp. A–B" using
  BOOK page numbers inside "cite_pages". Never cite outside that range. Never cite without text.
- If the text cannot fully answer a part (newer guideline, a CLSI value, another chapter's content),
  answer what Mandell supports, then put ONE short note in "beyond_mandell" naming the source
  ("IDSA candidiasis 2016: …"). Prefer leaving it null.
- "uncertain": true only when you could not ground the core of the answer.
- If the batch supplies a "cohort_answer" and it substantively disagrees with what the text
  supports, resolve against the text and put one sentence in "cohort_conflict"
  ("Cohort answer lists X; Mandell pp. Y supports Z"). Leave it null when they agree or the cohort
  answer merely says less.
- Be terse. No preamble, no restating the question, no padding.

Write {RESULT_PATH} as {"answers": [ ...one object per question, in batch order... ]} and nothing
else. Do not delegate to other agents. Do not edit any other file. When done, reply with the batch
name, the number of answers written, how many carry cites, and anything you could not ground.
````

- [ ] **Step 2: Log** one line in `PIPELINE_LOG.md`: `Part B Task 3: worker prompt at docs/draft-prompt.md (single prompt for every batch).`

---

### Task 4: Quality checkpoint — three chapters, three answers for Tyler

**This task ends with a STOP.** Mass production (Task 5) does not start until Tyler says go.

- [ ] **Step 1: Pick the three batches**

From `data/draft2/chunking.json` choose: one high-yield chapter with page text (Chapter 82 Endocarditis or Chapter 130 HIV), one niche chapter with page text (e.g. Chapter 177 Enteroviruses), and one catch-all (`CATCHALL-LAB`, no page text). Note the batch names.

- [ ] **Step 2: Dispatch three workers**

For each batch, dispatch one general-purpose subagent (model: the most capable available) with the prompt from `docs/draft-prompt.md`, substituting `{CHAPTER}`, `{TITLE}`, `{BATCH_PATH}` = `$PIPE/data/draft2/batches/<b>.json`, `{RESULT_PATH}` = `$PIPE/data/draft2/results/<b>.json` (create the `results` directory first). Run them in parallel; they touch disjoint files.

- [ ] **Step 3: Validate**

Run: `python3 scripts/validate_drafts.py` — expected `accepted 3 batches, rejected 0`. If a batch is rejected, read `rejected.json`, re-dispatch that batch with the error list appended to the prompt ("Your previous result was rejected because: …"), and validate again.

- [ ] **Step 4: Show Tyler three answers**

Write `$PIPE/data/draft2/checkpoint.md` with, for one question from each batch: the raw stem and parts, the cleaned stem and parts, the model answer with its cite, the cohort answer if any, and `cohort_conflict`. Send it with `SendUserFile`. Ask, in one line, whether to start mass production, and STOP.

- [ ] **Step 5: Log** the checkpoint in `PIPELINE_LOG.md` with the three batch names and Tyler's verdict once given.

---

### Task 5: Mass production — resumable, four workers at a time

- [ ] **Step 1: Queue**

Run: `python3 scripts/draft_status.py` — `missing.txt` lists every batch except the three from Task 4.

- [ ] **Step 2: Run the loop**

Repeat until `missing.txt` is empty:
1. Take the next four names from `missing.txt`.
2. Dispatch four workers as in Task 4 Step 2 (one batch each, in parallel, delegation forbidden).
3. When all four report, run `python3 scripts/validate_drafts.py && python3 scripts/draft_status.py`.
4. A rejected batch is re-dispatched once with its error list appended; if it is rejected twice, record it in `PIPELINE_LOG.md` and continue — do not loop on it.

Rate limits will kill workers mid-run. That is expected: a worker that died leaves no result file, so `draft_status.py` simply lists it again. Never hand-edit a result file to "fix" it; re-dispatch.

- [ ] **Step 3: Coverage check**

Run: `python3 -c "import json; print(len({json.loads(l)['cqid'] for l in open('data/answers_drafted.jsonl')}))"` — expected `2395`. Then sample 10 answers across 5 chapters, compare each with its cohort answer where present, and record the sample in `PIPELINE_LOG.md` (cqid, verdict, one line).

- [ ] **Step 4: Log** totals: batches run, rejected-twice list (should be empty), answers with cites vs without, `uncertain` count, `cohort_conflict` count.

---

### Task 6: `build_bundle.py` — cleaned wording in, raw preserved, coverage asserted

**Files:**
- Modify: `$PIPE/scripts/build_bundle.py`
- Test: `$PIPE/tests/test_bundle.py`

- [ ] **Step 1: Write the failing test** (runs the builder against a temp copy of the app's qbank dir; it takes ~1 min)

```python
# tests/test_bundle.py
import json, re, subprocess, sys
from pathlib import Path
PIPE = Path("/Users/tylermacdonald/Library/CloudStorage/GoogleDrive-dalhousie2023@gmail.com/My Drive/8. Claude/RC Question Bank")

def test_bundle_has_cleaned_wording_and_full_answer_coverage(tmp_path):
    env = {"QB_OUT": str(tmp_path)}
    r = subprocess.run([sys.executable, str(PIPE / "scripts/build_bundle.py")], env={**__import__("os").environ, **env}, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    index = json.load(open(tmp_path / "index.json"))["chapters"]
    n, raw_kept = 0, 0
    for c in index:
        for q in json.load(open(tmp_path / (c["id"] + ".json")))["questions"]:
            n += 1
            if q["kind"] != "written": continue
            assert q["model_answer"], q["cqid"]
            assert not re.match(r"^\s*\d+[.)]\s", q["question"]), q["cqid"]
            assert len(q["parts"]) == len(q["parts_raw"]), q["cqid"]
            assert "question_raw" in q and "cohort_conflict" in q
            if q["question_raw"] != q["question"]: raw_kept += 1
    assert n == 4034 and raw_kept > 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest -q tests/test_bundle.py` — fails: the builder ignores `QB_OUT` and written questions lack `question_raw`.

- [ ] **Step 3: Change `build_bundle.py`**

Replace the header block
```python
QB = DRIVE / "8. Claude/ID Platform/public/qbank"
QB.mkdir(parents=True, exist_ok=True)

chapters = {c["chapter"]: c for c in json.load(open(PIPE / "data/chapters.json"))}
drafted = {}
for f in glob.glob(str(PIPE / "data/draft_results/*.json")):
    try:
        for a in json.load(open(f))["answers"]:
            drafted[a["cqid"]] = a
    except Exception as e:
        print("  bad draft file", os.path.basename(f), str(e)[:60])
```
with
```python
QB = Path(os.environ.get("QB_OUT") or (DRIVE / "8. Claude/ID Platform/public/qbank"))
QB.mkdir(parents=True, exist_ok=True)

chapters = {c["chapter"]: c for c in json.load(open(PIPE / "data/chapters.json"))}
# Part B: every written question has a validated draft in answers_drafted.jsonl
# (validate_drafts.py wrote it). The old draft_results/ are no longer read.
drafted = {}
for line in open(PIPE / "data/answers_drafted.jsonl"):
    a = json.loads(line); drafted[a["cqid"]] = a

def strip_numbering(t):
    return re.sub(r"^\s*\d+[.)]\s*", "", t or "")
```
and add `import re` to the imports. Replace the written-record block
```python
            d = drafted.get(q["cqid"])
            co = q.get("cohort_answer")
            rec.update({"question": q["question"], "parts": q.get("parts") or [],
                        "model_answer": (d or {}).get("model_answer"),
                        "cites": (d or {}).get("cites"),
                        "beyond_mandell": (d or {}).get("beyond_mandell"),
                        "uncertain": bool((d or {}).get("uncertain")),
                        "cohort_answer": co,
                        "source": ", ".join(q.get("recurrence", [])[:3])})
            if not rec["model_answer"] and not co:
                no_answer += 1
```
with
```python
            d = drafted.get(q["cqid"])
            if not d:
                missing_draft.append(q["cqid"]); d = {}
            co = q.get("cohort_answer")
            raw_parts = q.get("parts") or []
            clean_parts = d.get("parts_clean") if d.get("parts_clean") and len(d["parts_clean"]) == len(raw_parts) else None
            rec.update({"question": (d.get("question_clean") or strip_numbering(q["question"])).strip(),
                        "question_raw": q["question"],
                        "parts": [{"text": (clean_parts[i] if clean_parts else p["text"]), "marks": p.get("marks")}
                                  for i, p in enumerate(raw_parts)],
                        "parts_raw": raw_parts,
                        "model_answer": d.get("model_answer"),
                        "cites": d.get("cites"),
                        "beyond_mandell": d.get("beyond_mandell"),
                        "uncertain": bool(d.get("uncertain")),
                        "cohort_conflict": d.get("cohort_conflict"),
                        "cohort_answer": co,
                        "source": ", ".join(q.get("recurrence", [])[:3])})
            if not rec["model_answer"] and not co:
                no_answer += 1
```
Add `missing_draft = []` next to `index, no_answer = [], 0`. Before the `index.sort(...)` line add the gate:
```python
if missing_draft:
    print(f"REFUSING to write index.json: {len(missing_draft)} written questions have no validated draft, e.g. {missing_draft[:5]}")
    sys.exit(1)
```
(add `import sys`). Chapter files are written inside the loop before the gate; that is acceptable because the index is what the app trusts, but say so in the log. Extend the final prints with `print(f'written questions without a draft: {len(missing_draft)}')`.

- [ ] **Step 4: Run the test and the pipeline suite**

Run: `python3 -m pytest -q tests` — all passed (only once Task 5 has produced full coverage; before that, `test_bundle` fails on the gate, which is correct).

- [ ] **Step 5: Log** in `PIPELINE_LOG.md`: what changed in the builder, the QB_OUT override, the gate.

---

### Task 7: The app shows `cohort_conflict`; cache bump

**Files:**
- Modify: `$APP/public/app.js` (`answerBlock`), `$APP/public/index.html` (one CSS rule), `$APP/public/sw.js:2`
- Test: `$APP/tests/js/bank-view.test.mjs`

- [ ] **Step 1: Write the failing test** (append; the file's `CHAPTER` fixture and helpers exist)

```js
test("reveal shows a cohort conflict note under the model answer", async () => {
  const ch = JSON.parse(JSON.stringify(CHAPTER));
  ch.questions[1].cohort_conflict = "Cohort answer lists 16 and 31; Mandell pp. 1–2 supports 16 and 18.";
  const fetch = async (url, init) => url === "qbank/ch101.json"
    ? { ok: true, status: 200, json: async () => ch } : fetchFor({ W1: { result: "got", ts: 1 } })(url, init);
  const app = loadCurrentApp({ now: NOW, fetch });
  await tick(); await tick();
  await openChapter(app);                         // W2 has a model answer and a cohort answer
  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankReveal();
  assert.match(app._elements.get("bkrev").innerHTML, /class="bkconflict">.*Mandell pp\. 1–2 supports 16 and 18/);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/js/bank-view.test.mjs`: no `bkconflict`.

- [ ] **Step 3: Implement**

In `answerBlock`, after the `Prior cohort answer` line add:
```js
    if (q.cohort_conflict) h += '<div class="bkconflict"><b>NB.</b> ' + esc(q.cohort_conflict) + "</div>";
```
In the Bank CSS block add:
```css
.bkconflict{margin-top:9px;font-size:12px;line-height:1.45;color:var(--behind);font-weight:600}
```
In `public/sw.js` change `idcockpit-web-v23` to `idcockpit-web-v24`, and update the `>= 23` assertion in `tests/js/sw.test.mjs` to `>= 24`.

- [ ] **Step 4: Run `npm test`** — all green (202). Commit:
```bash
git add public/app.js public/index.html public/sw.js tests/js/bank-view.test.mjs tests/js/sw.test.mjs
git commit -m "feat: reveal shows the cohort-conflict note; cache v24 for the redrafted bank

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rebuild the bundle and deploy the data

- [ ] **Step 1: Rebuild** — `cd "$PIPE" && python3 scripts/build_bundle.py` (12 minutes on Drive). Expected: `276 chapters, 4034 placements`, `written questions without a draft: 0`, and the index written.

- [ ] **Step 2: Check the diff in the app repo**

```bash
cd "$APP" && git status --short public/qbank | wc -l          # 277 expected: every chapter file plus index
node --test tests/js/bank-index.test.mjs                        # must still pass: placements unchanged
npm test 2>&1 | tail -3
python3 - <<'EOF'
import json,glob,re
n=m=r=0
for f in glob.glob("public/qbank/ch*.json")+glob.glob("public/qbank/catchall-*.json"):
    for q in json.load(open(f))["questions"]:
        if q["kind"]!="written": continue
        n+=1; m+=bool(q["model_answer"]); r+=bool(re.match(r"^\s*\d+[.)]\s", q["question"]))
print("written placements", n, "with model answer", m, "still numbered", r)
EOF
```
Expected: `3498 3498 0`.

- [ ] **Step 3: Commit and push**

```bash
git add public/qbank
git commit -m "data: every written question carries a Mandell-drafted answer and a cleaned stem

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```
If the push fails with `could not read Username`, stop and tell Tyler to push from a terminal.

- [ ] **Step 4: Verify after the push**

```bash
sleep 90
curl -s https://id-cockpit.vercel.app/sw.js | grep -o 'idcockpit-web-v[0-9]*'      # v24
curl -s https://id-cockpit.vercel.app/qbank/ch101.json | python3 -c "import json,sys; q=[x for x in json.load(sys.stdin)['questions'] if x['cqid']=='Q0419'][0]; print(q['question'][:60], '|', bool(q['model_answer']))"
```
Expected: the stem without "19." and `True`. Tell Tyler to open the app on wifi once.

- [ ] **Step 5: Log** the deploy in `PIPELINE_LOG.md` with the commit SHA and the verification output.

---

## Self-review against spec Part B

- **B1 scope (all 2,395 written, MCQs skipped)** → Task 1 groups only `kind == "written"`; Task 5 asserts 2,395 distinct cqids.
- **B2 batching** (by primary chapter, ≤12, corrected page text, no invented pages, chunking >120 KB by keyword with the decision logged, old results re-drafted, resumable via missing list) → Task 1 (`draft2/` is a fresh set, so the 664 old answers are re-drafted under the one prompt), Task 2 (`draft_status.py`), Task 5.
- **B3 worker output schema and prompt rules** → Task 3 prompt; Task 2 validation enforces every rule that can be checked mechanically (count alignment, numbering, cite range, cite-only-with-text).
- **B4 checkpoint before mass production; 10-sample afterwards** → Task 4 (STOP), Task 5 Step 3.
- **B5 bundle** (`question` ← clean with numbering-strip fallback, `parts[].text` ← clean, `question_raw`/`parts_raw`/`cohort_conflict`, `deferred` list kept, assertions, non-zero exit) → Task 6. The `deferred`/`marks` index keys from Part A are untouched.
- **B6 deploy** (data-only commit, CACHE bump anyway) → Tasks 7–8; the bump rides with the one app change.
- Names consistent: `data/draft2/{batches,context,results,missing.txt,rejected.json,chunking.json}`, `data/answers_drafted.jsonl`, `check(batch, result)`, `merge(root, out)`, `pick_context`, `keywords`, `QB_OUT`.
