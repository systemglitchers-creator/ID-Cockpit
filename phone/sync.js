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
  global.mergeSessions = mergeSessions;
})(window);
