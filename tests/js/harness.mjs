/* Loads the real cockpit.js/sync.js/schedule.js under node with just enough
   DOM to get through their top-level setup. No build step, no dependencies —
   the browser files stay plain <script> tags. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "phone");

function fakeElement() {
  const el = {
    style: {}, dataset: {}, value: "", textContent: "", innerHTML: "",
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

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
}

/**
 * Load the app into a fresh sandbox.
 * @returns the sandbox, with every top-level function of cockpit.js on it
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
    localStorage: fakeLocalStorage(),
    navigator: { onLine: true },
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
  vm.createContext(sandbox);

  for (const f of ["schedule.js", "sync.js", "cockpit.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
  }
  return sandbox;
}

/** Set read-state directly and recompute, without going through a backend. */
export function markDone(app, ids, doneAt) {
  const iso = doneAt || new Date().toISOString();
  for (const id of ids) app.STATUS.done[id] = { done: true, doneAt: iso, updatedAt: iso };
}
