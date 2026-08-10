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
