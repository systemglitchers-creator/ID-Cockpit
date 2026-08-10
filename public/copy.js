/* public/copy.js — browser shim over copy.mjs.
   The page loads plain scripts; the tests import the module. Same logic, no
   build step. A test runs both through every hour and every state and fails if
   they diverge — keep this file a mirror. */
(function (global) {
  "use strict";

  function greeting(now) {
    var h = now.getHours();
    if (h < 5) return "Still up";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }

  function headline(m) {
    if (m.remaining === 0 || !m.firstOpen) return "Every page read.";
    if (m.justCleared) return m.justCleared + " cleared.";
    if (m.dayOff) return "Rest day. Back at it tomorrow.";
    if (m.readToday) return "Done for today.";
    return greeting(m.now);
  }

  function meta(m) {
    if (m.makeup > 0) return "Catching up · " + m.makeup + " to make up";
    if (m.remaining === 0) return "Curriculum complete";
    return m.remaining + " sessions left";
  }

  global.IDCopy = { greeting: greeting, headline: headline, meta: meta };
})(window);
