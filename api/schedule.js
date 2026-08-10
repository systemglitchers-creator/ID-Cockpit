// api/schedule.js — GET only.
//
// 204 means "nothing pushed"; the app then keeps the schedule bundled in
// public/schedule.js, so an empty or unconnected store is not an outage.
const { getSchedule } = require("./_kv.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  let payload;
  try {
    payload = await getSchedule();
  } catch (e) {
    console.error("schedule read failed", e);
    res.status(502).json({ error: "store unavailable" });
    return;
  }
  if (!payload) {
    res.status(204).end();
    return;
  }

  // Validate on the way out as well as on the way in: serving a broken schedule
  // would corrupt the app's whole view of the plan, and the store is writable
  // from outside this code path.
  const { validateSchedule } = await import("../lib/schedule-schema.mjs");
  const { errors } = validateSchedule(payload);
  if (errors.length) {
    console.error("stored schedule is invalid", errors);
    res.status(500).json({ error: "stored schedule is invalid" });
    return;
  }

  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.status(200).json(payload);
};
