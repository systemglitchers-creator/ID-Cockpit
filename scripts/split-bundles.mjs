/* One-off: cut multi-chapter bundled sessions at their real chapter boundaries.

   Why: 34 sessions bundled 2–4 short adjacent chapters under the first
   chapter's id. Every part repeated the whole bundle title, so a part that
   contained only Chapter 176 still advertised "+ Chapter 177 — Poliovirus" —
   a chapter with no pages in that session. 42 chapters had no id of their own
   and could not be found in the app's search.

   Boundaries come from the outline of the 10th-edition PDF, converted to
   printed pages by reading the folio off each chapter's opening page. That
   method was validated against all 257 chapters whose printed start page the
   schedule already knew: 257/257 exact, 0 mismatches. Every derived boundary
   was then checked to fall strictly inside its bundle's page range, and the
   per-chapter spans tile that range exactly.

   Usage: node scripts/split-bundles.mjs [--write]
   Writes public/schedule.js (session data only — resequence.mjs still owns
   order and the derived fields) and scripts/bundle-split-map.json. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "schedule.js");
const MAP = path.join(ROOT, "scripts", "bundle-split-map.json");

/* Printed start page of each chapter that was hidden inside a bundle. */
const HIDDEN_START = JSON.parse(fs.readFileSync(
  path.join(ROOT, "scripts", "hidden-chapter-starts.json"), "utf8"));

/* Guideline tags that sat on the bundle's first session but describe a
   different chapter in it. Keyed by the chapter the tag actually belongs to. */
const TAG_FIX = {
  23: "AAAAI/IDSA penicillin allergy de-labeling",
  190: "Mycoplasma genitalium",
  170: "Rabies post-exposure prophylaxis",
  171: "Ebola / Marburg — VHF protocols",
  292: "Strongyloides",
  293: "Filariae & trichinella",
};
/* Tags that stay with the bundle's lead chapter. */
const TAG_KEEP = new Set([111, 325, 282]);

const src = fs.readFileSync(OUT, "utf8");
const SECTIONS = new Function(`${src}; return SECTIONS;`)();

const baseOf = (r) => r.r.split("  ·  Part")[0];
const chaptersIn = (title) => [...title.matchAll(/Chapter (\d+)/g)].map((m) => +m[1]);

/* Split a page range into n parts of near-equal length, biggest first —
   matches how the existing schedule distributes a chapter across sessions. */
function slice(ps, pe, n) {
  const total = pe - ps + 1;
  const base = Math.floor(total / n), extra = total % n;
  const out = []; let cur = ps;
  for (let i = 0; i < n; i++) {
    const len = base + (i < extra ? 1 : 0);
    out.push([cur, cur + len - 1]);
    cur += len;
  }
  return out;
}

const errors = [];
const map = {};          // old id -> [new ids], in reading order
let split = 0, made = 0;

for (const sec of SECTIONS) {
  const rows = [];
  const handled = new Set();
  for (const r of sec.rows) {
    const base = baseOf(r);
    const chs = chaptersIn(base);
    if (chs.length < 2) { rows.push(r); continue; }
    if (handled.has(base)) continue;      // the bundle's other parts
    handled.add(base);

    const parts = sec.rows.filter((x) => baseOf(x) === base);
    const ps = Math.min(...parts.map((p) => p.ps));
    const pe = Math.max(...parts.map((p) => p.pe));
    const titles = base.split(/\s+\+\s+/).map((s) => s.trim());
    if (titles.length !== chs.length) { errors.push(`title/chapter mismatch: ${base}`); continue; }

    const bounds = chs.map((c, i) => (i === 0 ? ps : HIDDEN_START[c]));
    for (let i = 1; i < bounds.length; i++) {
      if (!(bounds[i] > bounds[i - 1] && bounds[i] <= pe))
        errors.push(`ch${chs[i]} start ${bounds[i]} outside ${ps}-${pe}`);
    }

    split++;
    const produced = [];
    chs.forEach((c, i) => {
      const a = bounds[i];
      const z = i + 1 < bounds.length ? bounds[i + 1] - 1 : pe;
      const pp = z - a + 1;
      /* Fewest parts that keep every session inside the schedule's
         established 3–9pp day. ceil(pp/9) is the minimal such count. */
      const n = Math.max(1, Math.ceil(pp / 9));
      const g = TAG_FIX[c] || (TAG_KEEP.has(c) ? parts[0].g : "");
      slice(a, z, n).forEach(([sa, sz], k) => {
        const title = n > 1 ? `${titles[i]}  ·  Part ${k + 1} of ${n}` : titles[i];
        const row = { r: title, g: k === 0 ? g : "", pp: sz - sa + 1, ps: sa, pe: sz,
                      wk: 0, fow: false, id: `ch${c}-p${k + 1}`, num: 0, gi: 0 };
        produced.push(row); rows.push(row); made++;
      });
    });
    for (const p of parts) map[p.id] = produced.map((x) => x.id);
  }
  sec.rows = rows;
}

/* ---- validate ---- */
const all = SECTIONS.flatMap((s) => s.rows);
const ids = all.map((r) => r.id);
if (new Set(ids).size !== ids.length) {
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  errors.push(`duplicate ids: ${[...new Set(dupes)].join(" ")}`);
}
const paged = all.filter((r) => r.ps != null).sort((a, b) => a.ps - b.ps);
for (let i = 1; i < paged.length; i++) {
  if (paged[i].ps > paged[i - 1].pe + 1)
    errors.push(`page gap ${paged[i - 1].pe + 1}-${paged[i].ps - 1}`);
  if (paged[i].ps <= paged[i - 1].pe)
    errors.push(`page overlap at ${paged[i].id}`);
}
for (const r of all) {
  if (r.ps != null && r.pp !== r.pe - r.ps + 1) errors.push(`pp mismatch on ${r.id}`);
  if (r.ps != null && (r.pp < 3 || r.pp > 9)) errors.push(`${r.id} is ${r.pp}pp — outside the 3–9pp day`);
  if (chaptersIn(baseOf(r)).length > 1) errors.push(`still bundled: ${r.id}`);
}

if (errors.length) {
  console.error("INVALID — refusing to write:\n  " + errors.join("\n  "));
  process.exit(1);
}

console.log(`valid: ${split} bundles -> ${made} per-chapter sessions; ` +
  `${all.length} sessions total, pages contiguous ${paged[0].ps}-${paged[paged.length - 1].pe}`);

/* ---- emit, one line per session (the repo convention) ---- */
const head = src.slice(0, src.indexOf("var SECTIONS = ["));
const lines = [head + "var SECTIONS = ["];
for (const sec of SECTIONS) {
  lines.push(`{"title": ${JSON.stringify(sec.title)}, "sub": ${JSON.stringify(sec.sub)}, ` +
    `"year": ${sec.year}, "accent": ${JSON.stringify(sec.accent)}, "multi": true, "rows": [`);
  lines.push(sec.rows.map((r) =>
    `  {"r": ${JSON.stringify(r.r)}, "g": ${JSON.stringify(r.g)}, ` +
    `"pp": ${JSON.stringify(r.pp)}, "ps": ${JSON.stringify(r.ps)}, ` +
    `"pe": ${JSON.stringify(r.pe)}, "wk": ${r.wk}, "fow": ${r.fow}, ` +
    `"id": ${JSON.stringify(r.id)}, "num": ${r.num}, "gi": ${r.gi}}`).join(",\n"));
  lines.push(`]},`);
}
lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");
lines.push(`];`);

if (process.argv.includes("--write")) {
  fs.writeFileSync(OUT, lines.join("\n") + "\n");
  fs.writeFileSync(MAP, JSON.stringify(map, null, 1));
  console.log(`wrote ${OUT}\nwrote ${MAP}`);
} else {
  console.log("(dry run — pass --write)");
}
