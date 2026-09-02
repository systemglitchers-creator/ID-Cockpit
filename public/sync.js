/* ID Cockpit — client persistence + Gist sync. No dependencies. */
(function (global) {
  "use strict";
  var STATE_KEY = "idcockpit.v1.state";
  var GIST_KEY  = "idcockpit.v1.gist";

  function ts(e) { return (e && (e.updatedAt || e.doneAt)) || ""; }

  // Conflict-free union merge: newest timestamp wins per session id.
  function mergeSessions(local, remote) {
    local = local || {}; remote = remote || {};
    var out = {}, ids = {};
    Object.keys(local).forEach(function (k) { ids[k] = 1; });
    Object.keys(remote).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (id) {
      var a = local[id], b = remote[id];
      if (!a) { out[id] = b; }
      else if (!b) { out[id] = a; }
      else { out[id] = ts(b) > ts(a) ? b : a; }
    });
    return out;
  }

  var Store = {
    getState: function () {
      try { var s = JSON.parse(localStorage.getItem(STATE_KEY)); if (s && s.sessions) return s; }
      catch (e) {}
      return { sessions: {} };
    },
    save: function (st) { localStorage.setItem(STATE_KEY, JSON.stringify(st)); },
    setEntry: function (id, done) {
      var st = Store.getState(), now = new Date().toISOString();
      st.sessions[id] = { done: !!done, doneAt: done ? now : null, updatedAt: now };
      Store.save(st);
      return st.sessions[id];
    },
    mergeRemote: function (remoteSessions) {
      var st = Store.getState();
      st.sessions = mergeSessions(st.sessions, remoteSessions || {});
      Store.save(st);
      return st;
    },
    replace: function (sessions) { Store.save({ sessions: sessions || {} }); }
  };

  /* ---- server-backed progress ------------------------------------------------
     The durable copy. localStorage is only a cache now: it survives being
     cleared, moved to a new address, or reinstalled, because the truth is on
     the server.

     One operation does everything. POST sends whatever this device holds; the
     server unions it with the stored copy and returns the result, which becomes
     the new local state. That means a single round trip both uploads and
     downloads, always converges, and can never delete — a device with nothing
     sends nothing and receives everything. */
  var Server = {
    _t: null, _refresh: null, _inflight: false,

    sync: function () {
      if (typeof fetch !== "function" || Server._inflight) return Promise.resolve(false);
      Server._inflight = true;
      return fetch("/api/progress", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessions: Store.getState().sessions })
      })
        .then(function (r) { if (!r.ok) throw new Error("progress " + r.status); return r.json(); })
        .then(function (d) {
          if (!d || typeof d.sessions !== "object") return false;
          // Server response is authoritative: it already contains everything we
          // sent, unioned with everything it held.
          Store.replace(d.sessions);
          if (Server._refresh) Server._refresh();
          return true;
        })
        .catch(function () { return false; })   // offline: local stands, retry later
        .then(function (ok) { Server._inflight = false; return ok; });
    },

    schedule: function () {
      clearTimeout(Server._t);
      Server._t = setTimeout(function () { Server.sync(); }, 1200);
    },

    start: function (refresh) {
      Server._refresh = refresh;
      Server.sync();
      if (global.addEventListener) {
        global.addEventListener("online", function () { Server.sync(); });
        // Coming back to the app is the moment a stale device most needs to catch up.
        global.addEventListener("visibilitychange", function () {
          if (!global.document || global.document.visibilityState === "visible") Server.sync();
        });
      }
    }
  };

  /* ---- Bank answer-state ---------------------------------------------------
     The same contract as Server, for the question bank: localStorage is a
     cache, /api/answers is the truth, and one merge-only round trip both
     uploads and downloads. A grade is complete the moment it is tapped;
     the network is caught up with later. Records are {result, ts, chosen?,
     flag?}; newest ts wins per question on the server, nothing is ever
     deleted, so an empty phone can never erase anything. */
  var ANSWERS_KEY = "idcockpit.v1.answers";
  var Answers = {
    _t: null, _refresh: null, _inflight: false,

    get: function () {
      try {
        var a = JSON.parse(localStorage.getItem(ANSWERS_KEY));
        if (a && typeof a === "object" && !Array.isArray(a)) return a;
      } catch (e) {}
      return {};
    },
    replace: function (map) { localStorage.setItem(ANSWERS_KEY, JSON.stringify(map || {})); },

    /** Merge `patch` into the record for `cqid`, stamp it now, persist, sync. */
    set: function (cqid, patch) {
      var all = Answers.get(), rec = all[cqid] || {};
      Object.keys(patch || {}).forEach(function (k) { rec[k] = patch[k]; });
      rec.ts = Date.now();
      all[cqid] = rec;
      Answers.replace(all);
      Answers.schedule();
      return rec;
    },

    sync: function () {
      if (typeof fetch !== "function" || Answers._inflight) return Promise.resolve(false);
      Answers._inflight = true;
      return fetch("/api/answers", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: Answers.get() })
      })
        .then(function (r) { if (!r.ok) throw new Error("answers " + r.status); return r.json(); })
        .then(function (d) {
          if (!d || typeof d.answers !== "object" || d.answers === null) return false;
          Answers.replace(d.answers);          // server reply is the union; adopt it
          if (Answers._refresh) Answers._refresh();
          return true;
        })
        .catch(function () { return false; })   // offline: local stands, retry later
        .then(function (ok) { Answers._inflight = false; return ok; });
    },

    schedule: function () {
      clearTimeout(Answers._t);
      Answers._t = setTimeout(function () { Answers.sync(); }, 1200);
    },

    start: function (refresh) {
      Answers._refresh = refresh;
      Answers.sync();
      if (global.addEventListener) {
        global.addEventListener("online", function () { Answers.sync(); });
        global.addEventListener("visibilitychange", function () {
          if (!global.document || global.document.visibilityState === "visible") Answers.sync();
        });
      }
    }
  };

  var Sync = {
    _t: null, _refresh: null,
    cfg: function () { try { return JSON.parse(localStorage.getItem(GIST_KEY)) || {}; } catch (e) { return {}; } },
    setCfg: function (c) { localStorage.setItem(GIST_KEY, JSON.stringify(c)); },
    configured: function () { var c = Sync.cfg(); return !!(c.token && c.gistId); },
    _headers: function (c) { return { Authorization: "Bearer " + c.token, Accept: "application/vnd.github+json" }; },
    pull: function () {
      var c = Sync.cfg(); if (!c.token || !c.gistId) return Promise.resolve(false);
      return fetch("https://api.github.com/gists/" + c.gistId, { headers: Sync._headers(c) })
        .then(function (r) { if (!r.ok) throw new Error("gist " + r.status); return r.json(); })
        .then(function (g) {
          var f = g.files && g.files["state.json"];
          if (!f || !f.content) return false;
          var data = JSON.parse(f.content);
          Store.mergeRemote(data.sessions || {});
          return true;
        });
    },
    push: function () {
      var c = Sync.cfg(); if (!c.token || !c.gistId) return Promise.resolve(false);
      var body = { files: { "state.json": { content: JSON.stringify(Store.getState(), null, 2) } } };
      var h = Sync._headers(c); h["Content-Type"] = "application/json";
      return fetch("https://api.github.com/gists/" + c.gistId, { method: "PATCH", headers: h, body: JSON.stringify(body) })
        .then(function (r) { return r.ok; });
    },
    schedulePush: function () {
      if (!Sync.configured()) return;
      clearTimeout(Sync._t);
      Sync._t = setTimeout(function () { Sync.push().catch(function () {}); }, 1500);
    },
    syncNow: function () {
      if (!Sync.configured()) return Promise.resolve(false);
      return Sync.pull().then(function () { if (Sync._refresh) Sync._refresh(); return Sync.push(); });
    },
    start: function (refresh) {
      Sync._refresh = refresh;
      if (!Sync.configured()) return;
      Sync.pull().then(function (ok) { if (ok && refresh) refresh(); }).catch(function () {});
      global.addEventListener("online", function () {
        Sync.pull().then(function (ok) { if (ok && refresh) refresh(); return Sync.push(); }).catch(function () {});
      });
    }
  };

  global.IDStore = Store;
  global.IDSync = Sync;
  global.IDServer = Server;
  global.IDAnswers = Answers;
  global.mergeSessions = mergeSessions;
})(window);
