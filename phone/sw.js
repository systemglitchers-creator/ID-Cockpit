/* ID Cockpit service worker — offline shell + font caching. */
var CACHE = "idcockpit-v3";
var SHELL = [
  "./", "./index.html", "./schedule.js", "./cockpit.js", "./sync.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return c.add(u).catch(function () {}); // tolerate a missing optional asset
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       // never cache API writes
  var url = new URL(req.url);
  if (url.hostname === "api.github.com") return;           // sync traffic: always network

  var isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  var sameOrigin = url.origin === self.location.origin;

  // App code (the HTML/JS itself) is network-first so a deployed update shows up
  // on the next launch instead of a launch later; cache is the offline fallback.
  var isAppCode = sameOrigin && (req.mode === "navigate" || /\.(html|js)$/.test(url.pathname) || url.pathname.endsWith("/"));
  if (isAppCode) {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    }));
    return;
  }

  if (isFont || sameOrigin) {
    // cache-first, refresh in background (stale-while-revalidate)
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.status === 200) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
