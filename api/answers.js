// api/answers.js — durable home for Bank answer-state.
//
// GET  -> the stored { cqid: {result, ts, ...} } map.
// POST -> merge the client's map into the stored one, return the result.
//
// Merge-only, deliberately. Like read-state, the client cannot express deletion:
// a browser that has lost its local storage would otherwise open showing zero,
// save that, and wipe months of answered questions. Un-answering is expressed as
// a newer entry, never an absent one.
const { getAnswers, setAnswers } = require("./_kv.js");

function mergeAnswers(stored, incoming) {
  const out = { ...(stored || {}) };
  for (const [cqid, rec] of Object.entries(incoming || {})) {
    if (!rec || typeof rec !== "object") continue;
    const prev = out[cqid];
    if (!prev || Number(rec.ts || 0) >= Number(prev.ts || 0)) out[cqid] = rec;
  }
  return out;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return null; } }
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try { res.status(200).json({ answers: await getAnswers() }); }
    catch (e) { console.error("answers read failed", e); res.status(502).json({ error: "store unavailable" }); }
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST only" }); return; }

  const body = await readBody(req);
  if (!body || typeof body.answers !== "object" || body.answers === null || Array.isArray(body.answers)) {
    res.status(400).json({ error: "expected {answers: {...}}" }); return;
  }
  try {
    const merged = mergeAnswers(await getAnswers(), body.answers);
    await setAnswers(merged);
    res.status(200).json({ answers: merged });
  } catch (e) {
    console.error("answers write failed", e);
    res.status(502).json({ error: "store unavailable" });
  }
};
module.exports.mergeAnswers = mergeAnswers;
