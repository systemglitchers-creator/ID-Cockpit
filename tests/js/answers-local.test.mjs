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
  app.IDAnswers.start(() => { calls++; });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  assert.equal(app.IDAnswers.get().Q9.result, "correct");
});
