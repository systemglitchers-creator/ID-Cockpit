/* ID Study Platform cockpit layer.
   Loads AFTER the schedule's inline script, so its script-scoped globals
   (SECTIONS, done, save, build, refresh) are reachable as lexical globals.
   Everything here is additive: server sync, status badges, a detail panel,
   and a one-time import of legacy localStorage read-state. */
(function () {
  "use strict";

  var STATUS = { done: {}, chapters: {} };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function api(path, opts) {
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  // Build id -> {NN, title, ps, pe} from the plan the page already holds.
  function planIndex() {
    var idx = {};
    if (typeof SECTIONS === "undefined") return idx;
    SECTIONS.forEach(function (s) {
      (s.rows || []).forEach(function (r) {
        // Anchored (like the server's parser). Combo rows that start with a word
        // (e.g. "Antifungal Drugs — Chapter 40 …") intentionally get NN="" / no badge.
        var m = /^(?:Chapter\s+)?(\d+)/.exec((r.r || "").trim());
        idx[r.id] = {
          NN: m ? m[1] : "",
          title: (r.r || "").replace(/\s+·.*$/, "").replace(/^(?:Chapter\s+)?\d+\s*[—-]\s*/, "").trim(),
          ps: r.ps || "", pe: r.pe || r.ps || ""
        };
      });
    });
    return idx;
  }

  var PLAN = {};

  // One-time import of legacy read-state into the server, if server is empty.
  function importLegacyOnce() {
    if (Object.keys(STATUS.done).length > 0) return Promise.resolve();
    var ids = [];
    if (typeof done === "object" && done) ids = Object.keys(done).filter(function (k) { return done[k]; });
    if (!ids.length) return Promise.resolve();
    return api("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids })
    });
  }

  // Reflect server read-state onto the in-page `done` map, then re-render.
  function adoptServerReadState() {
    if (typeof done !== "object" || !done) return;
    Object.keys(done).forEach(function (k) { delete done[k]; });
    Object.keys(STATUS.done).forEach(function (k) {
      if (STATUS.done[k] && STATUS.done[k].done) done[k] = 1;
    });
    if (typeof build === "function") build();
    if (typeof refresh === "function") refresh();
  }

  // Add card/question badges to each rendered row.
  function applyBadges() {
    document.querySelectorAll(".rw").forEach(function (el) {
      if (el.querySelector(".cockpit-badges")) return;
      var info = PLAN[el.dataset.id];
      if (!info || !info.NN) return;
      var c = STATUS.chapters[info.NN] || { cards: 0, questions: 0 };
      var span = document.createElement("span");
      span.className = "cockpit-badges";
      span.innerHTML =
        '<em class="cb cb-c" title="Anki cards">◆ ' + c.cards + "</em>" +
        '<em class="cb cb-q" title="Practice questions">● ' + c.questions + "</em>";
      el.appendChild(span);
    });
  }

  // Wrap the page's save() so every read-toggle also writes through to the server.
  function hookSave() {
    if (typeof save !== "function") return;
    var origSave = save;
    // eslint-disable-next-line no-global-assign
    save = function () {
      origSave();
      var ids = (typeof done === "object" && done) ? Object.keys(done).filter(function (k) { return done[k]; }) : [];
      var serverIds = Object.keys(STATUS.done).filter(function (k) { return STATUS.done[k] && STATUS.done[k].done; });
      var setNow = {};
      ids.forEach(function (id) { setNow[id] = true; });
      ids.forEach(function (id) {
        if (serverIds.indexOf(id) === -1) postDone(id, true);
      });
      serverIds.forEach(function (id) {
        if (!setNow[id]) postDone(id, false);
      });
    };
  }

  function postDone(id, val) {
    STATUS.done[id] = { done: val, doneAt: new Date().toISOString() };
    api("/api/session/" + encodeURIComponent(id) + "/done", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: val })
    }).catch(function () { console.warn("cockpit: failed to sync read-state for", id); });
  }

  // Detail panel with copy-a-prompt buttons.
  function buildPanel() {
    var panel = document.createElement("div");
    panel.id = "cockpit-panel";
    panel.style.cssText =
      "position:fixed;right:0;top:0;bottom:0;width:min(380px,90vw);background:var(--surf2,#1c2726);" +
      "border-left:1px solid var(--line,#26312f);box-shadow:-8px 0 30px rgba(0,0,0,.4);" +
      "padding:22px 20px;transform:translateX(100%);transition:transform .2s ease;z-index:9999;" +
      "color:var(--txt,#eef3f0);font-family:inherit;overflow:auto";
    panel.innerHTML =
      '<button id="cockpit-close" style="float:right;background:none;border:0;color:var(--soft,#a9b6b0);font-size:20px;cursor:pointer">×</button>' +
      '<div id="cockpit-body"></div>';
    document.body.appendChild(panel);
    panel.querySelector("#cockpit-close").onclick = function () { panel.style.transform = "translateX(100%)"; };
    return panel;
  }

  function copyPrompt(action, info) {
    var qs = "action=" + action + "&NN=" + encodeURIComponent(info.NN) +
      "&title=" + encodeURIComponent(info.title) +
      "&ps=" + encodeURIComponent(info.ps) + "&pe=" + encodeURIComponent(info.pe);
    return api("/api/prompt?" + qs).then(function (d) {
      return navigator.clipboard.writeText(d.prompt).then(function () { return d.prompt; });
    });
  }

  function openPanel(panel, id) {
    var info = PLAN[id];
    if (!info) return;
    var c = STATUS.chapters[info.NN] || { cards: 0, questions: 0 };
    var body = panel.querySelector("#cockpit-body");
    body.innerHTML =
      '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint,#748078)">Chapter ' + (info.NN || "—") + "</div>" +
      '<h3 style="margin:6px 0 4px;font-size:16px">' + esc(info.title) + "</h3>" +
      '<div style="color:var(--soft,#a9b6b0);font-size:13px;margin-bottom:16px">pp. ' + info.ps + "–" + info.pe +
      " · ◆ " + c.cards + " cards · ● " + c.questions + " questions</div>" +
      '<button class="cockpit-act" data-act="cards" style="display:block;width:100%;margin:8px 0;padding:11px;border-radius:8px;border:1px solid var(--acc-line,#3a5);background:var(--acc-wash,rgba(79,216,160,.10));color:var(--txt,#eef3f0);cursor:pointer;text-align:left">Copy: make Anki cards →</button>' +
      '<button class="cockpit-act" data-act="questions" style="display:block;width:100%;margin:8px 0;padding:11px;border-radius:8px;border:1px solid var(--acc-line,#3a5);background:var(--acc-wash,rgba(79,216,160,.10));color:var(--txt,#eef3f0);cursor:pointer;text-align:left">Copy: make RC questions →</button>' +
      '<div id="cockpit-toast" style="margin-top:12px;font-size:12px;color:var(--acc,#4fd8a0);min-height:16px"></div>';
    body.querySelectorAll(".cockpit-act").forEach(function (btn) {
      btn.onclick = function () {
        copyPrompt(btn.dataset.act, info).then(function () {
          body.querySelector("#cockpit-toast").textContent = "Copied — paste into Claude Code.";
        }).catch(function () {
          body.querySelector("#cockpit-toast").textContent = "Couldn't copy — check clipboard permissions.";
        });
      };
    });
    panel.style.transform = "translateX(0)";
  }

  // Add an info affordance to each row that opens the panel (without disturbing
  // the existing row-click read-toggle).
  function wirePanel(panel) {
    document.querySelectorAll(".rw").forEach(function (el) {
      if (el.querySelector(".cockpit-info")) return;
      var info = PLAN[el.dataset.id];
      if (!info || !info.NN) return;
      var b = document.createElement("button");
      b.className = "cockpit-info";
      b.textContent = "ⓘ";
      b.title = "Actions";
      b.style.cssText = "margin-left:8px;background:none;border:0;color:var(--faint,#748078);cursor:pointer;font-size:14px";
      b.onclick = function (ev) { ev.stopPropagation(); openPanel(panel, el.dataset.id); };
      var mid = el.querySelector(".mid .rtitle") || el;
      mid.appendChild(b);
    });
  }

  // Idempotent decoration; safe to call after every re-render of #wrap.
  function decorate(panel) {
    applyBadges();
    wirePanel(panel);
  }

  function observeWrap(panel) {
    var wrap = document.getElementById("wrap");
    if (!wrap) return;
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () { scheduled = false; decorate(panel); });
    }).observe(wrap, { childList: true, subtree: true });
  }

  function boot() {
    PLAN = planIndex();
    document.body.classList.add("cockpit-loading");
    api("/api/status").then(function (s) {
      STATUS = s;
      return importLegacyOnce();
    }).then(function () {
      return api("/api/status");
    }).then(function (s) {
      STATUS = s;
      adoptServerReadState();
      hookSave();
      var panel = buildPanel();
      decorate(panel);
      observeWrap(panel);
    }).catch(function (e) {
      console.warn("cockpit: initialization failed", e);
    }).then(function () {
      // Always re-enable interaction, whether boot succeeded or failed.
      document.body.classList.remove("cockpit-loading");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
