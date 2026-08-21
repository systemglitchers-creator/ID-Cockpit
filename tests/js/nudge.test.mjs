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
