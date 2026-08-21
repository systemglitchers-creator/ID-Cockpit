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
  // Read from the stylesheet rather than duplicating it — a second copy of the
  // accent is how a palette swap leaves the old colour behind in one place.
  var ACC = (typeof getComputedStyle === "function"
    ? getComputedStyle(document.documentElement).getPropertyValue("--acc").trim()
    : "") || "#9c4f6b";

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

    // Catch-up. Rather than let missed days push the finish date out, the
    // remaining sessions are packed into the study days still available before
    // the plan's *original* end: on track that is exactly one a day, and behind
    // it means a handful of days carry two so the end date holds.
    //
    // Days before CATCHUP_FROM always stay single, so a week away doesn't come
    // due the very next morning. floor(i*slots/count) spreads the doubles evenly
    // across everything after that.
    var slots = planEnd - k0 + 1;
    var doubling = slots >= 1 && remaining > slots;
    var graced = doubling
      ? Math.max(0, Math.min(studyIdx(CATCHUP_FROM) - k0, slots - 1))
      : 0;
    var packSlots = slots - graced, packCount = remaining - graced;

    var EFF = {}, perDay = {}, i = 0, lastDay = k0;
    var firstOpen = null, firstOpenSec = 0, upcoming = [];
    SECS.forEach(function (s, si) { s.rows.forEach(function (r) {
      if (isDone(r.id)) return;
      if (!firstOpen) { firstOpen = r; firstOpenSec = si; }
      else if (upcoming.length < 3) upcoming.push({ r: r, si: si });
      var d = (!doubling || i < graced)
        ? k0 + i
        : k0 + graced + Math.floor((i - graced) * packSlots / packCount);
      EFF[r.id] = d;
      perDay[d] = (perDay[d] || 0) + 1;
      if (d > lastDay) lastDay = d;
      i++;
    }); });
    // Sessions owed beyond one-a-day — the honest measure of how far behind he
    // is once the schedule has absorbed the slip. Zero when on track.
    var makeup = doubling ? remaining - slots : 0;
    var drift = remaining > 0 ? Math.round((dayDate(lastDay) - dayDate(planEnd)) / DAY) : 0;


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
      makeup: makeup, perDay: perDay, dayOff: dayOff, readToday: readToday,
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
    else if (tab === "find")  h = { e: "The whole plan", t: "Find a chapter", r: m.sessTotal + " sessions" };
    else if (tab === "stats") h = { e: "Where you stand", t: "Progress", r: m.pagesDone + " pages read" };
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
     Saturday off, so the target is 6. Dots are the last 14 calendar days. */
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
    for (i = 13; i >= 0; i--) {
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

  /* ---- Stats ---- */
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
      $("cfgSheet").classList.add("on");
    };
    $("cfgNudge").onclick = toggleNudge;
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
  function refresh() { loadFromStore(); render(); }

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
        render();
      })
      .catch(function () {});   // offline: the bundled copy stands
  }
  refreshSchedule();

  window.IDServer.start(refresh);   // progress lives on the server; local is a cache
  window.IDSync.start(refresh);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});

  // exposed for the node tests
  window.IDCockpit = { compute: compute, cleanTitle: cleanTitle, partOf: partOf,
                       groupByChapter: groupByChapter, dayPlan: dayPlan, weekView: weekView,
                       chapNum: chapNum, dayDate: dayDate, studyIdx: studyIdx, isFlex: isFlex };
})();
