// scripts/push-schedule.mjs — read the schedule the repo already has, validate
// it, write it to Redis. The app picks it up on next open, no deploy.
//
// Refuses to push anything invalid. Fix the source, never work around the
// validator: a duplicate or renamed session id silently orphans read-state.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { validateSchedule } from "../lib/schedule-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "public/schedule.js"), "utf8");

// schedule.js is a plain browser script assigning `var SECTIONS = [...]`.
const sandbox = {};
new Function("g", src + "\ng.SECTIONS = SECTIONS;")(sandbox);

const payload = {
  version: new Date().toISOString().slice(0, 10),
  sections: sandbox.SECTIONS,
};

const { errors } = validateSchedule(payload);
if (errors.length) {
  console.error("schedule.js is invalid — NOT pushing:\n  " + errors.join("\n  "));
  process.exit(1);
}

const { setSchedule } = createRequire(import.meta.url)("../api/_kv.js");
try {
  await setSchedule(payload);
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}

const rows = payload.sections.reduce((n, s) => n + s.rows.length, 0);
console.log(`Pushed schedule ${payload.version}: ${payload.sections.length} sections, ${rows} sessions.`);
