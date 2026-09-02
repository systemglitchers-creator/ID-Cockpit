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

function loadSw(cacheKeys = []) {
  const listeners = {};
  const deleted = [];
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
    caches: {
      open: () => Promise.resolve(cache),
      keys: () => Promise.resolve(cacheKeys),
      delete: (k) => { deleted.push(k); return Promise.resolve(true); },
      match: () => Promise.resolve(undefined)
    },
    fetch: () => Promise.resolve({ status: 200, clone() { return this; } }),
    clients: self.clients, navigator: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8"), sandbox, { filename: "sw.js" });
  listeners.deleted = deleted;
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
  assert.ok(m && Number(m[1]) >= 24, "CACHE must be at least v24");
});

test("the shell precache covers every script index.html loads", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((src) => !/^([a-z]+:)?\/\//i.test(src)); // same-origin only

  const swSrc = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const shellMatch = /var SHELL = \[([\s\S]*?)\];/.exec(swSrc);
  assert.ok(shellMatch, "could not find SHELL array in sw.js");
  const shellEntries = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const shellBasenames = shellEntries.map((e) => e.replace(/^\.\//, ""));

  for (const src of scripts) {
    assert.ok(
      shellBasenames.includes(src),
      `SHELL is missing "${src}" (loaded by index.html but not precached)`
    );
  }
});

test("activate deletes the previous cache", async () => {
  const l = loadSw(["idcockpit-web-v23", "idcockpit-web-v24"]);
  let captured;
  l.activate({ waitUntil(p) { captured = p; } });
  await captured;
  assert.deepEqual(l.deleted, ["idcockpit-web-v23"]);
});
