/* Pinned Nexus CRM tracker for the institutional static website.
 * Source: nexus-crm/public/nexus-tracker.js (2026-11-20).
 * This local copy is deliberate: the Cloudflare-hosted monorepo has a restrictive
 * script-src CSP; only the HTTPS events endpoint is allowlisted for connect-src.
 * Keep in sync with Nexus CRM tracker security fixes.
 */
/* Nexus CRM first-party tracker v1.
 * Installs no cookies and collects no form values, phone numbers, emails or IPs.
 * Anonymous performance and engagement counters start only AFTER consent.
 * Requires explicit consent from the website's consent manager:
 *   window.NexusTracking.start()
 * or window.nexusTrackingConsent = true before this script loads.
 */
(() => {
  "use strict";
  const script = document.currentScript;
  const siteId = script && script.getAttribute("data-nexus-site");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!siteId || !uuid.test(siteId) || !window.crypto || !crypto.randomUUID) return;
  if (window.NexusTracking) return;

  const endpoint = new URL("/api/public/site-events", script.getAttribute("data-nexus-api") || script.src).toString();
  const sessionKey = "nexus:site:" + siteId + ":session";
  const firstKey = "nexus:site:" + siteId + ":first";
  const lastKey = "nexus:site:" + siteId + ":last";
  const params = ["utm_source", "utm_medium", "utm_campaign", "utm_content",
    "utm_term", "utm_id", "gclid", "gbraid", "wbraid", "fbclid"];
  let started = false;
  let sessionId = null;
  let first = {};
  let last = {};
  let landing = window.location.pathname;
  let formStarted = new WeakSet();
  let activeTime = 0;
  let lastTick = 0;
  let lastActivity = 0;
  let intervalId = null;
  let listenersBound = false;
  let lastPath = window.location.pathname;
  const sentScroll = new Set();
  let vitalsFlush = null;

  function get(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
  }
  function set(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }
  function parse(value) {
    try { return JSON.parse(value || "{}"); } catch { return {}; }
  }
  function touchFromUrl() {
    const search = new URLSearchParams(window.location.search);
    const touch = {};
    params.forEach(key => {
      const value = search.get(key);
      if (value) touch[key] = value.slice(0, 500);
    });
    return touch;
  }
  function referrerHost() {
    try { return document.referrer ? new URL(document.referrer).hostname : null; }
    catch { return null; }
  }
  function updateHidden(form) {
    [["nexus_site_id", siteId], ["nexus_session_id", sessionId]].forEach(([name, value]) => {
      let field = Array.from(form.querySelectorAll('input[type="hidden"]')).find(el => el.name === name);
      if (!field) {
        field = document.createElement("input");
        field.type = "hidden";
        field.name = name;
        form.appendChild(field);
      }
      field.value = value;
    });
  }
  function deviceType() {
    const width = window.innerWidth || document.documentElement.clientWidth || 1200;
    return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
  }
  function send(eventType, targetKey, extra) {
    if (!started || !sessionId) return;
    const payload = {
      site_id: siteId,
      session_id: sessionId,
      event_id: crypto.randomUUID(),
      event_type: eventType,
      page_path: window.location.pathname,
      landing_path: landing,
      referrer_host: referrerHost(),
      target_key: targetKey || null,
      device_type: deviceType(),
      ...last,
      ...(extra || {}),
    };
    try {
      fetch(endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}
    // GTM/GA4 integration hook. This does NOT send a Google conversion itself.
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: "nexus_" + eventType, nexus_site_id: siteId });
    }
  }
  function onClick(event) {
    const el = event.target instanceof Element ? event.target.closest("a,button,[data-nexus-action]") : null;
    if (!el) return;
    const href = el instanceof HTMLAnchorElement ? (el.getAttribute("href") || "") : "";
    let type = "";
    if (/^tel:/i.test(href)) type = "phone_click";
    else if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)(\/|\?|$)/i.test(href)) type = "whatsapp_click";
    else if (el.hasAttribute("data-nexus-action")) type = "cta_click";
    if (!type) return;
    const label = el.getAttribute("data-nexus-action") || el.getAttribute("data-nexus-label") || type;
    send(type, label.slice(0, 80));
  }
  function onFormStart(event) {
    const form = event.target instanceof Element ? event.target.closest("form") : null;
    if (!form || formStarted.has(form)) return;
    formStarted.add(form);
    updateHidden(form);
    send("form_start", form.getAttribute("data-nexus-form") || "form");
  }
  function onFormSubmit(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    updateHidden(form);
    // Submission attempt, NOT a confirmed server-side lead.
    send("form_submit", form.getAttribute("data-nexus-form") || "form");
  }

  // Foreground time is a bounded estimate, not a measure of personal attention.
  // No mouse locations, individual keystrokes, text or cursor recordings.
  function recordActivity() { lastActivity = Date.now(); }
  function heartbeat(force) {
    if (!started) return;
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(15000, now - lastTick));
    if (elapsed > 0 && !document.hidden && now - lastActivity <= 30000) {
      activeTime += elapsed;
    }
    lastTick = now;
    if ((force || activeTime >= 12000) && activeTime >= 1000) {
      const elapsedActive = Math.round(Math.min(activeTime, 60000));
      activeTime = 0;
      send("engagement", null, { engagement_ms: elapsedActive });
    }
  }

  function onScroll() {
    if (!started) return;
    recordActivity();
    const root = document.documentElement;
    const max = Math.max(0, (root.scrollHeight || 0) - (window.innerHeight || 0));
    if (max <= 0) return;
    const pct = 100 * Math.max(0, window.scrollY || 0) / max;
    [25, 50, 75, 90].forEach(threshold => {
      if (pct >= threshold && !sentScroll.has(threshold)) {
        sentScroll.add(threshold);
        send("scroll_depth", String(threshold));
      }
    });
  }

  // Pure browser PerformanceObserver: no Google tags, third-party scripts or cookies.
  // The event-timing sample is called interaction_delay, NOT official INP.
  function observePerformance() {
    if (typeof window.PerformanceObserver !== "function" || !window.performance) return;
    const perf = window.performance;
    const nav = perf.getEntriesByType && perf.getEntriesByType("navigation")[0];
    const samples = [];
    const round = value => Math.round(Number(value) * 100) / 100;
    if (nav && Number.isFinite(nav.responseStart) && nav.responseStart >= 0) {
      send("performance_sample", null, { metric_name: "ttfb", metric_value: round(nav.responseStart) });
    }
    if (perf.getEntriesByType) {
      const fcp = perf.getEntriesByType("paint").find(e => e.name === "first-contentful-paint");
      if (fcp && Number.isFinite(fcp.startTime)) {
        send("performance_sample", null, { metric_name: "fcp", metric_value: round(fcp.startTime) });
      }
    }

    let lcp = null;
    let cls = 0;
    let shiftWindow = 0;
    let windowStart = 0;
    let lastShift = 0;
    let interactionDelay = null;
    let flushed = false;
    function addObserver(type, callback, options) {
      try {
        const observer = new window.PerformanceObserver(list => {
          if (started) list.getEntries().forEach(callback);
        });
        observer.observe({ type, buffered: true, ...(options || {}) });
        samples.push(observer);
      } catch {}
    }
    addObserver("largest-contentful-paint", entry => {
      if (Number.isFinite(entry.startTime)) lcp = round(entry.startTime);
    });
    addObserver("layout-shift", entry => {
      if (entry.hadRecentInput || !Number.isFinite(entry.value)) return;
      if (entry.startTime - lastShift > 1000 || entry.startTime - windowStart > 5000) {
        windowStart = entry.startTime;
        shiftWindow = 0;
      }
      shiftWindow += entry.value;
      lastShift = entry.startTime;
      cls = Math.max(cls, round(shiftWindow));
    });
    addObserver("event", entry => {
      // This is a performance diagnostic, not a standard-compliant INP figure.
      if (entry.interactionId > 0 && Number.isFinite(entry.duration)) {
        interactionDelay = Math.max(interactionDelay || 0, entry.duration);
      }
    }, { durationThreshold: 40 });

    vitalsFlush = () => {
      if (!started || flushed) return;
      flushed = true;
      if (lcp !== null) send("performance_sample", null, { metric_name: "lcp", metric_value: lcp });
      send("performance_sample", null, { metric_name: "cls", metric_value: cls });
      if (interactionDelay !== null) send("performance_sample", null,
        { metric_name: "interaction_delay", metric_value: round(interactionDelay) });
      samples.forEach(observer => { try { observer.disconnect(); } catch {} });
    };
  }

  function onNavigation() {
    if (!started) return;
    if (window.location.pathname === lastPath) return;
    heartbeat(true);
    lastPath = window.location.pathname;
    sentScroll.clear();
    send("page_view");
  }

  function stop() {
    if (!started) return;
    heartbeat(true);
    if (vitalsFlush) vitalsFlush();
    started = false;
    if (intervalId !== null && typeof clearInterval === "function") clearInterval(intervalId);
    intervalId = null;
    try {
      [sessionKey, firstKey, lastKey].forEach(key => sessionStorage.removeItem(key));
    } catch {}
    sessionId = null;
    first = {};
    last = {};
    activeTime = 0;
  }

  function start() {
    if (started) return;
    started = true;
    sessionId = get(sessionKey);
    if (!sessionId || !uuid.test(sessionId)) {
      sessionId = crypto.randomUUID();
      set(sessionKey, sessionId);
    }
    const incoming = touchFromUrl();
    first = parse(get(firstKey));
    if (!first || !first.landing_path) {
      first = { ...incoming, landing_path: window.location.pathname };
      set(firstKey, JSON.stringify(first));
    }
    last = parse(get(lastKey));
    if (!last || !Object.keys(last).length) last = { ...incoming };
    if (Object.keys(incoming).length) last = { ...incoming };
    set(lastKey, JSON.stringify(last));
    landing = first.landing_path || window.location.pathname;
    if (!listenersBound) {
      listenersBound = true;
      document.addEventListener("click", onClick, true);
      document.addEventListener("focusin", onFormStart, true);
      document.addEventListener("submit", onFormSubmit, true);
      document.addEventListener("pointerdown", recordActivity, { passive: true });
      document.addEventListener("keydown", recordActivity, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { heartbeat(true); if (vitalsFlush) vitalsFlush(); }
        else { lastTick = Date.now(); lastActivity = Date.now(); }
      });
      window.addEventListener("pagehide", () => { heartbeat(true); if (vitalsFlush) vitalsFlush(); });
      window.addEventListener("popstate", onNavigation);
      window.addEventListener("nexus:page-change", onNavigation);
      // Support router-based websites without collecting URL queries.
      if (window.history && typeof window.history.pushState === "function") {
        const original = window.history.pushState;
        window.history.pushState = function (...args) {
          const result = original.apply(this, args);
          onNavigation();
          return result;
        };
      }
    }
    lastTick = Date.now();
    lastActivity = Date.now();
    if (typeof setInterval === "function") intervalId = setInterval(() => heartbeat(false), 12000);
    send("page_view");
    observePerformance();
  }
  window.NexusTracking = Object.freeze({
    start,
    getSessionId: () => started ? sessionId : null,
    stop,
    trackCta: key => { if (typeof key === "string") send("cta_click", key.slice(0, 80)); },
  });
  window.addEventListener("nexus:consent-granted", start);
  window.addEventListener("nexus:consent-revoked", stop);
  if (window.nexusTrackingConsent === true || document.documentElement.dataset.nexusTrackingConsent === "granted") start();
})();
