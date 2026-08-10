/* Loads the real public/ browser files under node with just enough DOM to get
   through their top-level setup. No build step, no dependencies — the app stays
   plain <script> tags. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Freeze the clock inside the sandbox. Date with arguments still behaves. */
function fixedDateClass(nowMs) {
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() { return nowMs; }
  };
}

function fakeElement() {
  const el = {
    style: {}, dataset: {}, value: "", textContent: "", innerHTML: "", children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    },
    addEventListener() {}, removeEventListener() {}, appendChild() {},
    scrollIntoView() {}, focus() {}, click() {}, closest() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
  };
  return el;
}

function fakeLocalStorage(seed) {
  const m = new Map(seed ? Object.entries(seed) : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
}

/**
 * Load the app into a fresh sandbox.
 * @returns the sandbox, with every top-level function of the app on it
 */
export function loadApp(opts = {}) {
  const hostname = opts.hostname ?? "tyler.github.io";
  const els = new Map();
  const document = {
    body: fakeElement(),
    documentElement: { clientWidth: 1200, style: {} },
    getElementById(id) {
      if (!els.has(id)) els.set(id, fakeElement());
      return els.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return fakeElement(); },
    addEventListener() {}
  };
  const sandbox = {
    console,
    document,
    location: { hostname, pathname: "/phone/", protocol: "https:", href: "https://" + hostname + "/phone/" },
    localStorage: fakeLocalStorage(opts.storage),
    navigator: { onLine: true },
    // motion.js needs both. Without them the app throws on load — the same
    // way it did when copy.js was added to the page but not to this list.
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    // Gist traffic only. A test that hits this wanted a stub and didn't set one.
    fetch: opts.fetch || (() => Promise.reject(new Error("unexpected network call"))),
    setTimeout, clearTimeout, setInterval, clearInterval,
    // No Object/Array/etc here on purpose: the vm realm supplies its own, and
    // values that cross back are not prototype-identical to the host's. Use
    // Array.from / spread in assertions rather than deepStrictEqual on them.
    _elements: els
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.addEventListener = () => {};
  if (opts.now != null) sandbox.Date = fixedDateClass(new Date(opts.now).getTime());
  vm.createContext(sandbox);

  const dir = path.join(ROOT, opts.dir ?? "public");
  const files = opts.files ?? ["schedule.js", "sync.js", "copy.js", "motion.js", "app.js"];
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox;
}

/**
 * Load the current app (public/), optionally with the clock frozen and some
 * sessions already marked read.
 * @param {object} opts  {now, done: string[], doneAt}
 */
export function loadCurrentApp(opts = {}) {
  // Progress has to be in storage before the scripts run: app.js snapshots it
  // into a closure at load time, exactly as a real page load would.
  const iso = opts.doneAt ?? new Date(opts.now ?? Date.now()).toISOString();
  const sessions = {};
  for (const id of opts.done ?? []) sessions[id] = { done: true, doneAt: iso, updatedAt: iso };
  return loadApp({
    dir: "public",
    files: ["schedule.js", "sync.js", "copy.js", "motion.js", "app.js"],
    now: opts.now,
    fetch: opts.fetch,
    storage: { "idcockpit.v1.state": JSON.stringify({ sessions }) }
  });
}


/** Set read-state directly and recompute, without going through a backend. */
export function markDone(app, ids, doneAt) {
  const iso = doneAt || new Date().toISOString();
  for (const id of ids) app.STATUS.done[id] = { done: true, doneAt: iso, updatedAt: iso };
}
