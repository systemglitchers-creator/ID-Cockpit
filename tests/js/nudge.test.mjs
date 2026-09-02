import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* The evening nudge: lib/plan.js mirrors the app's dealing maths server-side,
   lib/nudge.js turns it into a message, api/push.js stores the subscription.
   Times below are Halifax-local (ADT = UTC-3) unless noted. */

const require_ = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { tonight } = require_("../../lib/plan.js");
const { compose } = require_("../../lib/nudge.js");

const src = fs.readFileSync(path.join(ROOT, "public/schedule.js"), "utf8");
const SECTIONS = new Function(`${src}; return SECTIONS;`)();
const ROWS = SECTIONS.flatMap((s) => s.rows);

const at = (t) => ({ done: true, doneAt: t, updatedAt: t });
const readFirst = (n, doneAt) =>
  Object.fromEntries(ROWS.slice(0, n).map((r) => [r.id, at(doneAt)]));

// A Friday evening in Halifax; server clocks are UTC, so build from an offset.
const FRI_EVE = new Date("2026-08-21T20:30:00-03:00");
const SAT_EVE = new Date("2026-08-22T20:30:00-03:00");

test("a normal study evening nudges with one session", () => {
  const t = tonight(SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"), FRI_EVE);
  assert.equal(t.sessions.length, 1, "grace window keeps pre-Aug-23 days single");
  const msg = compose(SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"), FRI_EVE);
  assert.equal(msg.title, "Tonight's reading");
  assert.equal(msg.badge, 1, "the badge rides the push");
  assert.match(msg.body, /pp \d+–\d+ · ~\d+ min/, "the body carries pages and minutes");
});

test("a rest Saturday never nudges", () => {
  assert.equal(tonight(SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"), SAT_EVE), null);
});

test("already read today means silence", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  progress[ROWS[30].id] = at("2026-08-21T14:00:00-03:00");   // read this afternoon
  assert.equal(tonight(SECTIONS, progress, FRI_EVE), null);
});

test("UTC evening is still the same Halifax day", () => {
  // 2026-08-22T01:00Z is 10pm Friday in Halifax — a read at that stamp
  // belongs to Friday, and Friday's nudge must stay silent.
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  progress[ROWS[30].id] = at("2026-08-22T01:00:00Z");
  assert.equal(tonight(SECTIONS, progress, FRI_EVE), null);
});

test("past the grace date a debt means two tonight, honestly labeled", () => {
  const SEP_EVE = new Date("2026-09-20T20:30:00-03:00");     // Sunday, well behind
  const t = tonight(SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"), SEP_EVE);
  assert.equal(t.sessions.length, 2, "doubles start once the grace date is past");
  const msg = compose(SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"), SEP_EVE);
  assert.equal(msg.title, "2 tonight clears the debt");
  assert.match(msg.body, /^1\) /m);
  assert.match(msg.body, /^2\) /m);
});

test("a finished curriculum never nudges", () => {
  const all = Object.fromEntries(ROWS.map((r) => [r.id, at("2026-07-20T12:00:00Z")]));
  assert.equal(tonight(SECTIONS, all, FRI_EVE), null);
});

/* ---- drills ride the nudge ---- */
const { owedChapters, chapterSessionIds } = require_("../../lib/bank.js");
const IDX = [{ chapter: "Chapter 20", id: "ch20", title: "Penicillins and β-Lactamase Inhibitors",
               sector: "Drug Foundations — Completed", weeks: [1], cqids: ["Q1", "Q2"], deferred: ["Q2"] }];
const owedFor = (progress, answers) => ({
  owed: owedChapters(SECTIONS, progress, IDX, answers || {}), answers: answers || {},
});
// Q9 belongs to no chapter in IDX, so grading it leaves ch20 owed while still
// counting as "he drilled something today".
const FRI_TS = new Date("2026-08-21T15:00:00-03:00").getTime();   // Friday afternoon
const THU_TS = new Date("2026-08-20T15:00:00-03:00").getTime();   // the evening before

test("reading tonight plus an owed chapter appends a drill line and adds to the badge", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");   // includes every ch20 sitting
  assert.ok(chapterSessionIds(SECTIONS, 20).every((id) => progress[id]), "fixture assumption");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress));
  assert.equal(msg.title, "Tonight's reading · 1 to drill");
  assert.match(msg.body, /\nCh 20 · Penicillins and β-Lactamase Inhibitors · 1 to drill$/);
  assert.equal(msg.badge, 2);
});

test("read today but a chapter is owed: a drill-only nudge", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  progress[ROWS[30].id] = at("2026-08-21T14:00:00-03:00");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress));
  assert.equal(msg.title, "Ready to drill · 1 chapter");
  assert.match(msg.body, /Ch 20 · .* · 1 to drill/);
  assert.equal(msg.badge, 1);
});

test("a rest Saturday stays silent even with drills owed", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  assert.equal(compose(SECTIONS, progress, SAT_EVE, owedFor(progress)), null);
});

test("nothing owed leaves the nudge exactly as it was", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const plain = compose(SECTIONS, progress, FRI_EVE);
  const withBank = compose(SECTIONS, progress, FRI_EVE, owedFor(progress, { Q1: { result: "got", ts: 1 } }));
  assert.deepEqual(withBank, plain);
});

test("more than two owed chapters collapse to a '+N more' line", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const many = [1, 2, 3, 4].map((n) => ({ chapter: "Chapter " + n, id: "ch" + n, title: "T" + n, sector: "S", remaining: n, total: n, readAt: n }));
  const msg = compose(SECTIONS, progress, FRI_EVE, { owed: many });
  assert.equal(msg.title, "Tonight's reading · 4 to drill");
  assert.match(msg.body, /^Ch 1 · T1 · 1 to drill$/m);
  assert.match(msg.body, /\+2 more chapters to drill$/);
  assert.equal(msg.badge, 5);
});

test("a grade landing today rests the drill lines", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress, { Q9: { result: "got", ts: FRI_TS } }));
  assert.equal(msg.title, "Tonight's reading", "no drill count in the title either");
  assert.doesNotMatch(msg.body, /to drill/);
  assert.equal(msg.badge, 1);
});

test("read today and graded today means no nudge at all", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  progress[ROWS[30].id] = at("2026-08-21T14:00:00-03:00");
  const bank = owedFor(progress, { Q9: { result: "got", ts: FRI_TS } });
  assert.equal(compose(SECTIONS, progress, FRI_EVE, bank), null);
});

test("a malformed ts in the answers store neither throws nor counts as today", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const answers = { Q9: { result: "got", ts: "not-a-number" }, Q8: { result: "got", ts: null } };
  const msg = compose(SECTIONS, progress, FRI_EVE, { owed: owedChapters(SECTIONS, progress, IDX, {}), answers });
  assert.match(msg.body, /to drill/, "bad data is ignored, the drill line still shows");
});

test("a grade the evening before still leaves tonight's drill line", () => {
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const msg = compose(SECTIONS, progress, FRI_EVE, owedFor(progress, { Q9: { result: "got", ts: THU_TS } }));
  assert.equal(msg.title, "Tonight's reading · 1 to drill");
  assert.match(msg.body, /\nCh 20 · Penicillins and β-Lactamase Inhibitors · 1 to drill$/);
  assert.equal(msg.badge, 2);

  // An answer stored without a result — a card opened and left — is not a grade.
  const opened = compose(SECTIONS, progress, FRI_EVE, owedFor(progress, { Q9: { ts: FRI_TS } }));
  assert.equal(opened.title, "Tonight's reading · 1 to drill");
});

/* ---- the subscription endpoint ---- */

process.env.COCKPIT_FAKE_KV = "1";
const kv = require_("../../api/_kv.js");
const pushHandler = require_("../../api/push.js");

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const SUB = { endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } };

test("subscription round-trips: POST stores, DELETE forgets", async () => {
  kv.__resetFake();
  let r = res();
  await pushHandler({ method: "POST", body: { subscription: SUB } }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(await kv.getPushSub(), SUB);

  r = res();
  await pushHandler({ method: "DELETE" }, r);
  assert.equal(r.code, 200);
  assert.equal(await kv.getPushSub(), null);
});

test("a bad subscription is refused before it reaches the store", async () => {
  kv.__resetFake();
  for (const bad of [null, {}, { endpoint: "http://insecure" }, { endpoint: "https://x" }]) {
    const r = res();
    await pushHandler({ method: "POST", body: { subscription: bad } }, r);
    assert.equal(r.code, 400, JSON.stringify(bad));
  }
  assert.equal(await kv.getPushSub(), null);
});

test("the cron endpoint rejects a caller without the secret", async () => {
  process.env.CRON_SECRET = "shh";
  const nudgeHandler = require_("../../api/nudge.js");
  const r = res();
  await nudgeHandler({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 401);
  delete process.env.CRON_SECRET;
});

test("no subscription means the cron reports and does nothing", async () => {
  kv.__resetFake();
  const nudgeHandler = require_("../../api/nudge.js");
  const r = res();
  await nudgeHandler({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.sent, false);
});

/* ---- the cron feeds the bank into the nudge ---- */

const nudgeHandler = require_("../../api/nudge.js");
const webpush = require_("web-push");

/** Swap global.fetch for the duration of one test. */
function stubFetch(fn) {
  const real = global.fetch;
  global.fetch = fn;
  return () => { global.fetch = real; };
}

/** Freeze the wall clock the handler reads via `new Date()`. Without this these
    tests pass or fail by the day they are run on: a rest Saturday silences the
    nudge entirely. Date with arguments still behaves — lib/plan.js builds its
    dates from components. Mirrors fixedDateClass in tests/js/harness.mjs. */
function stubClock(when) {
  const Real = global.Date, ms = when.getTime();
  global.Date = class extends Real {
    constructor(...args) { if (args.length === 0) super(ms); else super(...args); }
    static now() { return ms; }
  };
  return () => { global.Date = Real; };
}

/** Swap web-push's two network-touching methods; returns the sent payloads. */
function stubPush() {
  const real = { v: webpush.setVapidDetails, s: webpush.sendNotification };
  const sent = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, payload) => { sent.push(JSON.parse(payload)); };
  sent.restore = () => { webpush.setVapidDetails = real.v; webpush.sendNotification = real.s; };
  return sent;
}

/** A store primed with the real schedule, a subscription and a read chapter 20. */
async function primeKv() {
  kv.__resetFake();
  await kv.setSchedule({ sections: SECTIONS });     // keeps liveSections off the network
  await kv.setPushSub(SUB);
  await kv.setProgress(readFirst(30, "2026-07-20T12:00:00Z"));
  await kv.setAnswers({});
}

const CRON = { method: "GET", headers: { host: "id.example" } };
const servesIndex = async () => ({ ok: true, json: async () => ({ chapters: IDX }) });

test("the cron names the owed chapter in the push it sends", async () => {
  await primeKv();
  const unclock = stubClock(FRI_EVE);               // a study Friday: reading and a drill
  const unfetch = stubFetch(servesIndex);
  const sent = stubPush();
  try {
    const r = res();
    await nudgeHandler(CRON, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "Tonight's reading · 1 to drill");
    assert.match(sent[0].body, /pp \d+–\d+ · ~\d+ min/, "the reading still leads");
    assert.match(sent[0].body, /\nCh 20 · Penicillins and β-Lactamase Inhibitors · 1 to drill$/);
    assert.equal(sent[0].badge, 2);
  } finally { sent.restore(); unfetch(); unclock(); }
});

test("the cron stays silent on a rest Saturday even with a chapter owed", async () => {
  await primeKv();
  const unclock = stubClock(SAT_EVE);
  const unfetch = stubFetch(servesIndex);
  const sent = stubPush();
  try {
    const r = res();
    await nudgeHandler(CRON, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.sent, false);
    assert.equal(r.body.why, "nothing tonight");
    assert.equal(sent.length, 0, "a rest day is a rest day, drills or not");
  } finally { sent.restore(); unfetch(); unclock(); }
});

test("a bank outage never silences the nudge", async () => {
  await primeKv();
  const unclock = stubClock(FRI_EVE);
  const unfetch = stubFetch(async () => ({ ok: false, status: 500 }));
  const sent = stubPush();
  try {
    const r = res();
    await nudgeHandler(CRON, r);
    assert.equal(r.code, 200, "a dead index must not become a 502");
    assert.equal(r.body.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].title, "Tonight's reading");
    assert.doesNotMatch(sent[0].body, /to drill/);
    assert.equal(sent[0].badge, 1);
  } finally { sent.restore(); unfetch(); unclock(); }
});

test("bankState reads the index, and yields undefined when it cannot", async () => {
  kv.__resetFake();
  const progress = readFirst(30, "2026-07-20T12:00:00Z");
  const req = { headers: { host: "id.example" } };

  let unfetch = stubFetch(async (url) => {
    assert.equal(url, "https://id.example/qbank/index.json");
    return { ok: true, json: async () => ({ chapters: IDX }) };
  });
  try {
    const bank = await nudgeHandler.bankState(req, SECTIONS, progress);
    assert.equal(bank.owed.length, 1);
    assert.equal(bank.owed[0].id, "ch20");
    assert.equal(bank.owed[0].remaining, 1);
  } finally { unfetch(); }

  unfetch = stubFetch(async () => ({ ok: false, status: 500 }));
  try {
    assert.equal(await nudgeHandler.bankState(req, SECTIONS, progress), undefined);
  } finally { unfetch(); }

  unfetch = stubFetch(async () => { throw new Error("network down"); });
  const err = console.error; console.error = () => {};
  try {
    assert.equal(await nudgeHandler.bankState(req, SECTIONS, progress), undefined);
  } finally { console.error = err; unfetch(); }
});

test("bankState gives up on a hung origin rather than stalling the cron", async () => {
  kv.__resetFake();
  let signal = null;
  // A hung origin resolves nothing and AbortSignal.timeout ends it with this.
  // Thrown at once rather than really waiting, so the suite stays quick.
  const unfetch = stubFetch(async (url, init) => {
    signal = init && init.signal;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const err = console.error; console.error = () => {};
  try {
    const req = { headers: { host: "id.example" } };
    const bank = await nudgeHandler.bankState(req, SECTIONS, readFirst(30, "2026-07-20T12:00:00Z"));
    assert.equal(bank, undefined, "the reading nudge goes out without the bank");
    assert.ok(signal instanceof AbortSignal, "the fetch carries a timeout signal");
    assert.ok(!signal.aborted, "live when the fetch begins");
  } finally { console.error = err; unfetch(); }
});

test("both of the cron's fetches carry a timeout signal", async () => {
  await primeKv();
  await kv.setSchedule(null);              // force liveSections onto the network too
  const seen = {};
  const unclock = stubClock(FRI_EVE);
  const unfetch = stubFetch(async (url, init) => {
    if (url.endsWith("/schedule.js")) {
      seen.schedule = init && init.signal;
      return { ok: true, text: async () => src };
    }
    seen.qbank = init && init.signal;
    return { ok: true, json: async () => ({ chapters: IDX }) };
  });
  const sent = stubPush();
  try {
    const r = res();
    await nudgeHandler(CRON, r);
    assert.equal(r.body.sent, true);
    assert.ok(seen.schedule instanceof AbortSignal, "liveSections");
    assert.ok(seen.qbank instanceof AbortSignal, "bankState");
  } finally { sent.restore(); unfetch(); unclock(); }
});

test("each run gets a fresh timeout, not one that started at module load", async () => {
  // A module-level `const opts = {signal: AbortSignal.timeout(n)}` looks right and
  // works once: the signal starts counting when the module loads, and Vercel reuses
  // a warm module, so every later invocation would fetch with an expired signal.
  kv.__resetFake();
  const seen = [];
  const unfetch = stubFetch(async (url, init) => {
    seen.push(init && init.signal);
    return { ok: true, json: async () => ({ chapters: IDX }) };
  });
  try {
    const req = { headers: { host: "id.example" } };
    const progress = readFirst(30, "2026-07-20T12:00:00Z");
    await nudgeHandler.bankState(req, SECTIONS, progress);
    await nudgeHandler.bankState(req, SECTIONS, progress);
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0], seen[1], "two runs must not share one signal");
    assert.ok(seen.every((sg) => sg && !sg.aborted), "and neither may arrive pre-aborted");
  } finally { unfetch(); }
});
