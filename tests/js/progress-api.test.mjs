import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mergeProgress, validateProgress } from "../../lib/progress-merge.mjs";

process.env.COCKPIT_FAKE_KV = "1";
const require_ = createRequire(import.meta.url);
const kv = require_("../../api/_kv.js");

const at = (t) => ({ done: true, doneAt: t, updatedAt: t });

/* ---- the safety property ---------------------------------------------------
   This is the whole reason the endpoint merges instead of assigning. The bug it
   prevents is silent and permanent: a phone that has lost its local storage
   opens, posts its empty state, and erases everything. */

test("an empty client cannot erase the server", () => {
  const server = { "ch20-p1": at("2026-08-01T10:00:00Z") };
  assert.deepEqual(mergeProgress(server, {}), server);
  assert.deepEqual(mergeProgress({}, server), server);
});

test("a partial client cannot erase what it does not know about", () => {
  const server = { a: at("2026-08-01T10:00:00Z"), b: at("2026-08-02T10:00:00Z") };
  const phone = { a: at("2026-08-03T10:00:00Z") };
  const out = mergeProgress(server, phone);
  assert.deepEqual(Object.keys(out).sort(), ["a", "b"]);
  assert.equal(out.a.updatedAt, "2026-08-03T10:00:00Z", "newer client entry wins");
  assert.equal(out.b.updatedAt, "2026-08-02T10:00:00Z", "unknown-to-client entry survives");
});

test("merging never removes a session id", () => {
  const server = { a: at("2026-08-01T10:00:00Z"), b: at("2026-08-01T10:00:00Z") };
  for (const client of [{}, { a: at("2026-09-01T10:00:00Z") }, { c: at("2026-09-01T10:00:00Z") }]) {
    const out = mergeProgress(server, client);
    for (const id of Object.keys(server)) assert.ok(id in out, id);
  }
});

test("an un-marked session is respected when it is genuinely newer", () => {
  // Un-ticking must still work — this is deliberate, not an erasure.
  const server = { a: at("2026-08-01T10:00:00Z") };
  const phone = { a: { done: false, doneAt: null, updatedAt: "2026-08-05T10:00:00Z" } };
  assert.equal(mergeProgress(server, phone).a.done, false);
});

test("a stale un-mark loses to a newer read", () => {
  const server = { a: at("2026-08-06T10:00:00Z") };
  const phone = { a: { done: false, doneAt: null, updatedAt: "2026-08-05T10:00:00Z" } };
  assert.equal(mergeProgress(server, phone).a.done, true);
});

test("merge is order-independent for the same inputs", () => {
  const x = { a: at("2026-08-01T10:00:00Z"), b: at("2026-08-04T10:00:00Z") };
  const y = { a: at("2026-08-03T10:00:00Z"), c: at("2026-08-02T10:00:00Z") };
  assert.deepEqual(mergeProgress(x, y), mergeProgress(y, x));
});

/* ---- validation ---- */

test("garbage is refused before it reaches the store", () => {
  assert.match(validateProgress(null).errors.join(), /must be an object/);
  assert.match(validateProgress([]).errors.join(), /must be an object/);
  assert.match(validateProgress({ a: { done: "yes" } }).errors.join(), /done must be a boolean/);
  assert.match(validateProgress({ a: { done: true, doneAt: 5 } }).errors.join(), /doneAt must be a string/);
});

test("a well-formed map validates", () => {
  assert.deepEqual(validateProgress({ a: at("2026-08-01T10:00:00Z") }).errors, []);
  assert.deepEqual(validateProgress({}).errors, []);
});

/* ---- the endpoint ---- */

function res() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const handler = () => require_("../../api/progress.js");

test("GET returns an empty map before anything is stored", async () => {
  kv.__resetFake();
  const r = res();
  await handler()({ method: "GET" }, r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.sessions, {});
});

test("POST merges and returns the merged state", async () => {
  kv.__resetFake();
  let r = res();
  await handler()({ method: "POST", body: { sessions: { a: at("2026-08-01T10:00:00Z") } } }, r);
  assert.equal(r.code, 200);

  r = res();
  await handler()({ method: "POST", body: { sessions: { b: at("2026-08-02T10:00:00Z") } } }, r);
  assert.deepEqual(Object.keys(r.body.sessions).sort(), ["a", "b"], "second post must not drop the first");
});

test("POSTing an empty map returns everything, having deleted nothing", async () => {
  kv.__resetFake();
  let r = res();
  await handler()({ method: "POST", body: { sessions: { a: at("2026-08-01T10:00:00Z") } } }, r);
  r = res();
  await handler()({ method: "POST", body: { sessions: {} } }, r);
  assert.deepEqual(Object.keys(r.body.sessions), ["a"]);
});

test("a malformed POST is refused and changes nothing", async () => {
  kv.__resetFake();
  let r = res();
  await handler()({ method: "POST", body: { sessions: { a: at("2026-08-01T10:00:00Z") } } }, r);
  r = res();
  await handler()({ method: "POST", body: { sessions: "nope" } }, r);
  assert.equal(r.code, 400);
  r = res();
  await handler()({ method: "GET" }, r);
  assert.deepEqual(Object.keys(r.body.sessions), ["a"], "the store is untouched");
});

test("unsupported methods are refused", async () => {
  const r = res();
  await handler()({ method: "DELETE" }, r);
  assert.equal(r.code, 405);
});

/* ---- client side ------------------------------------------------------------
   The phone must be able to arrive empty and be filled from the server. That is
   the whole fix: local storage is a cache, the server is the truth. */
import { loadCurrentApp } from "./harness.mjs";

const NOW = new Date(2026, 7, 8, 21, 0, 0);
const settle = () => new Promise((r) => setTimeout(r, 40));

// The app calls /api/schedule as well as /api/progress on boot. Route by URL,
// or the schedule GET (which has no body) lands in the progress stub.
function routed(onProgress) {
  return (url, init) => {
    if (String(url).indexOf("/api/progress") === 0) return onProgress(url, init);
    return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
  };
}

test("a device that has lost its progress is refilled from the server", async () => {
  const server = { "ch20-p1": at("2026-08-01T10:00:00Z"), "ch20-p2": at("2026-08-01T10:00:00Z") };
  let posted = null;
  const app = loadCurrentApp({
    now: NOW, done: [],                       // empty phone, exactly the bug
    fetch: routed((url, init) => {
      posted = JSON.parse(init.body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sessions: server }) });
    })
  });
  assert.equal(app.IDCockpit.compute().sessDone, 0, "starts empty");
  await settle();
  assert.deepEqual(posted.sessions, {}, "sends its empty state, claiming nothing");
  assert.equal(Object.keys(app.IDStore.getState().sessions).length, 2, "and is refilled");
});

test("local reads survive an offline server", async () => {
  const app = loadCurrentApp({
    now: NOW, done: ["ch20-p1", "ch20-p2", "ch20-p3"],
    fetch: routed(() => Promise.reject(new Error("offline")))
  });
  await settle();
  assert.equal(Object.keys(app.IDStore.getState().sessions).length, 3, "local state untouched");
});

test("a garbage server response is ignored rather than adopted", async () => {
  for (const body of [null, {}, { sessions: "nope" }]) {
    const app = loadCurrentApp({
      now: NOW, done: ["ch20-p1"],
      fetch: routed(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
    });
    await settle();
    assert.equal(Object.keys(app.IDStore.getState().sessions).length, 1, JSON.stringify(body));
  }
});

test("a server error leaves local progress alone", async () => {
  const app = loadCurrentApp({
    now: NOW, done: ["ch20-p1"],
    fetch: routed(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}) }))
  });
  await settle();
  assert.equal(Object.keys(app.IDStore.getState().sessions).length, 1);
});
