// tests/js/bank-index.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/* The bundle builder (Python, outside git) and lib/bank.js both implement the
   marks rule; the index is what the app trusts. Pin the emitted data to the JS
   rule for every placement so the two cannot drift silently. */

const require_ = createRequire(import.meta.url);
const { marksFor } = require_("../../lib/bank.js");
const QB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "qbank");
const index = JSON.parse(fs.readFileSync(path.join(QB, "index.json"), "utf8")).chapters;

test("index marks and deferred lists match the chapter files for every placement", () => {
  let placements = 0;
  for (const c of index) {
    const ch = JSON.parse(fs.readFileSync(path.join(QB, c.id + ".json"), "utf8"));
    assert.deepEqual(ch.questions.map((q) => q.cqid), c.cqids, c.id + " cqid order");
    const deferred = ch.questions.filter((q) => q.needs && q.needs.length).map((q) => q.cqid);
    assert.deepEqual(c.deferred, deferred, c.id + " deferred");
    assert.equal(c.n_deferred, deferred.length, c.id + " n_deferred");
    for (const q of ch.questions) {
      assert.equal(Number(c.marks[q.cqid]), marksFor(q), c.id + " " + q.cqid + " marks");
      placements++;
    }
  }
  assert.equal(placements, 4034, "placement count changed — update this number if the bank was rebuilt");
});
