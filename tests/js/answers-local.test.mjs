import test from "node:test";
import assert from "node:assert/strict";
import { loadApp } from "./harness.mjs";

/* IDAnswers is the Bank's answer store: localStorage is a cache, /api/answers is
   the truth, one POST both uploads and downloads. Same contract as IDServer. */

const KEY = "idcockpit.v1.answers";
const NOW = new Date(2026, 8, 1, 21, 0, 0);

function load(opts = {}) {
  return loadApp({ files: ["sync.js"], now: NOW, fetch: opts.fetch, storage: opts.storage });
}
const okFetch = (answers) => async (url, init) => ({
  ok: true, status: 200, json: async () => ({ answers }),
  _url: url, _init: init
});

/** A fetch whose replies you control one at a time — for tests that need to
    poke at state while a request is still in flight. */
function gatedFetch() {
  const gates = [];
  const fetch = () => {
    var resolve;
    var p = new Promise((res) => { resolve = res; });
    gates.push({ resolve, promise: p });
    return p;
  };
  fetch.gates = gates;
  return fetch;
}

test("set stamps ts, merges the patch into the record, and persists", () => {
  const app = load({ fetch: okFetch({}) });
  const rec = app.IDAnswers.set("Q1", { result: "got" });
  assert.equal(rec.result, "got");
  assert.equal(rec.ts, NOW.getTime());
  const stored = JSON.parse(app.localStorage.getItem(KEY));
  assert.equal(stored.Q1.result, "got");
  app.IDAnswers.set("Q1", { flag: true });
  const again = app.IDAnswers.get().Q1;
  assert.equal(again.result, "got", "a flag-only set keeps the result");
  assert.equal(again.flag, true);
  app.clearTimeout(app.IDAnswers._t); // don't leave the debounce timer running
});

test("get returns an empty map for missing or malformed storage", () => {
  assert.deepEqual(Object.keys(load().IDAnswers.get()), []);
  const bad = load({ storage: { [KEY]: "not json" } });
  assert.deepEqual(Object.keys(bad.IDAnswers.get()), []);
});

test("sync posts the whole local map and adopts the server's reply", async () => {
  let seen = null;
  const fetch = async (url, init) => {
    seen = { url, body: JSON.parse(init.body), cache: init.cache };
    return { ok: true, status: 200, json: async () => ({ answers: { Q1: { result: "got", ts: 5 }, Q2: { result: "missed", ts: 7 } } }) };
  };
  const app = load({ fetch, storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  const ok = await app.IDAnswers.sync();
  assert.equal(ok, true);
  assert.equal(seen.url, "/api/answers");
  assert.equal(seen.cache, "no-store");
  assert.deepEqual(Object.keys(seen.body.answers), ["Q1"]);
  assert.equal(app.IDAnswers.get().Q2.result, "missed", "server reply replaces local");
});

test("a failed sync leaves local untouched and resolves false", async () => {
  const app = load({ fetch: async () => { throw new Error("offline"); },
                     storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  assert.equal(await app.IDAnswers.sync(), false);
  assert.equal(app.IDAnswers.get().Q1.result, "got");
  const app2 = load({ fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }),
                      storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  assert.equal(await app2.IDAnswers.sync(), false);
  assert.equal(app2.IDAnswers.get().Q1.result, "got");
});

test("start syncs once and calls refresh after a successful sync", async () => {
  let calls = 0;
  const app = load({ fetch: okFetch({ Q9: { result: "correct", ts: 1 } }) });
  await app.IDAnswers.start(() => { calls++; });
  assert.equal(calls, 1);
  assert.equal(app.IDAnswers.get().Q9.result, "correct");
});

test("a set during an in-flight sync survives the reply", async () => {
  const fetch = gatedFetch();
  const app = load({ fetch, storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  const p = app.IDAnswers.sync();
  app.IDAnswers.set("Q2", { result: "missed" });
  fetch.gates[0].resolve({ ok: true, status: 200, json: async () => ({ answers: { Q1: { result: "got", ts: 5 } } }) });
  await p;
  assert.equal(app.IDAnswers.get().Q2.result, "missed", "a mid-flight write is not erased by the reply");
  assert.equal(app.IDAnswers.get().Q1.result, "got");
  app.clearTimeout(app.IDAnswers._t); // the set() above scheduled a debounce; don't leave it running
});

test("a sync requested while one is in flight runs again afterwards", async () => {
  const fetch = gatedFetch();
  const app = load({ fetch, storage: { [KEY]: JSON.stringify({ Q1: { result: "got", ts: 5 } }) } });
  const p1 = app.IDAnswers.sync();
  const skipped = await app.IDAnswers.sync();
  assert.equal(skipped, false, "the second call is guarded away while the first is in flight");
  assert.equal(fetch.gates.length, 1, "the guarded call never reaches the network");
  assert.equal(app.IDAnswers._pending, true, "it remembered that another sync was asked for");
  fetch.gates[0].resolve({ ok: true, status: 200, json: async () => ({ answers: { Q1: { result: "got", ts: 5 } } }) });
  await p1;
  assert.equal(app.IDAnswers._pending, false, "the pending flag was consumed once the first sync settled");
  app.clearTimeout(app.IDAnswers._t); // consuming _pending schedules a retry; don't wait out the real debounce here
  const p2 = app.IDAnswers.sync();
  assert.equal(fetch.gates.length, 2, "a fresh sync issues a second request");
  fetch.gates[1].resolve({ ok: true, status: 200, json: async () => ({ answers: {} }) });
  await p2;
});

test("start re-syncs on online and on becoming visible", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ answers: {} }) }; };
  const app = load({ fetch });
  const handlers = {};
  app.addEventListener = (ev, fn) => { handlers[ev] = fn; };
  app.document.visibilityState = "visible";
  await app.IDAnswers.start(() => {});
  assert.equal(calls, 1);
  // The online/visibilitychange handlers fire Answers.sync() without
  // returning its promise (same as production), so give the fetch chain a
  // real tick to unwind _inflight before the next handler fires.
  handlers.online();
  await new Promise((r) => app.setTimeout(r, 0));
  assert.equal(calls, 2);
  handlers.visibilitychange();
  await new Promise((r) => app.setTimeout(r, 0));
  assert.equal(calls, 3);
});
