// scripts/push-schedule.mjs — reads public/schedule.js, validates it, and
// pushes it to KV. Run via `npm run push:schedule`.
//
// Needs KV_REST_API_URL / KV_REST_API_TOKEN in the environment — run
// `npx vercel env pull .env.local` first if they aren't set.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { validateSchedule } from "../lib/schedule-schema.mjs";

const require_ = createRequire(import.meta.url);
const { setSchedule } = require_("../api/_kv.js");

const src = readFileSync(new URL("../public/schedule.js", import.meta.url), "utf8");
const g = {};
new Function("g", src + "\ng.SECTIONS = SECTIONS;")(g);

const payload = { version: new Date().toISOString(), sections: g.SECTIONS };

const { errors } = validateSchedule(payload);
if (errors.length) {
  console.error(`Schedule is invalid — not pushing:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}

await setSchedule(payload);
console.log(`Pushed ${payload.sections.length} sections, version ${payload.version}.`);
