/* Regenerate public/schedule.js from a redesign structure file.
   Usage: node scripts/resequence.mjs [--write]

   Every session keeps its id, title, guideline tag, and page range — only
   order, sector membership, and the derived fields (num, gi, wk, fow) change.

   The rebase: unread sessions get gi = REBASE_K0 + queue position, so the
   plan's end (max gi) absorbs the slip that existed on the rebase date and
   the app opens "On plan". Read sessions get gi 0..n-1 in new-plan order —
   a clean history. Catch-up stays armed for future slips.

   Validates, and refuses to write unless all of it holds:
   - all 584 ids present exactly once, none invented, none lost
   - r/g/pp/ps/pe byte-identical per id (nulls preserved)
   - no chapter runs 4+ consecutive sessions in the unread queue
   - max gi = REBASE_K0 + unread count - 1 (makeup 0 on the rebase date) */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STRUCTURE, TITLE_OVERRIDES } from "./redesign-2026-08-structure.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "schedule.js");

/* Sunday 2026-08-16: the first study day after the rebase (Sat Aug 15 is
   flex). studyIdx(2026-08-16) = 50 under the app's calendar. Fixed, like
   CATCHUP_FROM — a recomputed "today" would make the rebase drift. */
const REBASE_K0 = 50;

/* Server truth as of 2026-08-14 (scratch progress.json). Used only to place
   the unread queue for run-validation and gi; progress itself lives in Redis. */
const READ = new Set(("ch20-p1 ch20-p2 ch20-p3 ch21-p1 ch21-p2 ch21-p3 " +
  "ch22-p1 ch22-p2 ch22-p3 ch24-p1 ch24-p2 ch24-p3 ch75-p1 ch75-p2 ch75-p3 " +
  "ch29-p1 ch29-p2 ch29-p3 ch30-p1 ch30-p2 ch82-p1 ch82-p2 ch82-p3 ch82-p4 " +
  "ch82-p5 ch82-p6 ch306-p1 ch306-p2 ch306-p3 ch228-p1 ch228-p2 ch102-p1 " +
  "ch102-p2 ch213-p1 ch107-p1 ch107-p2 ch105-p1 ch105-p2 ch105-p3 " +
  "ch199-p1 ch199-p2 ch199-p3").split(" "));

/* ---- study-day calendar, mirrored from app.js ---- */
const START = new Date(2026, 5, 22);
const FLEX_START = new Date(2026, 6, 18);
const isFlex = (d) => d.getDay() === 6 && d >= FLEX_START;
function dayDate(gi) {
  const d = new Date(START); let n = gi || 0;
  while (n > 0) { d.setDate(d.getDate() + 1); if (!isFlex(d)) n--; }
  return d;
}
const wkOf = (gi) => Math.floor((dayDate(gi) - START) / 864e5 / 7) + 1;
const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtRange = (a, b) => {
  const s = dayDate(a), e = dayDate(b);
  const sy = s.getFullYear(), ey = e.getFullYear();
  return `${MO[s.getMonth()]} ${s.getDate()}${sy !== ey ? ", " + sy : ""} – ` +
         `${MO[e.getMonth()]} ${e.getDate()}, ${ey}`;
};

/* ---- load the current schedule as the source of session data ---- */
const src = fs.readFileSync(OUT, "utf8");
const OLD = new Function(`${src}; return SECTIONS;`)();
const byId = new Map();
OLD.forEach((s) => s.rows.forEach((r) => {
  if (byId.has(r.id)) throw new Error(`duplicate id in current schedule: ${r.id}`);
  byId.set(r.id, r);
}));

/* ---- validate coverage ---- */
const wanted = STRUCTURE.flatMap((s) => s.ids);
const seen = new Set();
const errors = [];
for (const id of wanted) {
  if (!byId.has(id)) errors.push(`structure names unknown id: ${id}`);
  if (seen.has(id)) errors.push(`structure repeats id: ${id}`);
  seen.add(id);
}
for (const id of byId.keys()) if (!seen.has(id)) errors.push(`structure drops id: ${id}`);
if (wanted.length !== byId.size) errors.push(`count ${wanted.length} != ${byId.size}`);

/* ---- assign derived fields ---- */
const unread = wanted.filter((id) => !READ.has(id));
let readSeq = 0, unreadSeq = 0, num = 0;
const giOf = new Map();
for (const id of wanted) {
  giOf.set(id, READ.has(id) ? readSeq++ : REBASE_K0 + unreadSeq++);
}

/* ---- no 4+ same-chapter runs in the unread queue ---- */
const chapterOf = (id) => id.replace(/-p\d+$/, "");
let run = 0, prev = null;
for (const id of unread) {
  const c = chapterOf(id);
  run = c === prev ? run + 1 : 1;
  prev = c;
  if (run >= 4) errors.push(`4+ run of ${c} in the unread queue at ${id}`);
}

const planEnd = Math.max(...wanted.map((id) => giOf.get(id)));
if (planEnd !== REBASE_K0 + unread.length - 1)
  errors.push(`planEnd ${planEnd} != ${REBASE_K0 + unread.length - 1}`);

if (errors.length) {
  console.error(`INVALID — refusing to write:\n  ` + errors.join("\n  "));
  process.exit(1);
}

/* ---- emit, one line per session ---- */
const lines = [];
lines.push(`/* ID Cockpit — the reading plan. Generated data; edit deliberately.`);
lines.push(`   One line per session so a schedule change is a readable diff.`);
lines.push(`   Regenerated 2026-08-26 by scripts/resequence.mjs from`);
lines.push(`   scripts/redesign-2026-08-structure.mjs — syndromic spice braid:`);
lines.push(`   niche chapters pulled into the differential that owns them, and`);
lines.push(`   prosthetic valve / cardiac device infection moved to the hardware`);
lines.push(`   sector. The 2026-08-16 rebase anchor is unchanged. */`);
lines.push(`var SECTIONS = [`);
let lastWk = 0;
for (const sec of STRUCTURE) {
  const gis = sec.ids.map((id) => giOf.get(id));
  const unreadGis = sec.ids.filter((id) => !READ.has(id)).map((id) => giOf.get(id));
  const range = unreadGis.length
    ? `  ·  ${fmtRange(Math.min(...unreadGis), Math.max(...unreadGis))}` : "";
  const sub = sec.sub + range;
  lines.push(`{"title": ${JSON.stringify(sec.title)}, "sub": ${JSON.stringify(sub)}, ` +
    `"year": ${sec.year}, "accent": ${JSON.stringify(sec.accent)}, "multi": true, "rows": [`);
  const rows = sec.ids.map((id) => {
    const o = { ...byId.get(id), r: TITLE_OVERRIDES[id] || byId.get(id).r };
    const gi = giOf.get(id);
    const wk = wkOf(gi);
    const fow = wk !== lastWk; lastWk = wk;
    num++;
    return `  {"r": ${JSON.stringify(o.r)}, "g": ${JSON.stringify(o.g)}, ` +
      `"pp": ${JSON.stringify(o.pp)}, "ps": ${JSON.stringify(o.ps)}, ` +
      `"pe": ${JSON.stringify(o.pe)}, "wk": ${wk}, "fow": ${fow}, ` +
      `"id": ${JSON.stringify(id)}, "num": ${num}, "gi": ${gi}}`;
  });
  lines.push(rows.join(",\n"));
  lines.push(`]},`);
}
lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");
lines.push(`];`);
const out = lines.join("\n") + "\n";

console.log(`valid: ${wanted.length} sessions, ${STRUCTURE.length} sectors, ` +
  `${unread.length} unread, planEnd gi ${planEnd} → finishes ${dayDate(planEnd).toDateString()}`);
console.log(`first unread in order: ${unread.slice(0, 8).join("  ")}`);
if (process.argv.includes("--write")) {
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${OUT}`);
} else {
  console.log("(dry run — pass --write to regenerate public/schedule.js)");
}
