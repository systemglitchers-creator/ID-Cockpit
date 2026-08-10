// api/progress.js — the durable home for read-state.
//
// GET  → the stored session map.
// POST → merge the client's map into the stored one, return the result.
//
// POST deliberately has no "replace" mode. The client cannot express deletion,
// because the failure it prevents is silent and permanent: a phone that has
// lost its local storage opens showing zero, saves that, and a year of reading
// is gone. Un-marking a session still works — it is a newer entry with
// done:false, not an absent one.
const { getProgress, setProgress } = require("./_kv.js");

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;   // Vercel pre-parses JSON
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return null; } }
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); } });
    req.on("error", () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    try {
      res.status(200).json({ sessions: await getProgress() });
    } catch (e) {
      console.error("progress read failed", e);
      res.status(502).json({ error: "store unavailable" });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "GET or POST only" });
    return;
  }

  const { mergeProgress, validateProgress } = await import("../lib/progress-merge.mjs");
  const body = await readBody(req);
  const incoming = body && body.sessions;

  const { errors } = validateProgress(incoming);
  if (errors.length) {
    // 4xx is terminal for the client's retry queue — it drops rather than loops.
    console.error("bad /api/progress body", errors.slice(0, 5));
    res.status(400).json({ error: "bad sessions", detail: errors.slice(0, 5) });
    return;
  }

  try {
    const merged = mergeProgress(await getProgress(), incoming);
    await setProgress(merged);
    res.status(200).json({ sessions: merged });
  } catch (e) {
    console.error("progress write failed", e);
    res.status(502).json({ error: "store unavailable" });
  }
};
