// The Bank's answer-state API. Same safety property as read-state: a client
// with an empty view must never be able to erase what the server holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.COCKPIT_FAKE_KV = "1";
const require = createRequire(import.meta.url);
const kv = require("../../api/_kv.js");
const handler = require("../../api/answers.js");

function res() {
  return { code: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; } };
}
const req = (method, body) => ({ method, body, on() {} });

test("POST then GET round-trips an answer", async () => {
  kv.__resetFake && kv.__resetFake();
  let r = res();
  await handler(req("POST", { answers: { Q1: { result: "correct", ts: 1 } } }), r);
  assert.equal(r.code, 200);
  r = res();
  await handler(req("GET"), r);
  assert.equal(r.body.answers.Q1.result, "correct");
});

test("newer timestamp wins, older does not clobber", async () => {
  kv.__resetFake && kv.__resetFake();
  await handler(req("POST", { answers: { Q1: { result: "missed", ts: 100 } } }), res());
  await handler(req("POST", { answers: { Q1: { result: "got", ts: 200 } } }), res());
  await handler(req("POST", { answers: { Q1: { result: "missed", ts: 150 } } }), res());
  const r = res();
  await handler(req("GET"), r);
  assert.equal(r.body.answers.Q1.result, "got");
});

test("an empty client view cannot erase stored answers", async () => {
  kv.__resetFake && kv.__resetFake();
  await handler(req("POST", { answers: { Q1: { result: "correct", ts: 1 },
                                          Q2: { result: "missed", ts: 1 } } }), res());
  await handler(req("POST", { answers: {} }), res());
  const r = res();
  await handler(req("GET"), r);
  assert.ok(r.body.answers.Q1, "Q1 was erased by an empty client");
  assert.ok(r.body.answers.Q2, "Q2 was erased by an empty client");
});

test("malformed body is rejected", async () => {
  const r = res();
  await handler(req("POST", { nope: 1 }), r);
  assert.equal(r.code, 400);
});

test("chosen letter and flag round-trip untouched", async () => {
  kv.__resetFake && kv.__resetFake();
  await handler(req("POST", { answers: { M1: { result: "incorrect", chosen: "A", flag: true, ts: 3 } } }), res());
  const r = res();
  await handler(req("GET"), r);
  assert.deepEqual(r.body.answers.M1, { result: "incorrect", chosen: "A", flag: true, ts: 3 });
});
