import test from "node:test";
import assert from "node:assert/strict";
import { loadCurrentApp } from "./harness.mjs";

/* The Bank tab's logic, driven through the functions app.js exposes on
   window.IDCockpit. Rendering is checked as HTML strings on the fake DOM. */

const NOW = new Date(2026, 8, 1, 21, 0, 0);

const CHAPTER = {
  chapter: "Chapter 101", id: "ch101", title: "Acute Dysentery Syndromes",
  sector: "Enteric", weeks: [9], mandell: "pp. 1–2",
  questions: [
    { cqid: "W1", kind: "written", needs: [], recurrence: ["AB 2018", "MB 2018"], source: "AB 2018, MB 2018",
      question: "A patient presents with bloody diarrhea. Diagnosed with E. coli O157.",
      parts: [{ text: "What is the pathogenesis? (1.5)", marks: 1.5 }, { text: "Three risk factors for HUS (1.5)", marks: 1.5 }],
      model_answer: null, cites: null, beyond_mandell: null, uncertain: false,
      cohort_answer: { text: "Shiga toxin…", source: "AB 2018 (answer slide)" } },
    { cqid: "W2", kind: "written", needs: [], recurrence: [], source: "MB 2016",
      question: "HPV", parts: [{ text: "Two serotypes causing 70–90% of malignancies", marks: null }],
      model_answer: "16 and 18.", cites: "Mandell pp. 1–2", beyond_mandell: null, uncertain: false,
      cohort_answer: { text: "HPV 16, 18", source: "H-decks" } },
    { cqid: "M1", kind: "mcq", needs: [], recurrence: [], source: "Comprehensive Review of ID · Quiz 1 Q1",
      stem: "A 24-year-old man…", lead_in: "Best regimen?", correct: "D",
      options: [{ letter: "A", text: "x" }, { letter: "D", text: "y" }], explanation: "Because." },
    { cqid: "W3", kind: "written", needs: ["Chapter 130 — HIV"], recurrence: [], source: "MB 2013",
      question: "Deferred one", parts: [{ text: "Part", marks: 1 }],
      model_answer: null, cites: null, beyond_mandell: null, uncertain: false, cohort_answer: null }
  ]
};
const INDEX = { chapters: [{ chapter: "Chapter 101", id: "ch101", title: "Acute Dysentery Syndromes", sector: "Enteric",
  weeks: [9], n_total: 4, n_mcq: 1, n_written: 3, n_deferred: 1,
  cqids: ["W1", "W2", "M1", "W3"], deferred: ["W3"], marks: { W1: 3, W2: 1, M1: 1, W3: 1 } }] };

function fetchFor(answers = {}) {
  return async (url, init) => {
    if (url === "qbank/index.json") return { ok: true, status: 200, json: async () => INDEX };
    if (url === "qbank/ch101.json") return { ok: true, status: 200, json: async () => CHAPTER };
    if (url === "/api/answers") return { ok: true, status: 200, json: async () => ({ answers: { ...answers, ...JSON.parse(init.body).answers } }) };
    if (url === "/api/schedule") return { ok: true, status: 204, json: async () => null };
    if (url === "/api/progress") return { ok: true, status: 200, json: async () => ({ sessions: {} }) };
    throw new Error("unexpected " + url);
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function openChapter(app) {
  app.IDCockpit.bankOpen("ch101");
  await tick(); await tick();
}

test("grading writes to IDAnswers with the chosen letter and moves on", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);
  const B = app.IDCockpit.bank;
  assert.equal(B().queue.length, 3, "deferred W3 is hidden by default");
  assert.equal(B().at, 0);
  app.IDCockpit.bankGrade("got");
  assert.equal(app.IDAnswers.get().W1.result, "got");
  assert.equal(B().at, 1);
  app.IDCockpit.bankGrade("got");                       // W2
  assert.equal(B().at, 2);
  app.IDCockpit.bankPick("D"); app.IDCockpit.bankGrade("correct");   // M1
  assert.equal(app.IDAnswers.get().M1.result, "correct");
  assert.equal(app.IDAnswers.get().M1.chosen, "D");
  assert.equal(app.IDAnswers.get().W1.chosen, undefined, "written questions store no letter");
  assert.equal(B().at, 3, "past the end: the summary");
});

test("opening a chapter skips questions that already have a result but not flag-only ones", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 }, W2: { flag: true, ts: 1 } }) });
  await tick(); await tick();                     // IDAnswers.start pulls the server map
  await openChapter(app);
  assert.equal(app.IDCockpit.bank().queue[app.IDCockpit.bank().at].cqid, "W2");
});

test("flagging stores a flag without touching the result", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "partial", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);
  app.IDCockpit.bankFlag("W1");
  const rec = app.IDAnswers.get().W1;
  assert.equal(rec.flag, true);
  assert.equal(rec.result, "partial");
  app.IDCockpit.bankFlag("W1");
  assert.equal(app.IDAnswers.get().W1.flag, false);
});

test("review misses re-queues without deleting grades; regrading writes a newer ts", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "missed", ts: 1 }, W2: { result: "got", ts: 1 }, M1: { result: "incorrect", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);
  assert.equal(app.IDCockpit.bank().at, 3, "everything graded lands on the summary");
  app.IDCockpit.bankReviewMisses();
  const b = app.IDCockpit.bank();
  assert.deepEqual(Array.from(b.queue.map((q) => q.cqid)), ["W1", "M1"]);
  assert.equal(b.at, 0);
  assert.equal(app.IDAnswers.get().W1.result, "missed", "nothing deleted");
  app.IDCockpit.bankGrade("got");
  assert.equal(app.IDAnswers.get().W1.result, "got");
  assert.equal(app.IDAnswers.get().W1.ts, NOW.getTime());
});

test("a focus cqid that is not in the queue falls through to the first ungraded question", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  app.IDCockpit.bankOpen("ch101", "NOPE");
  await tick(); await tick();
  const b = app.IDCockpit.bank();
  assert.equal(b.queue[b.at].cqid, "W2");
});

test("one tap on the Bank tab retries an index load that failed", async () => {
  let calls = 0;
  const base = fetchFor();
  const flaky = async (url, init) => {
    if (url === "qbank/index.json" && ++calls === 1) return { ok: false, status: 500, json: async () => null };
    return base(url, init);
  };
  const app = loadCurrentApp({ now: NOW, fetch: flaky });
  await tick(); await tick();
  assert.equal(app.IDCockpit.bank().index, null, "the boot load failed");

  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankTabTapped();
  await tick(); await tick();
  const idx = app.IDCockpit.bank().index;
  assert.ok(Array.isArray(idx), "one tap re-fetched the index");
  assert.equal(idx.length, 1);
});

test("the card shows marks per part, strips the trailing '(1.5)', and counts recurrences", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);
  app.IDCockpit.setTab("bank");
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /Asked 2 times · AB 2018, MB 2018/);
  assert.match(html, /class="bkmk">1\.5 marks</);
  assert.doesNotMatch(html, /\(1\.5\)/, "the bracketed mark is not repeated in the text");
  assert.match(html, /id="bkflag"/);
});

test("a bare topic stem renders as a heading, not the big serif stem", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);                       // lands on W2 ("HPV")
  app.IDCockpit.setTab("bank");
  const html = app._elements.get("v-bank").innerHTML;
  assert.match(html, /class="bktopic">HPV</);
  assert.doesNotMatch(html, /class="bkstem">HPV</);
});

test("reveal: cohort-only questions show the documented answer as the primary box", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor() });
  await openChapter(app);                       // W1: no model answer, cohort present
  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankReveal();
  const html = app._elements.get("bkrev").innerHTML;
  assert.match(html, /Documented answer · AB 2018 \(answer slide\)/);
  assert.match(html, /class="bkans">Shiga toxin…</);
  assert.doesNotMatch(html, /Prior cohort answer/, "not repeated as secondary");
  assert.doesNotMatch(html, /class="bkans"><\/div>/, "no empty box");
});

test("reveal: a Mandell draft is primary with the cohort answer secondary", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);                       // W2
  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankReveal();
  const html = app._elements.get("bkrev").innerHTML;
  assert.match(html, /Model answer · Mandell pp\. 1–2/);
  assert.match(html, /class="bkans">16 and 18\./);
  assert.match(html, /Prior cohort answer · H-decks/);
});

test("reveal: neither answer says so instead of drawing a blank", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 }, W2: { result: "got", ts: 1 }, M1: { result: "correct", ts: 1 } }) });
  await tick(); await tick();
  app.IDCockpit.bankOpen("ch101", "W3");        // deferred, no answers at all
  await tick(); await tick();
  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankReveal();
  assert.match(app._elements.get("bkrev").innerHTML, /No answer on file/);
});

test("a repaint mid-question keeps the pick and the reveal", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: fetchFor({ W1: { result: "got", ts: 1 }, W2: { result: "got", ts: 1 } }) });
  await tick(); await tick();
  await openChapter(app);                       // M1
  app.IDCockpit.setTab("bank");
  app.IDCockpit.bankPick("A");
  app.IDCockpit.bankReveal();
  assert.match(app._elements.get("bkrev").innerHTML, /Incorrect — you chose A/);
  app.IDCockpit.render();                       // a sync or theme flip repaints the tab
  assert.match(app._elements.get("bkrev").innerHTML, /Incorrect — you chose A/, "reveal survives the repaint");
  assert.match(app._elements.get("bkgrade").innerHTML, /data-grade="incorrect"/);
});
