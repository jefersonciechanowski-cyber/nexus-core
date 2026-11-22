/* Nexus Core institutional privacy preference.
 * Consent is optional, explicit and revocable; no visitor tracking before opt-in.
 * A localStorage value saves only the visitor's choice, not behavioral data.
 */
(() => {
  "use strict";
  const preferenceKey = "nexus:institutional:analytics-consent:v2";
  const readChoice = () => {
    try { return localStorage.getItem(preferenceKey); } catch { return null; }
  };
  const saveChoice = value => {
    try { localStorage.setItem(preferenceKey, value); } catch {}
  };
  const choice = readChoice();
  const gpc = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  if (choice === "allow" && !gpc) window.nexusTrackingConsent = true;

  function initialize() {
    const preferences = document.getElementById("nexus-metrics-preferences");
    let notice = null;

    function closeNotice() {
      if (notice) {
        notice.remove();
        notice = null;
      }
    }
    function updateChoice(allow) {
      saveChoice(allow ? "allow" : "deny");
      window.nexusTrackingConsent = allow;
      if (allow) {
        if (window.NexusTracking) window.NexusTracking.start();
        window.dispatchEvent(new Event("nexus:consent-granted"));
      } else {
        if (window.NexusTracking) window.NexusTracking.stop();
        window.dispatchEvent(new Event("nexus:consent-revoked"));
      }
      closeNotice();
      if (preferences) preferences.setAttribute("aria-label", "Revisar preferências de cookies e privacidade");
    }

    function showNotice() {
      if (notice) return;
      notice = document.createElement("aside");
      notice.className = "nexus-consent";
      notice.setAttribute("role", "region");
      notice.setAttribute("aria-label", "Cookies e privacidade");
      notice.innerHTML = `
        <div class="nexus-consent-body">
          <div>
            <strong>Cookies e privacidade</strong>
            <p>Usamos métricas próprias e cookies opcionais do Google Analytics para entender como o site é utilizado
              e melhorar sua experiência. A medição só começa com sua autorização.
              <a href="/privacidade.html">Saiba mais</a>.</p>
          </div>
          <div class="nexus-consent-actions">
            <button type="button" class="nexus-consent-reject">Recusar</button>
            <button type="button" class="nexus-consent-allow">Aceitar cookies</button>
          </div>
        </div>`;
      notice.querySelector(".nexus-consent-allow").addEventListener("click", () => updateChoice(true));
      notice.querySelector(".nexus-consent-reject").addEventListener("click", () => updateChoice(false));
      document.body.appendChild(notice);
    }

    if (preferences) preferences.addEventListener("click", showNotice);
    // If the user has never chosen, request consent. A remembered denial is not overridden.
    if (choice === null || (choice === "allow" && gpc)) showNotice();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
