// lib/bank.js — which chapters are owed a drill, and how a drill is scored.
//
// Pure: schedule + progress + bank index + answers in, a list out. Used by
// api/nudge.js. public/app.js carries a copy of every function here with the
// same body (the app has no module loader); tests/js/bank-owed.test.mjs pins
// the two copies equal, so change them together.

/** Every session id whose title starts "Chapter <n>", across all sectors. */
function chapterSessionIds(sections, chapterNumber) {
  var num = String(chapterNumber), ids = [];
  (sections || []).forEach(function (s) {
    (s.rows || []).forEach(function (r) {
      var m = /^Chapter\s+(\d+)/.exec(r.r || "");
      if (m && m[1] === num) ids.push(r.id);
    });
  });
  return ids;
}

/**
 * Chapters that are read but not yet drilled, newest-read first.
 * @param sections  SECTIONS from schedule.js
 * @param progress  id -> {done, doneAt}
 * @param index     qbank/index.json chapters (with `deferred: [cqid]`)
 * @param answers   cqid -> {result, ts, ...}
 * @returns [{chapter, id, title, sector, remaining, total, readAt}]
 */
function owedChapters(sections, progress, index, answers) {
  progress = progress || {}; answers = answers || {};
  var out = [];
  (index || []).forEach(function (c) {
    if (!c.weeks || !c.weeks.length) return;           // catch-alls: available, never demanded
    var ids = chapterSessionIds(sections, String(c.chapter || "").replace(/^Chapter\s+/, ""));
    if (!ids.length) return;
    var readAt = 0;
    for (var i = 0; i < ids.length; i++) {
      var e = progress[ids[i]];
      if (!e || !e.done) return;
      var t = e.doneAt ? new Date(e.doneAt).getTime() : 0;
      if (t > readAt) readAt = t;
    }
    var deferred = {};
    (c.deferred || []).forEach(function (q) { deferred[q] = 1; });
    var ready = (c.cqids || []).filter(function (q) { return !deferred[q]; });
    var remaining = ready.filter(function (q) { var a = answers[q]; return !(a && a.result); });
    if (!remaining.length) return;
    out.push({ chapter: c.chapter, id: c.id, title: c.title, sector: c.sector,
               remaining: remaining.length, total: ready.length, readAt: readAt });
  });
  out.sort(function (a, b) { return b.readAt - a.readAt; });
  return out;
}

/** Marks available for a question: MCQ 1; written = sum of parts, null = 1. */
function marksFor(q) {
  if (q.kind === "mcq") return 1;
  return (q.parts || []).reduce(function (s, p) {
    return s + (p.marks == null ? 1 : Number(p.marks));
  }, 0);
}

/** Marks earned from a full mark and a result string. */
function earnedFrom(full, result) {
  if (result === "got" || result === "correct") return full;
  if (result === "partial") return full / 2;
  return 0;
}

module.exports = { chapterSessionIds, owedChapters, marksFor, earnedFrom };
