// api/nudge.js — the evening nudge, fired by Vercel cron (see vercel.json).
//
// Decides whether tonight deserves a push and sends it: silent on rest days,
// silent once he has read today, honest about doubles. A dead subscription
// (404/410 from the push service) is deleted rather than retried forever.
const { getPushSub, delPushSub, getProgress, getSchedule } = require("./_kv.js");
const { compose } = require("../lib/nudge.js");

/** The live plan: the pushed schedule if one exists, else the deployed bundle. */
async function liveSections(req) {
  const stored = await getSchedule();
  if (stored && Array.isArray(stored.sections) && stored.sections.length) return stored.sections;
  const src = await (await fetch("https://" + req.headers.host + "/schedule.js")).text();
  const g = {};
  new Function("g", src + "\ng.SECTIONS = SECTIONS;")(g);
  return g.SECTIONS;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== "Bearer " + secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const sub = await getPushSub();
    if (!sub) { res.status(200).json({ sent: false, why: "no subscription" }); return; }

    const msg = compose(await liveSections(req), await getProgress(), new Date());
    if (!msg) { res.status(200).json({ sent: false, why: "nothing tonight" }); return; }

    const webpush = require("web-push");
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:systemglitchers@gmail.com",
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    try {
      await webpush.sendNotification(sub, JSON.stringify(msg));
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await delPushSub();
        res.status(200).json({ sent: false, why: "dead subscription removed" });
        return;
      }
      throw e;
    }
    res.status(200).json({ sent: true, title: msg.title });
  } catch (e) {
    console.error("nudge failed", e);
    res.status(502).json({ error: "nudge failed" });
  }
};
