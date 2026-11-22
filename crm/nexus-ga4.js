/* GA4 measurement for public Nexus pages only.
 * Load this first-party bootstrap exclusively on the authorized landing page.
 * No Google network requests, cookies or tracking before explicit consent.
 * GA4 identifiers are public configuration, never OAuth tokens.
 */
(() => {
  "use strict";
  const script = document.currentScript;
  const measurementId = String(script?.dataset.ga4Id || "").trim();
  if (!/^G-[A-Z0-9]{6,16}$/.test(measurementId)) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return;

  let started = false;
  const hasConsent = () =>
    window.nexusTrackingConsent === true ||
    window.NexusMarketing?.getPreference?.() === "granted";

  function eraseAnalyticsCookies() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    const domain = location.hostname === "nexuscore.app.br" ||
      location.hostname.endsWith(".nexuscore.app.br") ? "; Domain=.nexuscore.app.br" : "";
    document.cookie.split(";").forEach(part => {
      const name = part.split("=")[0]?.trim();
      if (!name || !/^_ga(?:_|$)|^_gid$|^_gat(?:_|$)/.test(name)) return;
      document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax" + secure;
      if (domain) document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax" + domain + secure;
    });
  }

  function start() {
    if (started || !hasConsent()) return;
    started = true;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    // Basic consent mode: no Google tag is requested until the visitor opts in.
    window.gtag("consent", "default", {
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      send_page_view: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    const node = document.createElement("script");
    node.async = true;
    node.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
    node.referrerPolicy = "strict-origin-when-cross-origin";
    document.head.appendChild(node);
  }

  function revoke() {
    if (!started) return;
    // Reload immediately to unload the already-fetched Google library.
    window.gtag?.("consent", "update", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
    eraseAnalyticsCookies();
    window.location.reload();
  }

  window.NexusGA4 = Object.freeze({
    track(name) {
      // Only an actual, successful commercial lead is emitted. No form fields.
      if (name !== "generate_lead" || !started || !hasConsent()) return false;
      window.gtag("event", "generate_lead", { form_type: "sst_demo" });
      return true;
    }
  });

  window.addEventListener("nexus:consent-granted", start);
  window.addEventListener("nexus:consent-revoked", revoke);
  if (hasConsent()) start();
})();
