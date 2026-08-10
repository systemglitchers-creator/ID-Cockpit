// api/_kv.js — the only place that talks to Redis.
//
// COCKPIT_FAKE_KV=1 swaps in an in-memory store so every other module is
// testable without credentials. Mirrors HARVEST_FAKE_KV in ~/Projects/harvest.
const KEY = "cockpit:schedule";
const fake = new Map();

function isFake() {
  return process.env.COCKPIT_FAKE_KV === "1";
}

function client() {
  const { Redis } = require("@upstash/redis");
  return new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
}

/** The pushed schedule, or null when nothing has been pushed yet. */
async function getSchedule() {
  if (isFake()) return fake.has(KEY) ? fake.get(KEY) : null;
  // Store not connected yet: not an error, just nothing to serve.
  if (!process.env.KV_REST_API_URL) return null;
  const v = await client().get(KEY);
  return v === undefined ? null : v;
}

async function setSchedule(payload) {
  if (isFake()) { fake.set(KEY, payload); return; }
  if (!process.env.KV_REST_API_URL) {
    throw new Error("KV_REST_API_URL is not set — connect the store and run: npx vercel env pull .env.local");
  }
  await client().set(KEY, payload);
}

function __resetFake() { fake.clear(); }

module.exports = { getSchedule, setSchedule, __resetFake, KEY };
