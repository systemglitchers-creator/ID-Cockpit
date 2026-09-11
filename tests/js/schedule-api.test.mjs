import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

process.env.COCKPIT_FAKE_KV = "1";
const require_ = createRequire(import.meta.url);
const kv = require_("../../api/_kv.js");

test("fake KV round-trips a schedule", async () => {
  kv.__resetFake();
  await kv.setSchedule({ version: "v1", sections: [] });
  assert.deepEqual(await kv.getSchedule(), { version: "v1", sections: [] });
});

test("an unpushed schedule reads as null, not an error", async () => {
  kv.__resetFake();
  assert.equal(await kv.getSchedule(), null);
});

/* ---- validation ------------------------------------------------------------
   Session ids are the keys progress is stored against, so a duplicate or a
   rename silently orphans read-state. Nothing invalid may reach the store. */
import { validateSchedule } from "../../lib/schedule-schema.mjs";

const good = { version: "2026-08-08", sections: [
  { title: "S", rows: [{ id: "ch1-p1", r: "Chapter 1", pp: 5, ps: 1, pe: 5, wk: 1, gi: 0 }] }
] };

test("a well-formed schedule validates", () => {
  assert.deepEqual(validateSchedule(good).errors, []);
});

test("duplicate session ids are rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { id: "dup", r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 },
    { id: "dup", r: "B", pp: 1, ps: 2, pe: 2, wk: 1, gi: 1 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /duplicate id: dup/);
});

test("a missing id is rejected", () => {
  const bad = { version: "v", sections: [{ title: "S", rows: [
    { r: "A", pp: 1, ps: 1, pe: 1, wk: 1, gi: 0 }
  ] }] };
  assert.match(validateSchedule(bad).errors.join(), /missing id/);
});

test("a non-numeric plan day is rejected", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].gi = "nope";
  assert.match(validateSchedule(bad).errors.join(), /gi must be a number/);
});

test("a make-up flag must be a boolean when present", () => {
  // `extra: true` pins a session to its own day as a second session. Anything
  // else is a typo that would silently leave the session in the queue.
  const ok = JSON.parse(JSON.stringify(good));
  ok.sections[0].rows[0].extra = true;
  assert.deepEqual(validateSchedule(ok).errors, []);
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].extra = "yes";
  assert.match(validateSchedule(bad).errors.join(), /extra must be a boolean/);
});

test("a null page count is allowed", () => {
  // The Consolidation and Practice Questions sessions are review days with no
  // page range: pp/ps/pe are null by design. 20 of the 585 look like this.
  const ok = JSON.parse(JSON.stringify(good));
  ok.sections[0].rows[0].pp = null;
  assert.deepEqual(validateSchedule(ok).errors, []);
});

test("a garbage page count is still rejected", () => {
  const bad = JSON.parse(JSON.stringify(good));
  bad.sections[0].rows[0].pp = "six";
  assert.match(validateSchedule(bad).errors.join(), /pp must be a number or null/);
});

test("an empty schedule is rejected", () => {
  assert.match(validateSchedule({ version: "v", sections: [] }).errors.join(), /no sections/);
});

test("the real schedule in the repo is valid", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../public/schedule.js", import.meta.url), "utf8");
  const g = {};
  new Function("g", src + "\ng.SECTIONS = SECTIONS;")(g);
  assert.deepEqual(validateSchedule({ version: "x", sections: g.SECTIONS }).errors, []);
});

/* ---- GET /api/schedule ------------------------------------------------------
   204 means "nothing pushed" and is not an error: the app then keeps the copy
   bundled in public/schedule.js, so an empty store is never an outage. */
function res() {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

test("serves the pushed schedule", async () => {
  kv.__resetFake();
  await kv.setSchedule(good);
  const r = res();
  await require_("../../api/schedule.js")({ method: "GET" }, r);
  assert.equal(r.code, 200);
  assert.equal(r.body.version, "2026-08-08");
});

test("204 when nothing has been pushed, so the app keeps its bundled copy", async () => {
  kv.__resetFake();
  const r = res();
  await require_("../../api/schedule.js")({ method: "GET" }, r);
  assert.equal(r.code, 204);
});

test("a corrupt stored schedule is refused rather than served", async () => {
  kv.__resetFake();
  await kv.setSchedule({ version: "v", sections: [] });
  const r = res();
  await require_("../../api/schedule.js")({ method: "GET" }, r);
  assert.equal(r.code, 500);
});

test("writes are not accepted on this endpoint", async () => {
  const r = res();
  await require_("../../api/schedule.js")({ method: "POST" }, r);
  assert.equal(r.code, 405);
});

/* ---- client fetch-and-swap --------------------------------------------------
   The bundled schedule renders instantly and is the offline copy. A pushed
   schedule is an upgrade applied after first paint, never a dependency. */
import { loadCurrentApp } from "./harness.mjs";

const NOW = new Date(2026, 7, 8, 21, 0, 0);
const served = { version: "2026-09-01", sections: [
  { title: "Only sector", accent: "#333", year: 1, rows: [
    { id: "ch1-p1", r: "Chapter 1 — Test", pp: 4, ps: 1, pe: 4, wk: 1, gi: 0 }] }] };

const serving = (status, body) => () =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

test("a pushed schedule replaces the bundled one after boot", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: serving(200, served) });
  assert.equal(app.IDCockpit.compute().sessTotal, 585, "boots on the bundled schedule");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(app.IDCockpit.compute().sessTotal, 1, "swapped to the pushed schedule");
});

test("an unpushed store leaves the bundled schedule in place", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: serving(204, null) });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(app.IDCockpit.compute().sessTotal, 585);
});

test("being offline leaves the bundled schedule in place", async () => {
  const app = loadCurrentApp({ now: NOW, fetch: () => Promise.reject(new Error("offline")) });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(app.IDCockpit.compute().sessTotal, 585);
});

test("a malformed served schedule is ignored rather than applied", async () => {
  for (const body of [{ version: "v" }, { version: "v", sections: [] }, null]) {
    const app = loadCurrentApp({ now: NOW, fetch: serving(200, body) });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(app.IDCockpit.compute().sessTotal, 585, JSON.stringify(body));
  }
});
