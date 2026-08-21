// lib/nudge.js — should tonight's nudge fire, and what should it say?
// Pure: schedule + progress + clock in, {title, body} or null out.
const { tonight } = require("./plan.js");

const clean = (t) => String(t || "")
  .replace(/\s+·\s*Part.*$/, "")
  .replace(/^\s*(?:Chapter\s+)?\d+\s*[—–-]\s*/, "").trim();
const part = (t) => { const m = /·\s*(Part \d+ of \d+)/.exec(t || ""); return m ? m[1] : ""; };
const est = (pp) => Math.max(5, Math.round(pp * 3.5 / 5) * 5);

function line(r) {
  const bits = [clean(r.r)];
  const p = part(r.r); if (p) bits.push(p);
  if (r.ps != null && r.pe != null) bits.push(`pp ${r.ps}–${r.pe} · ~${est(r.pp)} min`);
  return bits.join(" · ");
}

/** The nudge for tonight, or null (rest day / already read / plan done). */
function compose(sections, progress, now) {
  const t = tonight(sections, progress, now);
  if (!t) return null;
  if (t.sessions.length === 1) {
    return { title: "Tonight's reading", body: line(t.sessions[0]), badge: 1 };
  }
  return {
    title: t.sessions.length + " tonight clears the debt",
    body: t.sessions.map((r, i) => (i + 1) + ") " + line(r)).join("\n"),
    badge: t.sessions.length,
  };
}

module.exports = { compose, line };
