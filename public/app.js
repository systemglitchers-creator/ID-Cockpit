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
  // First day a catch-up double may land — two study weeks after the Aug 2026
  // slip, so coming back from time away isn't punished immediately.
  //
  // A fixed date, not "today + 12": a relative window is recomputed on every
  // render, so the first double would recede one day per day and the make-up
  // would never actually come due. Once this date is past, doubles start from
  // the next open day.
  var CATCHUP_FROM = new Date(2026, 7, 23);

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
  // Per-sector hue for a sector that is merely started. Rebased to the green
  // half of the wheel for apothecary — the original 28-86 range was red through
  // yellow, tuned for the berry palette, and would clash here. Not currently
  // visible (no sector is started-but-not-active) which is exactly why it would
  // have shipped unnoticed.
  function sectorHue(i) { return "oklch(0.575 0.085 " + (132 + (i * 19) % 56) + ")"; }

  var SECS = (typeof SECTIONS !== "undefined" && SECTIONS) || [];
  var GL = (typeof GUIDELINES !== "undefined" && GUIDELINES) || {};
  // Read from the stylesheet rather than duplicating it — a second copy of the
  // accent is how a palette swap leaves the old colour behind in one place.
  var ACC = (typeof getComputedStyle === "function"
    ? getComputedStyle(document.documentElement).getPropertyValue("--acc").trim()
    : "") || "#9c4f6b";

  /* ---- dusk mode: the 9pm palette ---- */
  function duskPref() {
    try { return localStorage.getItem("idcockpit.dusk") || "auto"; } catch (e) { return "auto"; }
  }
  function duskActive(now, pref) {
    if (pref === "on") return true;
    if (pref === "off") return false;
    var h = now.getHours();
    return h >= 19 || h < 6;
  }
  function applyTheme(now) {
    var dusk = duskActive(now, duskPref());
    var root = document.documentElement;
    if (root.dataset) root.dataset.theme = dusk ? "dusk" : "";
    // The accent moved with the palette; rings and connectors read it from ACC.
    if (typeof getComputedStyle === "function") {
      ACC = getComputedStyle(root).getPropertyValue("--acc").trim() || ACC;
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dusk ? "#131a15" : "#e9f0e7";
  }

  /* ---- state ---- */
  var sessions = {};      // id -> {done, doneAt, updatedAt}
  var tab = "today";
  var showEarlier = false;   // home stream: past days fold away by default
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
    // A mark from deep in the home stream must not fling the view back to the
    // top — rebuild, then put the scroll back where the thumb was.
    var st = $("body").scrollTop;
    render();
    $("body").scrollTop = st;
    if (done) window.IDMotion.pulse($("statStrip"), "pop");
    try {
      ids.forEach(function (id) { window.IDStore.setEntry(id, done); });
      window.IDSync.schedulePush();
      window.IDServer.schedule();   // the durable copy
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
    //
    // On a day off there is no slot to fill, and studyIdx() has counted only the
    // days before today — so it has handed back the index of the *previous*
    // study day. Left alone, the queue would be dealt from a date that has
    // already passed. Resume on the next study day instead, and don't charge a
    // second day for an opportunistic read on a Saturday.
    var dayOff = isFlex(now);
    var k0 = todayIdx + (dayOff || readToday ? 1 : 0);
    var remaining = sessTotal - sessDone;

    var EFF = {}, perDay = {}, open = [], lastDay = k0;
    function deal(r, si, d, x) {
      EFF[r.id] = d;
      perDay[d] = (perDay[d] || 0) + 1;
      if (d > lastDay) lastDay = d;
      open.push({ r: r, si: si, d: d, x: x, n: open.length });
    }

    // Pinned second readings. A session flagged `extra` is dealt on its own day
    // (its gi) as a second row and never enters the queue — how two short
    // chapters share a day, or a missed week is folded onto fixed days, without
    // the packing model's rolling doubles. While its day is still to come it is
    // simply the plan; once the day has passed unread it lands on the next study
    // day and is owed. Reading the day's regular row does not push it: the point
    // of the day is that both get read.
    var nextDay = todayIdx + (dayOff ? 1 : 0), extras = 0, overdue = 0;
    SECS.forEach(function (s, si) { s.rows.forEach(function (r) {
      if (!r.extra || isDone(r.id)) return;
      deal(r, si, Math.max(r.gi, nextDay), 1);
      extras++;
      if (r.gi < nextDay) overdue++;
    }); });
    var queued = remaining - extras;

    // Catch-up. Rather than let missed days push the finish date out, the
    // queued sessions are packed into the study days still available before
    // the plan's *original* end: on track that is exactly one a day, and behind
    // it means a handful of days carry two so the end date holds.
    //
    // Days before CATCHUP_FROM always stay single, so a week away doesn't come
    // due the very next morning. floor(i*slots/count) spreads the doubles evenly
    // across everything after that.
    var slots = planEnd - k0 + 1;
    var doubling = slots >= 1 && queued > slots;
    var graced = doubling
      ? Math.max(0, Math.min(studyIdx(CATCHUP_FROM) - k0, slots - 1))
      : 0;
    var packSlots = slots - graced, packCount = queued - graced;

    var i = 0;
    SECS.forEach(function (s, si) { s.rows.forEach(function (r) {
      if (r.extra || isDone(r.id)) return;
      deal(r, si, (!doubling || i < graced)
        ? k0 + i
        : k0 + graced + Math.floor((i - graced) * packSlots / packCount), 0);
      i++;
    }); });
    // The quest is the earliest open session. On a make-up day the plan's own
    // session leads and the extra follows; otherwise curriculum order.
    open.sort(function (a, b) { return a.d - b.d || a.x - b.x || a.n - b.n; });
    var firstOpen = open.length ? open[0].r : null;
    var firstOpenSec = open.length ? open[0].si : 0;
    var upcoming = open.slice(1, 4).map(function (o) { return { r: o.r, si: o.si }; });
    // Sessions owed beyond one-a-day — the honest measure of how far behind he
    // is once the schedule has absorbed the slip. Zero when on track. A pinned
    // row counts only once its day has passed unread.
    var makeup = (doubling ? queued - slots : 0) + overdue;
    var drift = remaining > 0 ? Math.round((dayDate(lastDay) - dayDate(planEnd)) / DAY) : 0;
    // Open sessions dealt onto today — what "done for today" has to check.
    var dueToday = dayOff ? 0 : (perDay[todayIdx] || 0);


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


    return {
      now: now, todayIdx: todayIdx, EFF: EFF, secs: secs, earned: earned,
      pagesTotal: pagesTotal, pagesDone: pagesDone, sessTotal: sessTotal, sessDone: sessDone,
      pctAll: pagesTotal ? Math.round(pagesDone / pagesTotal * 100) : 0,
      remaining: remaining, drift: drift, planEnd: planEnd,
      makeup: makeup, extras: extras, perDay: perDay, dayOff: dayOff, readToday: readToday,
      dueToday: dueToday,
      firstOpen: firstOpen, firstOpenSec: firstOpenSec, upcoming: upcoming
    };
  }

  /* ---- small helpers for markup ---- */
  function $(id) { return document.getElementById(id); }
  function conic(col, pct, track) { return "background:conic-gradient(" + col + " " + pct + "%, " + track + " 0)"; }
  // Minutes, not pages: a tired brain rounds "7 pages" up to "a lot", and
  // "~25 min" back down to "finishable". 3.5 min/page, rounded to fives.
  function estMin(pp) { return Math.max(5, Math.round(pp * 3.5 / 5) * 5); }

  /* ---- header ---- */
  function renderHeader() {
    var m = M, h;
    if (tab === "path")       h = { e: "The two-year path", t: "Sectors", r: m.earned + " of " + m.secs.length + " cleared" };
    else if (tab === "guides") h = { e: "One tap to the source", t: "Guidelines",
                                     r: Object.keys(GL).length + " linked" };
    else if (tab === "find")  h = { e: "The whole plan", t: "Find a chapter", r: m.sessTotal + " sessions" };
    else if (tab === "stats") h = { e: "Where you stand", t: "Progress", r: m.pagesDone + " pages read" };
    else if (tab === "bank") h = bankHeader();
    // Home screen leads with the catch-up debt when there is one: it is the
    // thing worth knowing, and it stays true where "days behind" would read 0
    // once the schedule has absorbed the slip.
    else h = { e: fmtD(m.now).toUpperCase(),
               t: window.IDCopy.headline(m),
               r: window.IDCopy.meta(m) };
    $("hEyebrow").textContent = h.e;
    $("hTitle").textContent = h.t;
    $("hMeta").textContent = h.r;
  }

  /* ---- Today ---- */
  function renderToday() {
    var m = M;


    var q = m.firstOpen;
    if (q) {
      // On a rest day, or once today's session is read, the next one belongs to
      // a later date — say which, rather than calling it today's.
      var qDay = m.EFF[q.id];
      var qLabel = qDay === m.todayIdx ? "Today's quest"
                                       : "Next up · " + fmtD(dayDate(qDay));
      // A catch-up day carries two sessions; say so, or the second is a surprise
      // that only appears after the first is marked.
      if (m.perDay[qDay] > 1) qLabel += " · " + m.perDay[qDay] + " sessions";
      $("questCard").innerHTML =
        '<div class="quest">'
        + '<div class="baseline"><span class="qk">' + esc(qLabel) + '</span>'
        +   '<span class="qp">' + (q.pp ? 'pp ' + q.ps + '–' + q.pe + ' · ' + q.pp + ' pages · ~' + estMin(q.pp) + ' min' : 'Review session') + '</span></div>'
        + '<div class="qc">Chapter ' + esc(chapNum(q.r)) + ' · ' + esc(partOf(q.r)) + '</div>'
        + '<div class="qt">' + esc(cleanTitle(q.r)) + '</div>'
        + (q.g ? (GL[q.g]
            ? '<a class="chip" href="' + esc(GL[q.g].url) + '" target="_blank" rel="noopener">' + esc(q.g) + ' ↗</a>'
            : '<div class="chip">' + esc(q.g) + '</div>') : '')
        + '<div class="qacts">'
        +   '<button class="go" data-mark="' + esc(q.id) + '">Mark as read</button>'
        +   '<button class="alt" data-sector="' + m.firstOpenSec + '">Sector</button>'
        + '</div></div>';
    } else {
      $("questCard").innerHTML =
        '<div class="quest"><div class="qk">Curriculum complete</div>'
        + '<div class="qt">Every page read — onward to the exam.</div></div>';
    }

    renderDrill();

    // Three numbers, no more. The middle one is the only one that changes
    // character: it is the debt, and it earns colour when it is non-zero.
    $("statStrip").innerHTML =
      '<div class="cell"><div class="cv" id="cvRead"></div><div class="ck">Read</div></div>'
      + '<div class="cell"><div class="cv' + (m.makeup > 0 ? " behind" : "") + '" id="cvOwed"></div>'
      +   '<div class="ck">' + (m.makeup > 0 ? "To make up" : "On plan") + '</div></div>'
      + '<div class="cell"><div class="cv" id="cvPct"></div><div class="ck">Complete</div></div>';

    // Values are counted in, not written. motion remembers the previous number
    // outside the DOM, so a freshly rebuilt node still animates from it.
    window.IDMotion.countTo($("cvRead"), "read", m.sessDone);
    window.IDMotion.countTo($("cvOwed"), "owed", m.makeup,
      function (v) { return m.makeup > 0 ? Math.round(v) : "\u2014"; });
    window.IDMotion.countTo($("cvPct"), "pct", m.pctAll,
      function (v) { return Math.round(v) + "%"; });

    renderWeek();
    renderStream();
  }

  /* ---- momentum, in weeks not days ----
     A call week costs one imperfect week, not a 40-day streak — the forgiving
     frame is the one that survives fellowship. Plan weeks run Mon–Sun with
     Saturday off, so the target is 6. Dots are the last 7 calendar days. */
  var PERFECT_FROM = new Date(2026, 7, 17);   // first full week after the rebase;
                                              // earlier doneAt data is bulk re-entry noise
  function weekStart(when) {
    var t = new Date(when); t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t;
  }
  function studyDaysIn(ws) {
    var n = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(ws); d.setDate(ws.getDate() + i);
      if (!isFlex(d)) n++;
    }
    return n;
  }
  function weekView(m) {
    var byDay = {};
    SECS.forEach(function (s) { s.rows.forEach(function (r) {
      var d = doneAt(r.id); if (!isDone(r.id) || !d) return;
      var k = dayKey(d); byDay[k] = (byDay[k] || 0) + 1;
    }); });
    var today = new Date(m.now); today.setHours(0, 0, 0, 0);
    var ws = weekStart(today), weekRead = 0, i, d;
    for (i = 0; i < 7; i++) {
      d = new Date(ws); d.setDate(ws.getDate() + i);
      weekRead += byDay[dayKey(d)] || 0;
    }
    var dots = [];
    for (i = 6; i >= 0; i--) {
      d = new Date(today); d.setDate(today.getDate() - i);
      var n = byDay[dayKey(d)] || 0;
      dots.push({ k: dayKey(d),
        st: n > 1 ? "double" : n === 1 ? "read"
          : isFlex(d) || d < START ? "rest"
          : d.getTime() === today.getTime() ? "today" : "missed" });
    }
    var perfect = 0;
    for (var w = weekStart(PERFECT_FROM); w < ws; w.setDate(w.getDate() + 7)) {
      var got = 0;
      for (i = 0; i < 7; i++) {
        d = new Date(w); d.setDate(w.getDate() + i);
        got += byDay[dayKey(d)] || 0;
      }
      if (got >= studyDaysIn(w)) perfect++;
    }
    return { weekRead: weekRead, weekTarget: studyDaysIn(ws), dots: dots, perfect: perfect };
  }

  function renderWeek() {
    var wv = weekView(M);
    var full = wv.weekRead >= wv.weekTarget;
    $("weekCard").innerHTML =
      '<div class="wk">'
      + '<div class="wring" style="' + conic(full ? "var(--gold)" : ACC,
          Math.min(100, Math.round(wv.weekRead / wv.weekTarget * 100)), "var(--track)") + '">'
      +   '<div class="winner">' + wv.weekRead + '</div></div>'
      + '<div style="flex:1;min-width:0"><div class="t">'
      +   (full ? "Week complete — " + wv.weekRead + " read" : wv.weekRead + " of " + wv.weekTarget + " this week") + '</div>'
      +   '<div class="wdots">' + wv.dots.map(function (x) {
            return '<span class="wdot ' + x.st + '"></span>';
          }).join("") + '</div></div>'
      + '</div>';
  }

  /* ---- the home stream ----
     The whole plan, inline under the quest. Past days fold away behind a
     pill; every open row carries its own checkbox and page range, so marking
     a reading off never needs a detour through the sector sheet. */
  function streamMeta(r) {
    var ch = chapNum(r.r), bits = [];
    if (ch) bits.push("Ch " + ch);
    var p = partOf(r.r); if (p !== "Whole chapter") bits.push(p);
    if (r.ps != null && r.pe != null) bits.push("pp " + r.ps + "–" + r.pe);
    else if (!ch) bits.push("Review session");
    return bits.join(" · ");
  }
  function renderStream() {
    var m = M, todayKey = dayKey(m.now), out = "";
    if (m.sessDone > 0) {
      out += '<button class="earlier" data-earlier>'
        + (showEarlier ? "Hide the " + m.sessDone + " read sessions"
                       : m.sessDone + " read · show earlier") + '</button>';
    }
    dayPlan(m).forEach(function (mo) {
      var days = mo.days.filter(function (d) {
        return showEarlier || d.rows.some(function (it) { return !it.done; });
      });
      if (!days.length) return;
      out += '<div class="mhead">' + esc(mo.k) + '</div>' + days.map(function (d) {
        var open = d.rows.some(function (it) { return !it.done; });
        var cls = "dgrp" + (d.k === todayKey ? " today" : (open ? "" : " past"));
        return '<div class="' + cls + '">'
          + '<div class="dd"><span class="dw">' + WD[d.date.getDay()].toUpperCase() + '</span>'
          +   '<span class="dn">' + d.date.getDate() + '</span>'
          +   (d.rows.length > 1 && open ? '<span class="x2">×' + d.rows.length + '</span>' : '')
          + '</div><div class="dss">'
          + d.rows.map(function (it) {
              var r = it.r, ck = it.done;
              return '<div class="ds" data-toggle="' + esc(r.id) + '">'
                + '<div class="box' + (ck ? " on" : "") + '">' + (ck ? "✓" : "") + '</div>'
                + '<div style="flex:1;min-width:0"><div class="t">' + esc(cleanTitle(r.r)) + '</div>'
                + '<div class="m">' + esc(streamMeta(r)) + '</div></div>'
                + '<span class="dot" style="background:' + esc(SECS[it.si].accent) + '"></span>'
                + '</div>';
            }).join("")
          + '</div></div>';
      }).join("");
    });
    $("homeStream").innerHTML = out;
  }

  /* ---- Path ---- */
  // The whole plan, one entry per calendar day, chronological. Read sessions
  // sit on the day they were actually read; open ones on the day the deal
  // gives them — so catch-up doubles appear exactly where they will land.
  function dayPlan(m) {
    var items = [];
    SECS.forEach(function (s, si) { s.rows.forEach(function (r) {
      var done = isDone(r.id);
      var d = done ? (doneAt(r.id) || dayDate(0)) : dayDate(m.EFF[r.id]);
      var t = new Date(d); t.setHours(0, 0, 0, 0);
      items.push({ r: r, si: si, done: done, date: t });
    }); });
    items.sort(function (a, b) { return a.date - b.date; });   // stable: ties keep plan order
    var months = [], mo = null, day = null;
    items.forEach(function (it) {
      var mk = MO[it.date.getMonth()] + " " + it.date.getFullYear();
      if (!mo || mo.k !== mk) { mo = { k: mk, days: [] }; months.push(mo); day = null; }
      var dk = dayKey(it.date);
      if (!day || day.k !== dk) { day = { k: dk, date: it.date, rows: [] }; mo.days.push(day); }
      day.rows.push(it);
    });
    return months;
  }

  function renderPath() {
    var m = M, last = m.secs.length - 1;
    $("pathList").innerHTML = m.secs.map(function (x, si) {
      var complete = x.complete;
      var active = si === m.firstOpenSec && !complete;
      var started = x.dn > 0 && !complete;
      var ringCol = complete ? "var(--gold)" : (active ? ACC : (started ? sectorHue(si) : "var(--box)"));
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

  /* ---- Guidelines ----
     Only tags with a real document behind them appear (the GUIDELINES map);
     topic labels stay as plain chips elsewhere. Grouped by sector in
     curriculum order; a gold arrow marks ones whose chapter is already read. */
  function renderGuides() {
    var seen = {}, out = "";
    SECS.forEach(function (s) {
      var rows = "";
      s.rows.forEach(function (r) {
        if (!r.g || seen[r.g] || !GL[r.g]) return;
        seen[r.g] = true;
        var covered = isDone(r.id);
        rows += '<a class="glrow' + (covered ? " covered" : "") + '" href="' + esc(GL[r.g].url)
          + '" target="_blank" rel="noopener">'
          + '<div style="flex:1;min-width:0"><div class="t">' + esc(r.g) + '</div>'
          + '<div class="m">' + esc(GL[r.g].org) + (covered ? " · chapter read" : "") + '</div></div>'
          + '<span class="arrow">' + (covered ? "✓ ↗" : "↗") + '</span></a>';
      });
      if (rows) out += '<div class="mhead">' + esc(s.title) + '</div>' + rows;
    });
    $("guideList").innerHTML = out;
  }

  /* ---- Stats ---- */

  // ---- Bank: the question bank -------------------------------------------
  // Chapters unlock as you read them. Inside a chapter the accent becomes that
  // chapter's SECTOR hue, so a chapter looks the same here as on the Path.
  var bkIndex = null, bkIndexFailed = false, bkLoading = false,
      bkChapter = null, bkQueue = [], bkAt = 0,
      bkPicked = null, bkShown = false, bkDeferred = false,
      bkFlagList = false;    // the cross-chapter flagged list is showing

  /** The answer map. localStorage is the cache; IDAnswers syncs it. */
  function bankAnswers() { return window.IDAnswers.get(); }
  function graded(a) { return !!(a && a.result); }

  /** True while a question is on screen: a repaint would wipe the reveal panel. */
  function bankBusy() { return tab === "bank" && !!bkChapter && bkAt < bkQueue.length; }

  /** Load qbank/index.json once. On success re-renders; on failure only marks
      the failure (a render here would loop forever offline with no cache). */
  function bankLoadIndex() {
    if (bkIndex || bkLoading) return;
    bkLoading = true;
    bankFetch("qbank/index.json").then(function (d) {
      bkLoading = false;
      if (d && d.chapters) { bkIndex = d.chapters; bkIndexFailed = false; render(); }
      else { bkIndexFailed = true; if (tab === "bank") $("v-bank").innerHTML = '<div class="bkdef">Question bank not available.</div>'; }
    });
  }

  // ---- owed chapters + marks: a copy of lib/bank.js -------------------------
  // The app has no module loader; tests/js/bank-owed.test.mjs pins these equal
  // to the server-side originals. Edit both or the parity test fails.

  /**
   * chapter number -> [session id], from every row's title. One pass over the
   * schedule; owedChapters looks chapters up here instead of rescanning every
   * row per chapter. A row can carry several chapters — "Antifungal Drugs —
   * Chapter 40 Polyenes, 41 Azoles, 42 Echinocandins" or "Chapter 181 —
   * Rhinovirus, 182 — Norovirus" — so every integer after "Chapter" or a comma
   * in the pre-"·" title counts. Digits inside names (HHV-8, COVID-19, HIV-1)
   * follow neither and are ignored.
   */
  function sessionsByChapter(sections) {
    var by = {};
    (sections || []).forEach(function (s) {
      (s.rows || []).forEach(function (r) {
        var t = String(r.r || "").split("·")[0];
        if (!/Chapters?\s+\d/.test(t)) return;
        var m, re = /(?:Chapters?\s+|,\s*)(\d{1,3})\b/g;
        while ((m = re.exec(t))) (by[m[1]] = by[m[1]] || []).push(r.id);
      });
    });
    return by;
  }

  /** Every session id that reads chapter <n>, across all sectors. */
  function chapterSessionIds(sections, chapterNumber) {
    return sessionsByChapter(sections)[String(chapterNumber)] || [];
  }

  /**
   * Chapters that are read but not yet drilled, newest-read first.
   * @param sections  SECTIONS from schedule.js
   * @param progress  id -> {done, doneAt}
   * @param index     qbank/index.json chapters (with `deferred: [cqid]`)
   * @param answers   cqid -> {result, ts, ...}
   * @returns [{chapter, id, title, sector, remaining, total, readAt}]
   */
  function owedChapters(sections, progress, index, answers) {
    progress = progress || {}; answers = answers || {};
    var by = sessionsByChapter(sections), out = [];
    (index || []).forEach(function (c) {
      if (!c.weeks || !c.weeks.length) return;           // catch-alls: available, never demanded
      var ids = by[String(c.chapter || "").replace(/^Chapter\s+/, "")] || [];
      if (!ids.length) return;
      var readAt = 0;
      for (var i = 0; i < ids.length; i++) {
        var e = progress[ids[i]];
        if (!e || !e.done) return;
        // An unparsable doneAt gives NaN, which fails the comparison and is skipped.
        var t = e.doneAt ? new Date(e.doneAt).getTime() : 0;
        if (t > readAt) readAt = t;
      }
      var deferred = {};
      (c.deferred || []).forEach(function (q) { deferred[q] = 1; });
      var ready = (c.cqids || []).filter(function (q) { return !deferred[q]; });
      var remaining = ready.filter(function (q) { var a = answers[q]; return !(a && a.result); });
      if (!remaining.length) return;
      out.push({ chapter: c.chapter, id: c.id, title: c.title, sector: c.sector,
                 remaining: remaining.length, total: ready.length, readAt: readAt });
    });
    out.sort(function (a, b) { return b.readAt - a.readAt; });
    return out;
  }

  /** Marks available for a question: MCQ 1; written = sum of parts, null = 1. */
  function marksFor(q) {
    if (q.kind === "mcq") return 1;
    return (q.parts || []).reduce(function (s, p) {
      return s + (p.marks == null ? 1 : Number(p.marks));
    }, 0);
  }

  /** Marks earned from a full mark and a result string. */
  function earnedFrom(full, result) {
    if (result === "got" || result === "correct") return full;
    if (result === "partial") return full / 2;
    return 0;
  }

  /** The home card: chapters read but not yet drilled. Empty when nothing is owed. */
  function renderDrill() {
    var el = $("drillCard");
    var owed = bkIndex ? owedChapters(SECS, sessions, bkIndex, bankAnswers()) : [];
    if (!owed.length) { el.innerHTML = ""; return; }
    var rows = owed.slice(0, 3).map(function (c) {
      var col = sectorAccent(c.sector) || "var(--ind)";
      return '<button class="drow" data-drill="' + esc(c.id) + '"><i style="background:' + esc(col) + '"></i>' +
        '<span class="t">' + esc(String(c.chapter).replace(/^Chapter\s+/, "Ch ")) + " · " + esc(c.title) + "</span>" +
        '<span class="n">' + c.remaining + " of " + c.total + " left</span></button>";
    }).join("");
    var more = owed.length > 3 ? '<div class="dmore">+' + (owed.length - 3) + " more</div>" : "";
    el.innerHTML = '<div class="drill"><div class="qk">To drill</div>' + rows + more + "</div>";
  }

  /** A drill row was tapped: switch to the Bank and open that chapter. */
  function drillTapped(id) {
    tab = "bank"; sheetSi = null; $("body").scrollTop = 0;
    bkChapter = null; bkFlagList = false;   // paint the list, not a chapter left open earlier
    render();          // the list paints now; the chapter replaces it when it lands
    bankOpen(id);
  }

  function bankHeader() {
    if (bkFlagList) return { e: "Question bank", t: "Flagged", r: "" };
    if (!bkChapter) return { e: "Question bank", t: "Bank",
      r: bkIndex ? bankReady().length + " chapters ready" : "" };
    if (bkAt >= bkQueue.length) return { e: "Chapter complete", t: bkChapter.title, r: "" };
    return { e: bkChapter.chapter, t: bkChapter.title, r: (bkAt + 1) + " of " + bkQueue.length };
  }

  function sectorAccent(name) {
    for (var i = 0; i < SECS.length; i++) if (SECS[i].title === name) return SECS[i].accent;
    return null;
  }
  function setBankAccent(col) {
    var el = $("v-bank");
    if (col) { el.style.setProperty("--acc", col); el.style.setProperty("--acc-d", col); }
    else { el.style.removeProperty("--acc"); el.style.removeProperty("--acc-d"); }
  }

  // One chapter map per schedule. refreshSchedule() swaps SECS wholesale, so
  // identity is the right cache key; the mirrored functions stay untouched.
  var _chMap = null, _chMapFor = null;
  function chapterMap() {
    if (_chMapFor !== SECS) { _chMapFor = SECS; _chMap = sessionsByChapter(SECS); }
    return _chMap;
  }

  /** A chapter is drillable once every one of its schedule sessions is read.
      Uses the same chapter map as the owed rule, so a chapter read inside a
      multi-chapter sitting unlocks here exactly when it appears on the home card. */
  function chapterRead(ch) {
    var ids = chapterMap()[String(ch.chapter || "").replace(/^Chapter\s+/, "")] || [];
    return ids.length ? ids.every(function (id) { return isDone(id); }) : false;
  }

  function bankReady() {
    return (bkIndex || []).filter(function (c) { return chapterRead(c) || !c.weeks.length; });
  }

  function bankFetch(url) {
    return fetch(url).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function renderBank() {
    // Only the chapter LIST resets to the Bank's own indigo. Inside a chapter the
    // sector hue set by bankStart() must survive every re-render.
    if (!bkChapter) setBankAccent(null);
    if (!bkIndex) {
      $("v-bank").innerHTML = '<div class="bkdef">' +
        (bkIndexFailed ? "Question bank not available." : "Loading question bank…") + "</div>";
      if (!bkIndexFailed) bankLoadIndex();
      return;
    }
    if (bkFlagList) return bankFlagged();
    if (bkChapter) return bkAt >= bkQueue.length ? bankSummary() : bankQuestion();

    var ready = bankReady(), groups = {}, order = [];
    ready.forEach(function (c) {
      if (!groups[c.sector]) { groups[c.sector] = []; order.push(c.sector); }
      groups[c.sector].push(c);
    });
    var html = ready.length ? "" :
      '<div class="bkdef">No chapters unlocked yet. Finish a chapter’s sessions and it appears here.</div>';
    var A = bankAnswers();
    order.forEach(function (sec) {
      var col = sectorAccent(sec) || "var(--ind)";
      html += '<div class="bksec"><i style="background:' + esc(col) + '"></i>' +
              '<b style="color:' + esc(col) + '">' + esc(sec) + "</b></div>";
      groups[sec].forEach(function (c) {
        // The ring counts READY questions (deferred ones excluded), the same
        // "ready" the home card, the summary and Stats use, so a chapter the card
        // has cleared shows the gold tick here too.
        var def = {}; (c.deferred || []).forEach(function (q) { def[q] = 1; });
        var ready = c.cqids.filter(function (q) { return !def[q]; });
        var done = ready.filter(function (q) { return graded(A[q]); }).length;
        var pct = ready.length ? Math.round(done / ready.length * 100) : 0;
        var full = ready.length > 0 && done === ready.length;
        var ring = full ? "var(--gold)" : col;
        html += '<button class="bkrow" data-bank="' + esc(c.id) + '">' +
          '<div class="bkring" style="background:conic-gradient(' + ring + " " + pct +
          '%, var(--node-track) 0)"><i style="color:' + (full ? "var(--gold-txt)" : esc(col)) + '">' +
          (c.weeks.length ? esc(String(c.chapter).replace(/^Chapter\s+/, "")) : "\u2022") + "</i></div>" +
          '<div style="flex:1;min-width:0"><div class="t">' + esc(c.title) + "</div>" +
          '<div class="m">' + c.n_mcq + " MCQ · " + c.n_written + " written</div></div>" +
          '<div class="rt" style="color:' + (full ? "var(--gold-txt)" : esc(col)) + '">' +
          (full ? "✓" : done + "/" + ready.length) + "</div></button>";
      });
    });
    $("v-bank").innerHTML = html;
  }

  /** Open a chapter; `focus` (a cqid) starts at that question, showing deferred
      ones if it is one of them. */
  function bankOpen(id, focus) {
    bankFetch("qbank/" + encodeURIComponent(id) + ".json").then(function (d) {
      if (!d) return;
      bkChapter = d; bkDeferred = false; bkFlagList = false;
      if (focus) {
        var fq = null;
        d.questions.forEach(function (q) { if (q.cqid === focus) fq = q; });
        if (fq && fq.needs.length) bkDeferred = true;
      }
      bankStart(focus);
    });
  }

  function bankStart(focus) {
    bkQueue = bkChapter.questions.filter(function (q) { return bkDeferred || !q.needs.length; });
    bkAt = 0;
    var A = bankAnswers(), found = false;
    if (focus) {
      bkQueue.forEach(function (q, i) { if (q.cqid === focus) { bkAt = i; found = true; } });
    }
    // A focus that is not in this queue is no instruction at all -- fall through
    // rather than dumping him on question 1 of a chapter he has half finished.
    if (!found) {
      bkAt = 0;
      while (bkAt < bkQueue.length && graded(A[bkQueue[bkAt].cqid])) bkAt++;
    }
    bkPicked = null; bkShown = false;
    setBankAccent(sectorAccent(bkChapter.sector));
    render();
  }

  /** "HPV", "Enterococcus IE", "" — a topic label, not a stem. */
  function isTopic(t) {
    t = String(t || "").trim();
    if (!t) return true;
    return t.replace(/[.:]$/, "").length < 35 && t.split(/\s+/).length <= 6 && !/\?/.test(t);
  }
  /** The part's text without its own mark annotation. Only a trailing bracketed
      number that equals `marks` is stripped — a year or a count stays. */
  function partText(p) {
    var t = String(p.text || "");
    var m = /\s*\(\s*([\d.]+)\s*\)\s*$/.exec(t);
    if (m && p.marks != null && Number(m[1]) === Number(p.marks)) t = t.slice(0, m.index);
    return t.replace(/\s*[-–—]\s*$/, "");
  }
  function marksPill(n) {
    return n == null ? "" : '<span class="bkmk">' + esc(n) + (Number(n) === 1 ? " mark" : " marks") + "</span>";
  }
  function askedLine(q) {
    var n = (q.recurrence || []).length;
    if (!n) return esc(q.source || "");
    var tags = q.recurrence.slice(0, 3).map(function (t) { return String(t).replace(/\s+\?$/, ""); });
    return "Asked " + n + (n === 1 ? " time" : " times") + " · " + esc(tags.join(", ")) + (n > 3 ? " +" + (n - 3) : "");
  }

  function bankQuestion() {
    var q = bkQueue[bkAt], h = "", rec = bankAnswers()[q.cqid] || {};
    // Mid-chapter escape hatch. Without this the only way out of a chapter was to
    // answer every question to reach the summary.
    h += '<button class="bkexit" id="bkback">\u2190 All chapters</button>';
    h += '<div class="bkq"><div class="bkhead"><div><div class="qk">' +
         (q.kind === "mcq" ? "Multiple choice" : "Written · Royal College") + "</div>" +
         '<div class="qp">' + askedLine(q) + "</div></div>" +
         '<button class="bkflagbtn' + (rec.flag ? " on" : "") + '" id="bkflag" title="Flag for later">⚑</button></div>';
    if (q.kind === "mcq") {
      h += '<div class="bkstem">' + esc(q.stem) + "</div>";
      if (q.lead_in) h += '<div class="bkparts" style="padding:0;font-weight:700;margin-top:12px">' +
                          esc(q.lead_in) + "</div>";
      h += '<ul class="bkopts">' + q.options.map(function (o) {
        return '<li class="bkopt" data-opt="' + esc(o.letter) + '"><span class="bkltr">' +
               esc(o.letter) + '</span><span class="t">' + esc(o.text) + "</span></li>";
      }).join("") + "</ul>";
    } else {
      h += isTopic(q.question)
        ? (q.question ? '<div class="bktopic">' + esc(q.question) + "</div>" : "")
        : '<div class="bkstem">' + esc(q.question) + "</div>";
      // 21% of parts arrive with their own label ("A. ", "1) ", "ii. ") and in 196
      // of those the letters disagree with ours -- so only number the ones that need it.
      h += '<ol class="bkparts">' + (q.parts || []).map(function (p, i) {
        var tx = partText(p), own = /^([a-z]|[ivx]+|\d+)[.)]\s/i.test(tx);
        return '<li><span class="tx">' + (own ? "" : String.fromCharCode(97 + i) + ") ") +
               esc(tx) + "</span>" + marksPill(p.marks) + "</li>";
      }).join("") + "</ol>";
    }
    h += '<div class="bkacts" id="bkacts"></div></div><div id="bkrev"></div>';
    var nDef = bkChapter.questions.filter(function (x) { return x.needs.length; }).length;
    if (!bkDeferred && nDef) {
      h += '<div class="bkdef">' + nDef + ' question' + (nDef > 1 ? "s need" : " needs") +
           ' a chapter you haven\u2019t read yet. <button id="bkshowdef">Show anyway</button></div>';
    }
    $("v-bank").innerHTML = h;
    if (q.kind === "written") {
      $("bkacts").innerHTML = '<button class="go" id="bkreveal">Reveal answer</button>';
    }
    // A repaint must be idempotent: a sync or a theme flip can call render() while a
    // question is open, and the pick and the reveal must come back exactly as they were.
    if (bkShown) { bkShown = false; bankReveal(true); }
    else if (bkPicked) bankPick(bkPicked);
  }

  /** The written-answer block: which answer is primary, and what sits under it. */
  function answerBlock(q) {
    var h = "", co = q.cohort_answer && q.cohort_answer.text ? q.cohort_answer : null;
    if (q.model_answer) {
      h += '<div class="chip">Model answer · ' + esc(q.cites || "Mandell") + "</div>";
      h += '<div class="bkans">' + esc(q.model_answer) + "</div>";
    } else if (co) {
      h += '<div class="chip">Documented answer · ' + esc(co.source || "prior cohort") + "</div>";
      h += '<div class="bkans">' + esc(co.text) + "</div>";
    } else {
      h += '<div class="chip">No answer on file</div>';
    }
    if (q.beyond_mandell) h += '<div class="bkgold"><b>Beyond Mandell.</b> ' + esc(q.beyond_mandell) + "</div>";
    if (q.model_answer && co) h += '<div class="bkcohort"><b>Prior cohort answer · ' + esc(co.source) +
                                   "</b> — " + esc(co.text) + "</div>";
    if (q.cohort_conflict) h += '<div class="bkconflict"><b>NB.</b> ' + esc(q.cohort_conflict) + "</div>";
    if (q.uncertain) h += '<div class="bkflag">⚠ Flagged uncertain — verify this one.</div>';
    return h;
  }

  /** @param replay  true when a repaint is restoring a reveal that was already
      on screen -- it must not scroll the page a second time. */
  function bankReveal(replay) {
    var q = bkQueue[bkAt];
    if (bkShown) return;
    bkShown = true;
    var h = '<div class="bkrev">';
    if (q.kind === "mcq") {
      var right = bkPicked === q.correct, corr = null;
      q.options.forEach(function (o) { if (o.letter === q.correct) corr = o; });
      Array.prototype.forEach.call($("v-bank").querySelectorAll(".bkopt"), function (el) {
        if (el.dataset.opt === q.correct) el.classList.add("ok");
        else if (el.dataset.opt === bkPicked) el.classList.add("no");
      });
      h += '<div class="chip"' + (right ? "" : ' style="background:var(--gold-bg);color:var(--behind)"') +
           ">" + (right ? "Correct" : "Incorrect — you chose " + esc(bkPicked)) + "</div>";
      h += '<div class="bkans">' + esc(q.correct) + ". " + esc(corr ? corr.text : "") + "</div>";
      h += '<div class="bkexp">' + esc(q.explanation) + "</div>";
    } else {
      h += answerBlock(q);
    }
    if (q.kind === "mcq" && q.cites) h += '<div class="bkcite">' + esc(q.cites) + "</div>";
    h += '<div class="bkacts" id="bkgrade"></div></div>';
    $("bkrev").innerHTML = h;
    $("bkacts").innerHTML = "";
    $("bkgrade").innerHTML = q.kind === "mcq"
      ? '<button class="go" data-grade="' + (bkPicked === q.correct ? "correct" : "incorrect") + '">Next question</button>'
      : '<button class="go" data-grade="got">Got it</button>' +
        '<button class="alt" data-grade="partial">Partial</button>' +
        '<button class="alt" data-grade="missed">Missed</button>';
    if (!replay) $("bkrev").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bankGrade(result) {
    var q = bkQueue[bkAt];
    var patch = { result: result };
    if (q.kind === "mcq") patch.chosen = bkPicked;
    window.IDAnswers.set(q.cqid, patch);      // local now, server when it can
    bkAt++; bkPicked = null; bkShown = false;
    render();
  }

  /** Toggle the flag on a question; re-paints the button in place. */
  function bankFlag(cqid) {
    var rec = bankAnswers()[cqid] || {};
    window.IDAnswers.set(cqid, { flag: !rec.flag });
    var b = $("bkflag"); if (b && b.classList) b.classList.toggle("on", !rec.flag);
  }

  /** Re-queue this chapter's missed, incorrect and partial questions. Grades
      are kept: a re-grade is a newer entry, never a deletion. */
  function bankReviewMisses() {
    var A = bankAnswers();
    var m = bkQueue.filter(function (q) {
      var a = A[q.cqid];
      return a && (a.result === "missed" || a.result === "incorrect" || a.result === "partial");
    });
    if (!m.length) { bankExit(); return; }
    bkQueue = m; bkAt = 0; bkPicked = null; bkShown = false;
    render();
  }

  function bankPick(letter) {
    bkPicked = letter;
    Array.prototype.forEach.call($("v-bank").querySelectorAll(".bkopt"), function (el) {
      el.classList.toggle("sel", el.dataset.opt === bkPicked);
    });
    $("bkacts").innerHTML = '<button class="go" id="bksubmit">Submit answer</button>';
  }

  /** Leave the current chapter and show the chapter list again. */
  function bankExit() {
    bkChapter = null; bkQueue = []; bkAt = 0;
    bkPicked = null; bkShown = false; bkDeferred = false; bkFlagList = false;
    setBankAccent(null);
    render();
  }

  function bankSummary() {
    var got = 0, part = 0, miss = 0, A = bankAnswers();
    bkQueue.forEach(function (q) {
      var a = A[q.cqid]; if (!graded(a)) return;
      if (a.result === "correct" || a.result === "got") got++;
      else if (a.result === "partial") part++;
      else miss++;
    });
    var avail = 0, earned = 0;
    bkQueue.forEach(function (q) {
      var full = marksFor(q), a = A[q.cqid];
      avail += full; if (graded(a)) earned += earnedFrom(full, a.result);
    });
    // The deferred toggle must live here too. Once a chapter's ready questions are
    // answered, reopening it lands straight on this summary -- so if the toggle only
    // existed on the question screen the deferred set would be unreachable forever.
    var nDef = bkChapter.questions.filter(function (x) { return x.needs.length; }).length;
    var defNote = (!bkDeferred && nDef)
      ? '<div class="bkdef">' + nDef + ' question' + (nDef > 1 ? "s need" : " needs") +
        ' a chapter you haven\u2019t read yet. <button id="bkshowdef">Show anyway</button></div>'
      : "";
    $("v-bank").innerHTML =
      '<div class="bktally"><div><span class="n" style="color:var(--acc)">' + got +
      '</span><span class="l">Got it</span></div>' +
      '<div><span class="n">' + part + '</span><span class="l">Partial</span></div>' +
      '<div><span class="n" style="color:var(--behind)">' + miss +
      '</span><span class="l">Missed</span></div></div>' +
      '<div class="bkmarksum">' + earned + " of " + avail + " marks</div>" +
      '<div class="bkacts"><button class="go" id="bkmiss">Review misses</button>' +
      '<button class="alt" id="bkback">Back to bank</button></div>' + defNote;
  }

  function showFlagged() {
    tab = "bank"; sheetSi = null; bkChapter = null; bkFlagList = true;
    setBankAccent(null); render();
  }

  /** Every flagged question, across chapters. Rows open the chapter at that question. */
  function bankFlagged() {
    var A = bankAnswers(), byQ = {};
    // A cqid can be placed in several chapters. Take any chapter first so a flag
    // is never dropped, then let an UNLOCKED one overwrite it: the row has to
    // open a chapter he has actually read, not whichever sorts last.
    (bkIndex || []).forEach(function (c) { c.cqids.forEach(function (q) { byQ[q] = c; }); });
    bankReady().forEach(function (c) { c.cqids.forEach(function (q) { byQ[q] = c; }); });
    var flagged = Object.keys(A).filter(function (q) { return A[q].flag && byQ[q]; });
    var h = '<button class="bkexit" id="bkback">\u2190 All chapters</button>';
    if (!flagged.length) h += '<div class="bkdef">Nothing flagged. Tap \u2691 on a question to keep it here.</div>';
    flagged.forEach(function (q) {
      var c = byQ[q], col = sectorAccent(c.sector) || "var(--ind)";
      h += '<button class="bkfl" data-open="' + esc(c.id) + '" data-cqid="' + esc(q) + '">' +
           '<i style="background:' + esc(col) + '"></i><span class="t">' +
           esc(String(c.chapter).replace(/^Chapter\s+/, "Ch ")) + " \u00b7 " + esc(c.title) + "</span>" +
           '<span class="n">' + esc(q) + (graded(A[q]) ? " \u00b7 " + esc(A[q].result) : "") + "</span></button>";
    });
    $("v-bank").innerHTML = h;
  }

  /** The Bank tab was tapped. The #tabs listener runs first and has already
      re-rendered, so retrying a failed index load here has to kick off the
      fetch itself -- clearing the flag alone would only help the NEXT tap. */
  function bankTabTapped() {
    if (!bkIndex) { bkIndexFailed = false; bankLoadIndex(); }
    window.IDAnswers.schedule();              // catch up with the other device
    if (tab === "bank" && (bkChapter || bkFlagList)) { bankExit(); return true; }
    return false;
  }

  // One delegated listener for the whole tab.
  document.addEventListener("click", function (e) {
    var t = e.target;
    var drill = t.closest && t.closest("[data-drill]");
    if (drill) { drillTapped(drill.dataset.drill); return; }
    var fl = t.closest && t.closest("[data-open]");
    if (fl) { bankOpen(fl.dataset.open, fl.dataset.cqid); return; }
    if (t.closest && t.closest("[data-flagged]")) { showFlagged(); $("body").scrollTop = 0; return; }
    var row = t.closest && t.closest("[data-bank]");
    if (row) { bankOpen(row.dataset.bank); return; }
    if (t.closest && t.closest("#bkreveal")) { bankReveal(); return; }
    var opt = t.closest && t.closest(".bkopt");
    if (opt && !bkShown && bkChapter) { bankPick(opt.dataset.opt); return; }
    if (t.closest && t.closest("#bkflag") && bkChapter && bkQueue[bkAt]) { bankFlag(bkQueue[bkAt].cqid); return; }
    if (t.closest && t.closest("#bksubmit")) { bankReveal(); return; }
    var g = t.closest && t.closest("[data-grade]");
    if (g) { bankGrade(g.dataset.grade); return; }
    if (t.closest && t.closest("#bkshowdef")) { bkDeferred = true; bankStart(); return; }
    if (t.closest && t.closest("#bkback")) { bankExit(); return; }
    var bankTab = t.closest && t.closest('[data-tab="bank"]');
    if (bankTab && bankTabTapped()) return;
    if (t.closest && t.closest("#bkmiss")) { bankReviewMisses(); return; }
  });

  function renderStats() {
    var m = M;
    // With catch-up absorbing a slip, drift is 0 and the debt shows as sessions
    // owed instead — otherwise the row would read "on track" and say nothing.
    var driftTxt = m.makeup > 0 ? "making up " + m.makeup
      : m.drift === 0 ? "on track"
      : (m.drift > 0 ? m.drift + " days behind" : Math.abs(m.drift) + " days ahead");
    var driftCls = (m.drift > 0 || m.makeup > 0) ? " behind" : (m.drift < 0 ? " ahead" : "");
    $("statSummary").innerHTML =
      '<div class="summary">'
      + '<div class="ring" style="' + conic(ACC, m.pctAll, "var(--track)") + '">'
      +   '<div class="inner"><div style="text-align:center">'
      +   '<div class="big">' + m.pctAll + '%</div><div class="cap">read</div></div></div></div>'
      + '<div class="lines">'
      +   '<div class="baseline"><span class="l">Sessions read</span><span class="v">' + m.sessDone + ' / ' + m.sessTotal + '</span></div>'
      +   '<div class="baseline"><span class="l">Pages mastered</span><span class="v">' + m.pagesDone + '</span></div>'
      +   '<div class="baseline"><span class="l">Versus plan</span><span class="v' + driftCls + '">' + driftTxt + '</span></div>'
      +   '<div class="baseline"><span class="l">Perfect weeks</span><span class="v">' + weekView(m).perfect + '</span></div>'
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

    renderBankStats();
  }

  /** Stats: the question bank in five lines. Unlocked = read chapters + catch-alls.
      `c.marks` may be absent on an older index: a question then counts 1. */
  function renderBankStats() {
    var el = $("bankStats");
    if (!bkIndex) {
      el.innerHTML = '<div class="card bkstat"><span class="l">' +
        (bkIndexFailed ? "Question bank not available." : "Loading question bank\u2026") + "</span></div>";
      if (!bkIndexFailed) bankLoadIndex();
      return;
    }
    var A = bankAnswers(), total = 0, answered = 0, got = 0, part = 0, miss = 0,
        drilled = 0, withReady = 0, avail = 0, earned = 0, flagged = 0, unlocked = bankReady();
    unlocked.forEach(function (c) {
      var def = {}; (c.deferred || []).forEach(function (q) { def[q] = 1; });
      var ready = c.cqids.filter(function (q) { return !def[q]; }), done = 0;
      total += ready.length;
      ready.forEach(function (q) {
        var a = A[q]; if (!graded(a)) return;
        done++;
        var full = (c.marks && c.marks[q] != null) ? Number(c.marks[q]) : 1;
        avail += full; earned += earnedFrom(full, a.result);
        if (a.result === "got" || a.result === "correct") got++;
        else if (a.result === "partial") part++;
        else miss++;
      });
      answered += done;
      // A chapter whose every question is deferred has nothing to drill, so it is
      // owed nothing either: counting it would put the total out of reach forever.
      if (ready.length) { withReady++; if (done === ready.length) drilled++; }
    });
    // Only flags the flagged list can show -- otherwise the count and the list disagree.
    var inIdx = {};
    (bkIndex || []).forEach(function (c) { c.cqids.forEach(function (q) { inIdx[q] = 1; }); });
    Object.keys(A).forEach(function (q) { if (A[q].flag && inIdx[q]) flagged++; });
    el.innerHTML =
      '<div class="card bkstat">' +
      '<div class="baseline"><span class="l">Answered</span><span class="v">' + answered + " / " + total + "</span></div>" +
      '<div class="bktally small"><div><span class="n">' + got + '</span><span class="l">Got</span></div>' +
      '<div><span class="n">' + part + '</span><span class="l">Partial</span></div>' +
      '<div><span class="n">' + miss + '</span><span class="l">Missed</span></div></div>' +
      '<div class="baseline"><span class="l">Marks</span><span class="v">' + earned + " of " + avail + "</span></div>" +
      '<div class="baseline"><span class="l">Chapters drilled</span><span class="v">' + drilled + " / " + withReady + "</span></div>" +
      '<div class="baseline"><span class="l">Flagged</span><span class="v"><button data-flagged>Flagged \u00b7 ' + flagged + "</button></span></div>" +
      "</div>";
  }

  /* ---- Sector sheet ---- */
  /**
   * Collapse a sector's sessions into chapters.
   *
   * 71% of chapters are split across sittings, so an ungrouped list shows the
   * same title up to seven times and the eye can find nothing. Sittings remain
   * the scheduling unit — they are what fits in a day — but the chapter is the
   * thing worth reading as a heading.
   *
   * Not every session starts with a chapter number — some span several
   * ("Antifungal Drugs — Chapter 40 Polyenes, 41 Azoles…") and the Consolidation
   * and Practice Questions sectors have none at all. Those key on their cleaned
   * title, which groups the parts of one multi-chapter session while keeping
   * genuinely different review sessions apart. Keying them on id instead split
   * "Antifungal Drugs" into three identical-looking rows — the very repetition
   * this function exists to remove.
   */
  function groupByChapter(rows) {
    var out = [], byKey = {};
    rows.forEach(function (r) {
      var num = chapNum(r.r);
      var key = num ? "ch" + num : "t:" + cleanTitle(r.r).toLowerCase();
      var g = byKey[key];
      if (!g) {
        g = byKey[key] = { chapter: num, title: cleanTitle(r.r), parts: [],
                           ps: null, pe: null, pp: 0 };
        out.push(g);
      }
      g.parts.push(r);
      if (r.ps != null) g.ps = g.ps == null ? r.ps : Math.min(g.ps, r.ps);
      if (r.pe != null) g.pe = g.pe == null ? r.pe : Math.max(g.pe, r.pe);
      g.pp += r.pp || 0;
    });
    return out;
  }

  function renderSheet() {
    var el = $("sheet");
    if (sheetSi == null) { el.classList.remove("on"); return; }
    var m = M, x = m.secs[sheetSi], s = x.s;
    $("sheetTitle").textContent = s.title;
    $("sheetSub").textContent = s.sub;
    $("sheetBar").style.width = (x.frac * 100) + "%";
    $("sheetBar").style.background = ACC;
    $("sheetRows").innerHTML = groupByChapter(s.rows).map(function (g) {
      var readCount = g.parts.filter(function (r) { return isDone(r.id); }).length;
      var whole = readCount === g.parts.length;
      var pages = g.ps != null ? "pp " + g.ps + "\u2013" + g.pe : (g.pp ? g.pp + " pages" : "");
      var meta = [g.chapter ? "Ch " + g.chapter : "", pages].filter(Boolean).join(" \u00b7 ");
      // A finished chapter was read on one date; saying it once on the heading
      // beats repeating it down every part, which is what made this list noisy.
      var wholeDate = null;
      if (whole) {
        var ds = g.parts.map(function (r) { return doneAt(r.id); }).filter(Boolean);
        if (ds.length) wholeDate = fmtD(new Date(Math.max.apply(null, ds)));
      }

      // One heading per chapter. Parts only appear when there is more than one —
      // a single-sitting chapter has nothing to expand.
      var parts = g.parts.length === 1 ? "" : g.parts.map(function (r, i) {
        var ck = isDone(r.id), d = doneAt(r.id), eff = m.EFF[r.id];
        var when = whole ? ""                       // already on the heading
                 : ck ? (d ? fmtD(d) : "read")
                      : (eff === m.todayIdx ? "Today" : (eff != null ? fmtD(dayDate(eff)) : ""));
        return '<div class="part' + (ck ? " done" : "") + '" data-toggle="' + esc(r.id) + '">'
          + '<span class="pn">' + (i + 1) + '</span>'
          + '<span class="pp">pp ' + r.ps + '\u2013' + r.pe + '</span>'
          + '<span class="pw">' + esc(when) + '</span>'
          + '<span class="mk">' + (ck ? "\u2713" : "") + '</span>'
          + '</div>';
      }).join("");

      var soloAttr = g.parts.length === 1 ? ' data-toggle="' + esc(g.parts[0].id) + '"' : '';
      return '<div class="chgroup' + (whole ? " whole" : "") + '">'
        + '<div class="chhead"' + soloAttr + '>'
        +   '<div class="chmain"><div class="cht">' + esc(g.title) + '</div>'
        +     '<div class="chm">' + esc(meta)
        +       (wholeDate ? ' \u00b7 read ' + esc(wholeDate)
                 : g.parts.length > 1 ? ' \u00b7 ' + readCount + " of " + g.parts.length + " read" : "")
        +     '</div></div>'
        +   '<span class="mk">' + (whole ? "\u2713" : "") + '</span>'
        + '</div>'
        + (g.parts[0].g ? '<div class="chip">' + esc(g.parts[0].g) + '</div>' : '')
        + (parts ? '<div class="parts">' + parts + '</div>' : '')
        + '</div>';
    }).join("");
    el.classList.add("on");
  }

  /* ---- render ---- */
  function render() {
    M = compute();
    applyTheme(M.now);
    renderHeader();
    ["today", "path", "guides", "find", "stats", "bank"].forEach(function (t) {
      $("v-" + t).classList.toggle("on", t === tab);
    });
    Array.prototype.forEach.call($("tabs").children, function (b) {
      b.classList.toggle("on", b.dataset.tab === tab);
    });
    if (tab === "today") renderToday();
    else if (tab === "path") renderPath();
    else if (tab === "guides") renderGuides();
    else if (tab === "find") renderFind();
    else if (tab === "stats") renderStats();
    else if (tab === "bank") renderBank();
    renderSheet();
    // The icon carries today's debt: due count while unread, cleared on mark.
    try {
      if (navigator.setAppBadge) {
        var due = M.perDay[M.todayIdx] || 0;
        (due > 0 ? navigator.setAppBadge(due) : navigator.clearAppBadge())
          .catch(function () {});
      }
    } catch (e) {}
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
    var dk = e.target.closest("[data-dusk]");
    if (dk) {
      try { localStorage.setItem("idcockpit.dusk", dk.dataset.dusk); } catch (err) {}
      refreshDuskBtns();
      render();
      return;
    }
    var ea = e.target.closest("[data-earlier]");
    if (ea) { showEarlier = !showEarlier; render(); return; }
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

  /* ---- the evening nudge toggle ----
     Web Push needs the installed PWA (iOS 16.4+), and the permission prompt
     must ride a tap. The subscription lives on the server; the button just
     reflects whatever this device's push manager says. */
  function pushReady() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function b64ToU8(s) {
    var b = (s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function refreshDuskBtns() {
    var pref = duskPref();
    Array.prototype.forEach.call($("duskBtns").children, function (b) {
      b.classList.toggle("on", b.dataset.dusk === pref);
    });
  }
  function nudgeUI(on) {
    $("cfgNudge").textContent = on ? "Turn the nudge off" : "Nudge me each evening";
    $("cfgNudgeStatus").textContent = on
      ? "On — around 8:30pm, naming tonight's exact reading. Silent once you've read, and on Saturdays."
      : "A push each evening naming tonight's exact reading — never fires once you've read.";
  }
  function refreshNudge() {
    if (!pushReady()) {
      $("cfgNudge").style.display = "none";
      $("cfgNudgeStatus").textContent = "Nudges need the installed app (Add to Home Screen, iOS 16.4+).";
      return;
    }
    navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (s) { nudgeUI(!!s); })
      .catch(function () { nudgeUI(false); });
  }
  function toggleNudge() {
    var stat = $("cfgNudgeStatus");
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) {
          return sub.unsubscribe()
            .then(function () { return fetch("/api/push", { method: "DELETE" }); })
            .then(function () { nudgeUI(false); });
        }
        return Notification.requestPermission().then(function (perm) {
          if (perm !== "granted") { stat.textContent = "Notifications are blocked for this app."; return; }
          return fetch("/api/push").then(function (r) { return r.json(); }).then(function (j) {
            if (!j.publicKey) { stat.textContent = "Nudge not configured on the server yet."; return; }
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: b64ToU8(j.publicKey)
            }).then(function (s) {
              return fetch("/api/push", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subscription: s.toJSON() })
              });
            }).then(function () { nudgeUI(true); });
          });
        });
      });
    }).catch(function () { stat.textContent = "Couldn't set up the nudge — try again on wifi."; });
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
      refreshNudge();
      refreshDuskBtns();
      $("cfgSheet").classList.add("on");
    };
    $("cfgNudge").onclick = toggleNudge;
    $("duskBtns").onclick = onActivate;   // the cfg sheet sits outside body's delegation
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
          refresh(); window.IDSync.schedulePush(); window.IDServer.schedule();
          status.textContent = "Imported ✓";
        } catch (err) { status.textContent = "Import failed — not a valid state file."; }
      };
      rd.readAsText(f); e.target.value = "";
    };
  })();

  // Called after a sync pull brings in changes made on the other device.
  // loadFromStore() still runs mid-question, so the state is fresh the moment he
  // leaves the chapter -- only the repaint waits.
  function refresh() { loadFromStore(); if (bankBusy()) return; render(); }

  loadFromStore();
  render();

  // The bundled schedule.js renders instantly and is the offline copy. If a
  // newer plan has been pushed to the store, swap it in and re-render — so a
  // schedule change reaches the phone without a deploy, while a dead network,
  // an empty store, or a malformed payload all just leave the bundle standing.
  function refreshSchedule() {
    if (typeof fetch !== "function") return;
    fetch("/api/schedule", { cache: "no-store" })
      .then(function (r) { return r.status === 200 ? r.json() : null; })
      .then(function (p) {
        if (!p || !Array.isArray(p.sections) || !p.sections.length) return;
        if (JSON.stringify(p.sections) === JSON.stringify(SECS)) return;
        SECTIONS = p.sections;
        SECS = p.sections;
        if (!bankBusy()) render();
      })
      .catch(function () {});   // offline: the bundled copy stands
  }
  refreshSchedule();

  window.IDServer.start(refresh);   // progress lives on the server; local is a cache
  // Bank answers: same shape of sync as progress. Don't repaint mid-question —
  // a reveal panel that vanishes under the thumb is worse than a stale ring.
  window.IDAnswers.start(function () { if (!bankBusy()) render(); });
  bankLoadIndex();   // the home card needs the index before the Bank tab is ever opened
  window.IDSync.start(refresh);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});

  // exposed for the node tests
  window.IDCockpit = { compute: compute, cleanTitle: cleanTitle, partOf: partOf,
                       groupByChapter: groupByChapter, dayPlan: dayPlan, weekView: weekView,
                       duskActive: duskActive,
                       chapNum: chapNum, dayDate: dayDate, studyIdx: studyIdx, isFlex: isFlex,
                       bankOpen: bankOpen, bankGrade: bankGrade, bankFlag: bankFlag, bankPick: bankPick,
                       bankReviewMisses: bankReviewMisses, bankTabTapped: bankTabTapped,
                       bankReveal: bankReveal, render: render,
                       showFlagged: showFlagged,
                       drillTapped: drillTapped,
                       sessionsByChapter: sessionsByChapter, chapterSessionIds: chapterSessionIds,
                       owedChapters: owedChapters, marksFor: marksFor, earnedFrom: earnedFrom,
                       setTab: function (t) { tab = t; render(); },
                       bank: function () { return { queue: bkQueue, at: bkAt, chapter: bkChapter, index: bkIndex }; } };
})();
