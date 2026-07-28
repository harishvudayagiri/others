/**
 * Journal Reading Analytics
 * ---------------------------------------------------------
 * Measures *observable reading behaviour* only:
 * scroll depth, section dwell time, idle vs active time,
 * copy events, and return visits. It does NOT and CANNOT
 * infer emotion, regret, or intent — only behaviour in the browser.
 *
 * Requires gtag.js to already be loaded on the page.
 * Requires each content section in the HTML to have:
 *   <section class="j-section" id="..." data-section-name="...">
 */
(function () {
  "use strict";

  const CONFIG = {
    idleAfterMs: 15000,       // no interaction for this long => idle
    tickMs: 1000,             // active/idle accounting tick
    minSecondsForCompletion: 45,
    minScrollForCompletion: 95,  // % scrolled
    sectionVisibilityThreshold: 0.5, // IntersectionObserver ratio
  };

  function gtagSafe(name, params) {
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params || {});
    }
  }

  const state = {
    pageStart: Date.now(),
    activeMs: 0,
    idleMs: 0,
    lastActivityAt: Date.now(),
    isIdle: false,
    isFocused: document.hasFocus ? document.hasFocus() : true,
    maxScroll: 0,
    scrollMilestonesFired: { 25: false, 50: false, 75: false, 100: false },
    sectionDurations: Object.create(null), // id -> ms
    visitedSections: new Set(),
    currentSectionId: null,
    currentSectionEnteredAt: null,
    copyEvents: 0,
    copyChars: 0,
    completedFired: false,
    sections: [], // [{id, name, el}]
  };

  // ---------- Visit / return tracking (localStorage) ----------
  function trackVisit() {
    const now = Date.now();
    const lastVisit = Number(localStorage.getItem("jra_last_visit") || 0);
    const visitCount = Number(localStorage.getItem("jra_visit_count") || 0) + 1;
    localStorage.setItem("jra_visit_count", String(visitCount));
    localStorage.setItem("jra_last_visit", String(now));

    if (lastVisit === 0) {
      gtagSafe("journal_opened", { visit_type: "first_visit", visit_count: visitCount });
    } else {
      const daysSince = Math.round((now - lastVisit) / 86400000);
      gtagSafe("journal_opened", {
        visit_type: "return_visit",
        visit_count: visitCount,
        days_since_last_visit: daysSince,
      });
    }
    return visitCount;
  }

  // ---------- Activity / idle detection ----------
  function markActivity() {
    if (state.isIdle) {
      state.isIdle = false;
      gtagSafe("reader_resumed");
    }
    state.lastActivityAt = Date.now();
  }

  function attachActivityListeners() {
    ["mousemove", "keydown", "scroll", "touchstart", "click", "wheel"].forEach((evt) => {
      window.addEventListener(evt, markActivity, { passive: true });
    });

    window.addEventListener("blur", () => {
      state.isFocused = false;
      gtagSafe("window_blur");
    });
    window.addEventListener("focus", () => {
      state.isFocused = true;
      markActivity();
      gtagSafe("window_focus");
    });
    document.addEventListener("visibilitychange", () => {
      gtagSafe(document.hidden ? "tab_hidden" : "tab_visible");
      if (!document.hidden) markActivity();
      else flushCurrentSectionTime();
    });
  }

  function tick() {
    const now = Date.now();
    const idleFor = now - state.lastActivityAt;
    const pageIsUsable = !document.hidden && state.isFocused;

    if (pageIsUsable) {
      if (idleFor >= CONFIG.idleAfterMs) {
        if (!state.isIdle) {
          state.isIdle = true;
          gtagSafe("reader_idle");
        }
        state.idleMs += CONFIG.tickMs;
      } else {
        state.activeMs += CONFIG.tickMs;
      }
    }
  }

  // ---------- Scroll depth ----------
  function currentScrollPercent() {
    const scrollTop = window.scrollY;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    return scrollable > 0 ? Math.round((scrollTop / scrollable) * 100) : 100;
  }

  function handleScroll() {
    const pct = currentScrollPercent();
    if (pct > state.maxScroll) state.maxScroll = pct;

    [25, 50, 75, 100].forEach((level) => {
      if (pct >= level && !state.scrollMilestonesFired[level]) {
        state.scrollMilestonesFired[level] = true;
        gtagSafe("scroll_" + level, { scroll_percent: level });
      }
    });

    maybeFireCompletion();
  }

  // ---------- Section (reader journey) tracking ----------
  function flushCurrentSectionTime() {
    if (state.currentSectionId && state.currentSectionEnteredAt) {
      const dur = Date.now() - state.currentSectionEnteredAt;
      state.sectionDurations[state.currentSectionId] =
        (state.sectionDurations[state.currentSectionId] || 0) + dur;
      state.currentSectionEnteredAt = Date.now();
    }
  }

  function enterSection(id) {
    if (state.currentSectionId === id) return;
    flushCurrentSectionTime();
    state.currentSectionId = id;
    state.currentSectionEnteredAt = Date.now();

    if (!state.visitedSections.has(id)) {
      state.visitedSections.add(id);
      const meta = state.sections.find((s) => s.id === id);
      const label = meta ? meta.name : id;
      gtagSafe(label, { section_id: id });
    }
    maybeFireCompletion();
  }

  function setupSectionObserver() {
    const els = Array.from(document.querySelectorAll(".j-section"));
    state.sections = els.map((el) => ({
      id: el.id,
      name: el.dataset.sectionName || el.id,
      el,
    }));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= CONFIG.sectionVisibilityThreshold) {
            enterSection(entry.target.id);
          }
        });
      },
      { threshold: [CONFIG.sectionVisibilityThreshold] }
    );

    els.forEach((el) => observer.observe(el));
  }

  // ---------- Completion ----------
  function maybeFireCompletion() {
    if (state.completedFired) return;
    const secondsElapsed = Math.round((Date.now() - state.pageStart) / 1000);
    const enoughSections = state.visitedSections.size >= Math.max(1, state.sections.length - 1);
    if (
      state.maxScroll >= CONFIG.minScrollForCompletion &&
      enoughSections &&
      secondsElapsed >= CONFIG.minSecondsForCompletion
    ) {
      state.completedFired = true;
      gtagSafe("journal_completed", { reading_time: secondsElapsed });
    }
  }

  // ---------- Copy tracking (event only, never content) ----------
  function attachCopyTracking() {
    document.addEventListener("copy", () => {
      const selection = window.getSelection ? window.getSelection().toString() : "";
      state.copyEvents += 1;
      state.copyChars += selection.length;
      gtagSafe("text_copied", { char_count: selection.length });
    });
  }

  // ---------- Performance metrics ----------
  function attachPerformanceTracking() {
    window.addEventListener("load", () => {
      try {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) {
          gtagSafe("performance_timing", {
            page_load_ms: Math.round(nav.loadEventEnd),
            dom_ready_ms: Math.round(nav.domContentLoadedEventEnd),
          });
        }
        if ("PerformanceObserver" in window) {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            if (last) gtagSafe("performance_lcp", { lcp_ms: Math.round(last.startTime) });
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }
      } catch (e) {
        /* performance API not available — ignore silently */
      }
    });
  }

  // ---------- Reading score (engagement, not emotion) ----------
  function calcReadingScore() {
    const scrollScore = Math.min(state.maxScroll, 100) * 0.3;

    const sectionRatio = state.sections.length
      ? state.visitedSections.size / state.sections.length
      : 0;
    const sectionScore = sectionRatio * 100 * 0.3;

    const activeMinutes = state.activeMs / 60000;
    const timeScore = Math.min(activeMinutes / 5, 1) * 100 * 0.25; // caps at 5 active minutes

    const idleMinutes = state.idleMs / 60000;
    const idlePenalty = Math.min(idleMinutes, 5) * 2; // up to -10

    const visitCount = Number(localStorage.getItem("jra_visit_count") || 1);
    const returnBonus = visitCount > 1 ? 10 : 0;

    const raw = scrollScore + sectionScore + timeScore + returnBonus - idlePenalty;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  // ---------- Exit analytics ----------
  function sendExitAnalytics() {
    flushCurrentSectionTime();
    const secondsElapsed = Math.round((Date.now() - state.pageStart) / 1000);
    const score = calcReadingScore();

    gtagSafe("exit_analytics", {
      last_section: state.currentSectionId || "none",
      scroll_percent: state.maxScroll,
      reading_time: secondsElapsed,
      active_time: Math.round(state.activeMs / 1000),
      idle_time: Math.round(state.idleMs / 1000),
      reading_score: score,
      copy_events: state.copyEvents,
      copy_chars: state.copyChars,
    });

    // Per-section timing, sent as one event with all durations (keeps event count sane)
    const sectionSummary = {};
    Object.keys(state.sectionDurations).forEach((id) => {
      sectionSummary[id] = Math.round(state.sectionDurations[id] / 1000);
    });
    gtagSafe("section_timing", sectionSummary);

    maybeFireCompletion();
  }

  // ---------- Boot ----------
  function init() {
    setupSectionObserver();
    attachActivityListeners();
    attachCopyTracking();
    attachPerformanceTracking();

    trackVisit();
    gtagSafe("reading_started");

    window.addEventListener("scroll", handleScroll, { passive: true });
    setInterval(tick, CONFIG.tickMs);

    window.addEventListener("beforeunload", sendExitAnalytics);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) sendExitAnalytics();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
