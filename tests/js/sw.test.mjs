import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

/* The service worker must never answer /api/* from its cache: the answers map
   and the pushed schedule have to be current, not one launch stale. Everything
   else keeps cache-first-then-refresh, which is what gives the question bank
   offline-after-first-open. */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ORIGIN = "https://id-cockpit.vercel.app";

function loadSw() {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() }
  };
  const cache = { match: () => Promise.resolve(undefined), put: () => {}, add: () => Promise.resolve() };
  const sandbox = {
    self, URL, console, setTimeout, clearTimeout,
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true), match: () => Promise.resolve(undefined) },
    fetch: () => Promise.resolve({ status: 200, clone() { return this; } }),
    clients: self.clients, navigator: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8"), sandbox, { filename: "sw.js" });
  return listeners;
}

function fire(listeners, url, method = "GET") {
  let handled = false;
  listeners.fetch({
    request: { method, url, mode: "cors" },
    respondWith() { handled = true; }
  });
  return handled;
}

test("GET /api/answers and /api/schedule go straight to the network", () => {
  const l = loadSw();
  assert.equal(fire(l, ORIGIN + "/api/answers"), false);
  assert.equal(fire(l, ORIGIN + "/api/schedule"), false);
});

test("question files and app code are still handled by the worker", () => {
  const l = loadSw();
  assert.equal(fire(l, ORIGIN + "/qbank/index.json"), true);
  assert.equal(fire(l, ORIGIN + "/qbank/ch82.json"), true);
  assert.equal(fire(l, ORIGIN + "/app.js"), true);
});

test("the cache name was bumped for this change", () => {
  const src = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const m = /var CACHE = "idcockpit-web-v(\d+)"/.exec(src);
  assert.ok(m && Number(m[1]) >= 23, "CACHE must be at least v23");
});
