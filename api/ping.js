// api/ping.js — temporary: proves serverless functions deploy beside the static
// site. Deleted once /api/schedule is live.
module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, at: new Date().toISOString() });
};
