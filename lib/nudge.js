// lib/nudge.js — should tonight's nudge fire, and what should it say?
// Pure: schedule + progress + clock in, {title, body} or null out.
const { tonight, localToday, localDayKey, isFlex } = require("./plan.js");

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

/** One line per owed chapter, at most two, then a "+N more". */
function drillLines(owed) {
  const lines = owed.slice(0, 2).map((c) =>
    String(c.chapter).replace(/^Chapter\s+/, "Ch ") + " · " + c.title + " · " + c.remaining + " to drill");
  if (owed.length > 2) lines.push("+" + (owed.length - 2) + " more chapters to drill");
  return lines;
}

/** Did any grade land today (Halifax-local)? Then the drill reminder can rest. */
function drilledToday(answers, now) {
  const key = localDayKey(new Date(now || Date.now()).toISOString());
  return Object.keys(answers || {}).some((q) => {
    const a = answers[q];
    // A malformed ts must not throw here: bank data can never be allowed to
    // silence the reading nudge. NaN simply does not count as today.
    const t = a && a.result ? Number(a.ts) : NaN;
    return Number.isFinite(t) && localDayKey(new Date(t).toISOString()) === key;
  });
}

/**
 * The nudge for tonight, or null (rest day / nothing to read and nothing owed).
 * @param bank  optional {owed, answers} from api/nudge.js bankState
 */
function compose(sections, progress, now, bank) {
  // Mirrors the reading rule: something graded today earns the evening off.
  const owed = (bank && Array.isArray(bank.owed) && !drilledToday(bank.answers, now))
    ? bank.owed : [];
  const t = tonight(sections, progress, now);
  if (!t) {
    // Reading is done (or finished) — but a read chapter still owes its questions.
    if (!owed.length || isFlex(localToday(now))) return null;
    return {
      title: "Ready to drill · " + owed.length + (owed.length === 1 ? " chapter" : " chapters"),
      body: drillLines(owed).join("\n"),
      badge: owed.length,
    };
  }
  let msg;
  if (t.sessions.length === 1) {
    msg = { title: "Tonight's reading", body: line(t.sessions[0]), badge: 1 };
  } else {
    msg = {
      title: t.sessions.length + " tonight clears the debt",
      body: t.sessions.map((r, i) => (i + 1) + ") " + line(r)).join("\n"),
      badge: t.sessions.length,
    };
  }
  if (owed.length) {
    // The count rides the title so it survives a truncated banner.
    msg.title += " · " + owed.length + " to drill";
    msg.body += "\n" + drillLines(owed).join("\n");
    msg.badge += owed.length;
  }
  return msg;
}

module.exports = { compose, line, drillLines, drilledToday };
