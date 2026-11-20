/* Nexus Core institutional privacy preference.
 * Consent is optional, explicit and revocable; no visitor tracking before opt-in.
 * A localStorage value saves only the visitor's choice, not behavioral data.
 */
(() => {
  "use strict";
  const preferenceKey = "nexus:institutional:analytics-consent:v1";
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
      if (preferences) preferences.setAttribute("aria-label", "Revisar escolha de métricas do site");
    }

    function showNotice() {
      if (notice) return;
      notice = document.createElement("aside");
      notice.className = "nexus-consent";
      notice.setAttribute("role", "region");
      notice.setAttribute("aria-label", "Preferências de privacidade");
      notice.innerHTML = `
        <div class="nexus-consent-body">
          <div>
            <strong>Privacidade e experiência</strong>
            <p>Podemos medir velocidade, páginas visitadas e cliques para melhorar o site.
              Não coletamos o que você digita nos formulários pela tag.
              <a href="/privacidade.html">Saiba mais</a>.</p>
          </div>
          <div class="nexus-consent-actions">
            <button type="button" class="nexus-consent-reject">Agora não</button>
            <button type="button" class="nexus-consent-allow">Permitir métricas</button>
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
