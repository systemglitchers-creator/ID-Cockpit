// api/push.js — the evening-nudge subscription.
//
// GET    → { publicKey } the client subscribes with (VAPID public key).
// POST   → { subscription } stores it. Single-user app: one record; a new
//          device's subscription simply replaces the old one.
// DELETE → forgets it (the toggle turned off).
const { getPushSub, setPushSub, delPushSub } = require("./_kv.js");

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
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
    res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY || null,
                           subscribed: !!(await getPushSub().catch(() => null)) });
    return;
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const sub = body && body.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys) {
      res.status(400).json({ error: "bad subscription" });
      return;
    }
    try {
      await setPushSub(sub);
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("push subscribe failed", e);
      res.status(502).json({ error: "store unavailable" });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      await delPushSub();
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("push unsubscribe failed", e);
      res.status(502).json({ error: "store unavailable" });
    }
    return;
  }

  res.status(405).json({ error: "GET, POST or DELETE only" });
};
