/* ID Cockpit — app logic for the berry/editorial redesign.
   The data contract is unchanged: SECTIONS from schedule.js, progress through
   IDStore/IDSync in sync.js. Only the presentation layer is new. */
(function () {
  "use strict";

  var DAY = 864e5;
  var START = new Date(2026, 5, 22);
  var FLEX_START = new Date(2026, 6, 18);
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var RANKS = ["Initiate", "Junior Resident", "Senior Resident", "ID Fellow",
               "Senior Fellow", "Chief Fellow", "Attending", "Consultant"];
  var PAGES_PER_LEVEL = 200;

  /* ---- study-day calendar (ported verbatim from the original cockpit.js) ---- */
  function isFlex(d) { return d.getDay() === 6 && d >= FLEX_START; }
  function dayDate(gi) {
    var d = new Date(START), n = gi || 0;
    while (n > 0) { d.setDate(d.getDate() + 1); if (!isFlex(d)) n--; }
    return d;
  }
  function studyIdx(when) {
    var t = new Date(when); t.setHours(0, 0, 0, 0);
    var d = new Date(START), i = 0;
    while (d < t) { d.setDate(d.getDate() + 1); if (!isFlex(d)) i++; }
    return i;
  }
  function fmtD(d) { return WD[d.getDay()] + " " + MO[d.getMonth()] + " " + d.getDate(); }
  function dayKey(d) { return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }

  /* ---- title parsing ---- */
  function chapNum(t) { var m = /^\s*(?:Chapter\s+)?(\d+)/.exec(t || ""); return m ? m[1] : ""; }
  function partOf(t) { var m = /·\s*(Part \d+ of \d+)/.exec(t || ""); return m ? m[1] : "Whole chapter"; }
  function cleanTitle(t) {
    return String(t || "").replace(/\s+·\s*Part.*$/, "")
      .replace(/^\s*(?:Chapter\s+)?\d+\s*[—–-]\s*/, "").trim();
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  // Per-sector hue for a sector that is merely started (handoff: Assets).
  function sectorHue(i) { return "oklch(0.615 0.128 " + (28 + (i * 19) % 58) + ")"; }

  var SECS = (typeof SECTIONS !== "undefined" && SECTIONS) || [];
  var ACC = "#9c4f6b";

  /* ---- state ---- */
  var sessions = {};      // id -> {done, doneAt, updatedAt}
  var tab = "today";
  var sheetSi = null;     // open sector sheet index, or null
  var query = "";
  var M = null;           // last computed model

  function isDone(id) { var e = sessions[id]; return !!(e && e.done); }
  function doneAt(id) { var e = sessions[id]; return e && e.doneAt ? new Date(e.doneAt) : null; }

  /* ---- persistence -------------------------------------------------------
     Optimistic local echo first so the UI repaints immediately, then the
     write and one debounced gist push for the whole batch. */
  function setDone(ids, done) {
    var now = new Date().toISOString();
    ids.forEach(function (id) { sessions[id] = { done: !!done, doneAt: done ? now : null, updatedAt: now }; });
    render();
    try {
      ids.forEach(function (id) { window.IDStore.setEntry(id, done); });
      window.IDSync.schedulePush();
    } catch (e) { toast("Not saved — will retry on reload"); }
  }
  function loadFromStore() {
    try { sessions = window.IDStore.getState().sessions || {}; }
    catch (e) { sessions = {}; }
  }

  /* ---- derive everything from SECTIONS + sessions ---- */
  function compute() {
    var now = new Date(), todayIdx = studyIdx(Date.now()), todayKey = dayKey(now);
    var pagesTotal = 0, pagesDone = 0, sessTotal = 0, sessDone = 0, planEnd = 0, readToday = false;

    SECS.forEach(function (s) { s.rows.forEach(function (r) {
      pagesTotal += r.pp; sessTotal++;
      if (r.gi > planEnd) planEnd = r.gi;
      if (isDone(r.id)) {
        pagesDone += r.pp; sessDone++;
        var d = doneAt(r.id); if (d && dayKey(d) === todayKey) readToday = true;
      }
    }); });

    // Remaining sessions are dealt onto consecutive study days starting today
    // (tomorrow if something was already read today).
    var EFF = {}, k = todayIdx + (readToday ? 1 : 0);
    var firstOpen = null, firstOpenSec = 0, upcoming = [];
    SECS.forEach(function (s, si) { s.rows.forEach(function (r) {
      if (isDone(r.id)) return;
      if (!firstOpen) { firstOpen = r; firstOpenSec = si; }
      else if (upcoming.length < 3) upcoming.push({ r: r, si: si });
      EFF[r.id] = k++;
    }); });
    var remaining = sessTotal - sessDone;
    var drift = remaining > 0 ? Math.round((dayDate(k - 1) - dayDate(planEnd)) / DAY) : 0;

    // streak — consecutive study days back from today with at least one read
    var readDays = {};
    SECS.forEach(function (s) { s.rows.forEach(function (r) {
      var d = doneAt(r.id); if (d) readDays[dayKey(d)] = true;
    }); });
    var streak = 0, cur = new Date(now);
    if (!readDays[dayKey(cur)]) cur.setDate(cur.getDate() - 1);
    while (true) {
      if (isFlex(cur)) { cur.setDate(cur.getDate() - 1); continue; }
      if (!readDays[dayKey(cur)]) break;
      streak++; cur.setDate(cur.getDate() - 1);
    }

    var secs = SECS.map(function (s, si) {
      var tot = s.rows.length;
      var dn = s.rows.filter(function (r) { return isDone(r.id); }).length;
      var pp = 0, ppd = 0;
      s.rows.forEach(function (r) { pp += r.pp; if (isDone(r.id)) ppd += r.pp; });
      var complete = tot > 0 && dn === tot;
      return { si: si, s: s, tot: tot, dn: dn, pp: pp, ppd: ppd, complete: complete,
               pct: tot ? Math.round(dn / tot * 100) : 0, frac: tot ? dn / tot : 0 };
    });
    var earned = secs.filter(function (x) { return x.complete; }).length;

    var level = Math.floor(pagesDone / PAGES_PER_LEVEL) + 1;
    var intoLevel = pagesDone % PAGES_PER_LEVEL;

    return {
      now: now, todayIdx: todayIdx, EFF: EFF, secs: secs, earned: earned,
      pagesTotal: pagesTotal, pagesDone: pagesDone, sessTotal: sessTotal, sessDone: sessDone,
      pctAll: pagesTotal ? Math.round(pagesDone / pagesTotal * 100) : 0,
      remaining: remaining, drift: drift, streak: streak, readDays: readDays,
      level: level, intoLevel: intoLevel,
      rankName: RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))],
      firstOpen: firstOpen, firstOpenSec: firstOpenSec, upcoming: upcoming
    };
  }

  /* ---- small helpers for markup ---- */
  function $(id) { return document.getElementById(id); }
  function conic(col, pct, track) { return "background:conic-gradient(" + col + " " + pct + "%, " + track + " 0)"; }

  /* ---- header ---- */
  function renderHeader() {
    var m = M, h;
    if (tab === "path")       h = { e: "The two-year path", t: "Sectors", r: m.earned + " of " + m.secs.length + " cleared" };
    else if (tab === "find")  h = { e: "The whole plan", t: "Find a chapter", r: m.sessTotal + " sessions" };
    else if (tab === "stats") h = { e: "Where you stand", t: "Progress", r: m.pagesDone + " pages read" };
    else h = { e: fmtD(m.now).toUpperCase(),
               t: m.streak > 1 ? m.streak + "-day streak" : "Good morning",
               r: m.remaining + " sessions left" };
    $("hEyebrow").textContent = h.e;
    $("hTitle").textContent = h.t;
    $("hMeta").textContent = h.r;
  }

  /* ---- Today ---- */
  function renderToday() {
    var m = M;

    var pips = "";
    for (var i = 6; i >= 0; i--) {
      var d = new Date(m.now); d.setDate(d.getDate() - i);
      var hit = !!m.readDays[dayKey(d)];
      pips += '<div class="d"><span class="dl">' + WD[d.getDay()][0] + '</span>'
            + '<div class="pip' + (hit ? " hit" : "") + (i === 0 ? " today" : "") + '"></div></div>';
    }
    $("streakRow").innerHTML = pips;

    var intoPct = Math.round(m.intoLevel / PAGES_PER_LEVEL * 100);
    $("levelCard").innerHTML =
      '<div class="level">'
      + '<div class="ring" style="' + conic(ACC, intoPct, "var(--track)") + '">'
      +   '<div class="inner"><span class="lvl">' + m.level + '</span></div></div>'
      + '<div class="mid">'
      +   '<div class="baseline"><span class="rank">' + esc(m.rankName) + '</span>'
      +     '<span class="xplab">' + m.pagesDone + ' / ' + m.pagesTotal + ' pp</span></div>'
      +   '<div class="bar"><i style="width:' + (m.pagesTotal ? m.pagesDone / m.pagesTotal * 100 : 0) + '%"></i></div>'
      +   '<div class="note">' + (PAGES_PER_LEVEL - m.intoLevel) + ' pages to level ' + (m.level + 1) + '</div>'
      + '</div></div>';

    var q = m.firstOpen;
    if (q) {
      $("questCard").innerHTML =
        '<div class="quest">'
        + '<div class="baseline"><span class="qk">Today\'s quest</span>'
        +   '<span class="qp">pp ' + q.ps + '–' + q.pe + ' · ' + q.pp + ' pages</span></div>'
        + '<div class="qc">Chapter ' + esc(chapNum(q.r)) + ' · ' + esc(partOf(q.r)) + '</div>'
        + '<div class="qt">' + esc(cleanTitle(q.r)) + '</div>'
        + (q.g ? '<div class="chip">' + esc(q.g) + '</div>' : '')
        + '<div class="qacts">'
        +   '<button class="go" data-mark="' + esc(q.id) + '">Mark as read</button>'
        +   '<button class="alt" data-sector="' + m.firstOpenSec + '">Sector</button>'
        + '</div></div>';
    } else {
      $("questCard").innerHTML =
        '<div class="quest"><div class="qk">Curriculum complete</div>'
        + '<div class="qt">Every page read — onward to the exam.</div></div>';
    }

    $("upNext").innerHTML = m.upcoming.map(function (u) {
      return '<div class="unrow" data-sector="' + u.si + '">'
        + '<span class="n">' + u.r.num + '</span>'
        + '<div style="flex:1;min-width:0"><div class="t">' + esc(cleanTitle(u.r.r)) + '</div>'
        + '<div class="m">Ch ' + esc(chapNum(u.r.r)) + ' · ' + esc(partOf(u.r.r)) + ' · ' + u.r.pp + ' pages</div>'
        + '</div></div>';
    }).join("");
  }

  /* ---- Path ---- */
  function renderPath() {
    var m = M, last = m.secs.length - 1;
    $("pathList").innerHTML = m.secs.map(function (x, si) {
      var complete = x.complete;
      var active = si === m.firstOpenSec && !complete;
      var started = x.dn > 0 && !complete;
      var ringCol = complete ? "var(--gold)" : (active ? ACC : (started ? sectorHue(si) : "#d6c2ce"));
      var connCol = complete ? "var(--gold)" : (x.dn > 0 ? ACC : "var(--pip)");
      var cls = complete ? "complete" : (active ? "active" : (started ? "started" : "locked"));
      return '<div class="pnode ' + cls + '" data-sector="' + si + '">'
        + '<div class="pwrap">'
        +   (si === last ? "" : '<div class="conn" style="background:' + connCol + '"></div>')
        +   (active ? '<div class="halo"></div>' : "")
        +   '<div class="ring" style="' + conic(ringCol, x.pct, "var(--node-track)") + '">'
        +     '<div class="inner"><span class="pct' + (complete ? " done" : "") + '" style="color:' + ringCol + '">'
        +     (complete ? "✓" : x.pct + "%") + '</span></div></div>'
        + '</div>'
        + '<div class="plab"><div class="t">' + esc(x.s.title) + '</div>'
        +   '<div class="m">' + (complete ? "Complete · " + x.tot + " sessions" : x.dn + " of " + x.tot + " read") + '</div>'
        + '</div></div>';
    }).join("");
  }

  /* ---- Find ---- */
  function renderFind() {
    var m = M, q = query.trim().toLowerCase(), out = $("findResults");
    if (!q) {
      out.innerHTML = '<div class="empty">Search by topic, organism, or chapter number.<br>'
        + 'Marking a chapter read credits it wherever it sits in the plan — the rest re-flows.</div>';
      return;
    }
    var order = [], byChap = {};
    SECS.forEach(function (s) { s.rows.forEach(function (r) {
      var hay = (r.r + " " + (r.g || "") + " " + s.title).toLowerCase();
      if (hay.indexOf(q) === -1 && chapNum(r.r).indexOf(q) !== 0) return;
      var c = chapNum(r.r);
      if (!byChap[c]) { byChap[c] = { chap: "Chapter " + c, title: cleanTitle(r.r), sec: s.title, rows: [] }; order.push(byChap[c]); }
      byChap[c].rows.push(r);
    }); });

    if (!order.length) {
      out.innerHTML = '<div class="empty">Nothing in the plan matches that.<br>Try a chapter number, or an organism.</div>';
      return;
    }

    out.innerHTML = order.map(function (g) {
      var allDone = g.rows.every(function (r) { return isDone(r.id); });
      var pages = g.rows.reduce(function (a, r) { return a + r.pp; }, 0);
      var ids = g.rows.map(function (r) { return r.id; }).join(",");
      return '<div class="grp">'
        + '<div class="gk">' + esc(g.chap) + '</div>'
        + '<div class="gt">' + esc(g.title) + '</div>'
        + '<div class="gm">' + esc(g.sec) + ' · ' + g.rows.length + ' session' + (g.rows.length > 1 ? "s" : "") + ' · ' + pages + ' pages</div>'
        + '<div class="grows">' + g.rows.map(function (r) {
            var ck = isDone(r.id);
            return '<div class="grow' + (ck ? " done" : "") + '" data-toggle="' + esc(r.id) + '">'
              + '<div class="box' + (ck ? " on" : "") + '">' + (ck ? "✓" : "") + '</div>'
              + '<div style="flex:1;min-width:0"><div class="p">' + esc(partOf(r.r)) + '</div>'
              + '<div class="s">pp ' + r.ps + '–' + r.pe + ' · ' + r.pp + ' pages</div></div></div>';
          }).join("") + '</div>'
        + '<button class="gall' + (allDone ? " undo" : "") + '" data-markall="' + esc(ids) + '" data-done="' + (allDone ? "0" : "1") + '">'
        + (allDone ? "Un-read this chapter" : "Mark whole chapter read") + '</button>'
        + '</div>';
    }).join("");
  }

  /* ---- Stats ---- */
  function renderStats() {
    var m = M;
    var driftTxt = m.drift === 0 ? "on track"
      : (m.drift > 0 ? m.drift + " days behind" : Math.abs(m.drift) + " days ahead");
    var driftCls = m.drift > 0 ? " behind" : (m.drift < 0 ? " ahead" : "");
    $("statSummary").innerHTML =
      '<div class="summary">'
      + '<div class="ring" style="' + conic(ACC, m.pctAll, "var(--track)") + '">'
      +   '<div class="inner"><div style="text-align:center">'
      +   '<div class="big">' + m.pctAll + '%</div><div class="cap">read</div></div></div></div>'
      + '<div class="lines">'
      +   '<div class="baseline"><span class="l">Sessions read</span><span class="v">' + m.sessDone + ' / ' + m.sessTotal + '</span></div>'
      +   '<div class="baseline"><span class="l">Pages mastered</span><span class="v">' + m.pagesDone + '</span></div>'
      +   '<div class="baseline"><span class="l">Current streak</span><span class="v' + (m.streak > 0 ? " streak" : "") + '">' + m.streak + (m.streak === 1 ? " day" : " days") + '</span></div>'
      +   '<div class="baseline"><span class="l">Versus plan</span><span class="v' + driftCls + '">' + driftTxt + '</span></div>'
      + '</div></div>';

    $("badgeLabel").textContent = "Sector badges · " + m.earned + " of " + m.secs.length;
    $("badges").innerHTML = m.secs.map(function (x) {
      var label = x.s.title.replace(/\s*—.*$/, "").split(/\s*&\s*|,\s*/)[0].split(" ").slice(0, 2).join(" ");
      return '<span class="badge' + (x.complete ? " got" : "") + '" data-sector="' + x.si + '">' + esc(label) + '</span>';
    }).join("");

    $("sectorBars").innerHTML = m.secs.map(function (x) {
      var pct = x.frac * 100;
      return '<div class="sbrow" data-sector="' + x.si + '">'
        + '<div class="baseline"><span class="t">' + esc(x.s.title) + '</span>'
        +   '<span class="c">' + x.dn + '/' + x.tot + '</span></div>'
        + '<div class="bar"><i class="' + (pct === 100 ? "full" : "") + '" style="width:' + pct + '%"></i></div></div>';
    }).join("");
  }

  /* ---- Sector sheet ---- */
  function renderSheet() {
    var el = $("sheet");
    if (sheetSi == null) { el.classList.remove("on"); return; }
    var m = M, x = m.secs[sheetSi], s = x.s;
    $("sheetTitle").textContent = s.title;
    $("sheetSub").textContent = s.sub;
    $("sheetBar").style.width = (x.frac * 100) + "%";
    $("sheetBar").style.background = ACC;
    $("sheetRows").innerHTML = s.rows.map(function (r) {
      var ck = isDone(r.id), d = doneAt(r.id), eff = m.EFF[r.id];
      var todaySlot = eff === m.todayIdx;
      var dt = ck ? ("Read " + (d ? fmtD(d) : ""))
                  : (eff != null ? (todaySlot ? "Today" : fmtD(dayDate(eff))) : "");
      var dtCls = ck ? "read" : (todaySlot ? "today" : "");
      var part = partOf(r.r);
      return '<div class="srow' + (ck ? " done" : "") + '" data-toggle="' + esc(r.id) + '">'
        + '<div class="box' + (ck ? " on" : "") + '">' + (ck ? "✓" : "") + '</div>'
        + '<div style="flex:1;min-width:0">'
        +   '<div class="t">' + esc(cleanTitle(r.r) + (part === "Whole chapter" ? "" : " · " + part)) + '</div>'
        +   '<div class="m"><span>Ch ' + esc(chapNum(r.r)) + ' · pp ' + r.ps + '–' + r.pe + '</span>'
        +     '<span class="dt ' + dtCls + '">' + esc(dt) + '</span></div>'
        +   (r.g ? '<div class="chip">' + esc(r.g) + '</div>' : '')
        + '</div></div>';
    }).join("");
    el.classList.add("on");
  }

  /* ---- render ---- */
  function render() {
    M = compute();
    renderHeader();
    ["today", "path", "find", "stats"].forEach(function (t) {
      $("v-" + t).classList.toggle("on", t === tab);
    });
    Array.prototype.forEach.call($("tabs").children, function (b) {
      b.classList.toggle("on", b.dataset.tab === tab);
    });
    if (tab === "today") renderToday();
    else if (tab === "path") renderPath();
    else if (tab === "find") renderFind();
    else if (tab === "stats") renderStats();
    renderSheet();
  }

  /* ---- events ---- */
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (!b) return;
    tab = b.dataset.tab; sheetSi = null;
    $("body").scrollTop = 0;
    render();
    if (tab === "find") $("findInput").focus();
  });

  function onActivate(e) {
    var mark = e.target.closest("[data-mark]");
    if (mark) { setDone([mark.dataset.mark], true); return; }
    var all = e.target.closest("[data-markall]");
    if (all) { setDone(all.dataset.markall.split(","), all.dataset.done === "1"); return; }
    var tog = e.target.closest("[data-toggle]");
    if (tog) { setDone([tog.dataset.toggle], !isDone(tog.dataset.toggle)); return; }
    var sec = e.target.closest("[data-sector]");
    if (sec) { sheetSi = +sec.dataset.sector; render(); }
  }
  $("body").addEventListener("click", onActivate);
  $("sheet").addEventListener("click", onActivate);

  document.addEventListener("click", function (e) {
    var c = e.target.closest("[data-close]"); if (!c) return;
    if (c.dataset.close === "sheet") { sheetSi = null; renderSheet(); }
    else $(c.dataset.close).classList.remove("on");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("cfgSheet").classList.contains("on")) $("cfgSheet").classList.remove("on");
    else if (sheetSi != null) { sheetSi = null; renderSheet(); }
  });

  $("findInput").addEventListener("input", function (e) {
    query = e.target.value;
    renderFind();
  });

  var toastT = null;
  function toast(t) {
    var el = $("toast"); el.textContent = t; el.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---- sync sheet ---- */
  (function setupSync() {
    var status = $("cfgStatus");
    $("gearBtn").onclick = function () {
      var c = window.IDSync.cfg();
      $("cfgToken").value = c.token || "";
      $("cfgGist").value = c.gistId || "";
      status.textContent = window.IDSync.configured()
        ? "Sync configured." : "Not configured — progress stays on this device.";
      $("cfgSheet").classList.add("on");
    };
    $("cfgSave").onclick = function () {
      window.IDSync.setCfg({ token: $("cfgToken").value.trim(), gistId: $("cfgGist").value.trim() });
      status.textContent = "Saved. Syncing…";
      window.IDSync.syncNow()
        .then(function (ok) { status.textContent = ok ? "Synced ✓" : "Saved (sync unavailable)."; })
        .catch(function () { status.textContent = "Saved, but sync failed — check token/gist."; });
    };
    $("cfgSync").onclick = function () {
      status.textContent = "Syncing…";
      window.IDSync.syncNow()
        .then(function (ok) { status.textContent = ok ? "Synced ✓" : "Nothing to sync."; })
        .catch(function () { status.textContent = "Sync failed — check token/gist."; });
    };
    $("cfgExport").onclick = function () {
      var blob = new Blob([JSON.stringify(window.IDStore.getState(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "id-cockpit-state.json"; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    $("cfgImport").onclick = function () { $("cfgFile").click(); };
    $("cfgFile").onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var data = JSON.parse(rd.result);
          if (!data || typeof data.sessions !== "object") throw new Error("bad");
          window.IDStore.mergeRemote(data.sessions);
          refresh(); window.IDSync.schedulePush();
          status.textContent = "Imported ✓";
        } catch (err) { status.textContent = "Import failed — not a valid state file."; }
      };
      rd.readAsText(f); e.target.value = "";
    };
  })();

  // Called after a sync pull brings in changes made on the other device.
  function refresh() { loadFromStore(); render(); }

  loadFromStore();
  render();
  window.IDSync.start(refresh);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});

  // exposed for the node tests
  window.IDCockpit = { compute: compute, cleanTitle: cleanTitle, partOf: partOf,
                       chapNum: chapNum, dayDate: dayDate, studyIdx: studyIdx, isFlex: isFlex };
})();
