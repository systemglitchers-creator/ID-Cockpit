/* ID Cockpit service worker — offline shell + font caching. */
var CACHE = "idcockpit-web-v25";
var SHELL = [
  "./", "./index.html", "./schedule.js", "./guidelines.js", "./app.js", "./sync.js", "./copy.js", "./motion.js",
  "./manifest.webmanifest",
  "./icons/icon-192.a37c2970.png", "./icons/icon-512.0cc4f4ab.png",
  "./icons/icon-maskable-512.7639c87b.png", "./icons/apple-touch-icon-180.72faf33d.png",
  "./icons/splash-1179x2556.a2872854.png", "./icons/splash-1290x2796.5f5b9a96.png", "./icons/splash-1170x2532.5dee2dbc.png", "./icons/splash-1284x2778.6b73ff0d.png", "./icons/splash-1125x2436.a88f9bb2.png", "./icons/splash-1242x2688.d539714a.png", "./icons/splash-828x1792.cb7a7b55.png"
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
  // API traffic is never cached. The answers map and the pushed schedule have
  // to be current, not one launch stale — and POSTs were excluded above.
  if (url.origin === self.location.origin && url.pathname.indexOf("/api/") === 0) return;

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

/* ---- the evening nudge (Web Push) ----
   No icon field on purpose: iOS shows the installed app's icon regardless,
   and a hardcoded hashed icon path would go stale on regeneration. */
self.addEventListener("push", function (e) {
  var msg = {};
  try { msg = e.data.json(); } catch (err) {}
  // The badge rides the push, so the icon nags even if the banner is missed.
  if (msg.badge && navigator.setAppBadge) navigator.setAppBadge(msg.badge).catch(function () {});
  e.waitUntil(self.registration.showNotification(msg.title || "ID Cockpit", {
    body: msg.body || "", tag: "idcockpit-nudge"
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      if (list.length) return list[0].focus();
      return clients.openWindow("./");
    }));
});
