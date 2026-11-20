(() => {
  "use strict";

  // Public commercial contact. Configured after the owner confirmed the official
  // WhatsApp Business number (Brazilian country code + DDD + number).
  // Never fall back to a private user's phone or to an unrelated CRM channel.
  const officialSalesPhone = "5546999089058";
  const phone = officialSalesPhone.replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(phone)) return;

  const source = document.currentScript;
  const context = source?.dataset.context === "sst" ? "sst" : "nexus";
  const message = context === "sst"
    ? "Olá! Conheci o SST Controle e gostaria de saber mais sobre os planos e a demonstração."
    : "Olá! Conheci a Nexus Core e gostaria de informações sobre as soluções.";
  const href = "https://wa.me/" + phone + "?text=" + encodeURIComponent(message);

  function mount() {
    if (document.querySelector(".nexus-whatsapp-contact")) return;
    const style = document.createElement("style");
    style.textContent = `
      .nexus-whatsapp-contact{position:fixed;right:20px;bottom:24px;z-index:110;display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;min-width:56px;min-height:56px;padding:0;border-radius:50%;border:1px solid #3eb579;background:#147d4d;color:#fff!important;text-decoration:none!important;box-shadow:0 12px 32px rgba(0,0,0,.25);transition:transform .18s ease,background .18s ease}
      .nexus-whatsapp-contact:hover{background:#0f6c42;transform:translateY(-2px)}
      .nexus-whatsapp-contact:focus-visible{outline:3px solid #f4d47d;outline-offset:3px}
      .nexus-whatsapp-contact-icon{display:block;width:30px;height:30px;flex:none;fill:currentColor}
      @media(max-width:680px){.nexus-whatsapp-contact{right:12px;bottom:18px;width:52px;height:52px;min-width:52px;min-height:52px}.nexus-whatsapp-contact[data-context="sst"]{bottom:96px}}
      @media(prefers-reduced-motion:reduce){.nexus-whatsapp-contact{transition:none}.nexus-whatsapp-contact:hover{transform:none}}
    `;
    document.head.appendChild(style);

    const link = document.createElement("a");
    link.className = "nexus-whatsapp-contact";
    link.dataset.context = context;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", context === "sst"
      ? "Falar com a equipe do SST Controle pelo WhatsApp"
      : "Falar com a Nexus Core pelo WhatsApp");
    link.innerHTML = '<svg class="nexus-whatsapp-contact-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.966-.273-.099-.471-.148-.67.15-.198.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.496.1-.198.05-.371-.025-.52-.075-.148-.67-1.611-.916-2.206-.242-.579-.487-.5-.67-.51l-.57-.01c-.198 0-.52.074-.792.371-.272.297-1.04 1.016-1.04 2.48s1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.693.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.005-1.413.248-.693.248-1.288.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.446h-.004a9.87 9.87 0 0 1-5.031-1.378l-.36-.214-3.74.98.998-3.645-.235-.374a9.854 9.854 0 0 1-1.51-5.26c.002-5.445 4.434-9.876 9.881-9.876a9.813 9.813 0 0 1 6.99 2.895 9.815 9.815 0 0 1 2.89 6.997c-.003 5.445-4.434 9.876-9.879 9.876m8.403-18.28A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892a11.83 11.83 0 0 0 1.588 5.944L.057 24l6.303-1.654a11.883 11.883 0 0 0 5.686 1.448h.005c6.555 0 11.89-5.336 11.893-11.892a11.82 11.82 0 0 0-3.49-8.354Z"/></svg>';
    link.title = "Falar no WhatsApp";
    document.body.appendChild(link);

    // Keep the CTA in its usual corner; lift it only if a privacy notice would overlap.
    function avoidConsentOverlap() {
      link.style.removeProperty("bottom");
      const notice = document.querySelector(".nexus-consent");
      if (!notice) return;
      const button = link.getBoundingClientRect();
      const banner = notice.getBoundingClientRect();
      const horizontallyOverlapping = button.left < banner.right + 8 && button.right + 8 > banner.left;
      const verticallyOverlapping = button.top < banner.bottom + 8 && button.bottom + 8 > banner.top;
      if (horizontallyOverlapping && verticallyOverlapping) {
        const normalBottom = window.matchMedia("(max-width:680px)").matches
          ? (context === "sst" ? 96 : 18) : 24;
        link.style.bottom = Math.max(normalBottom, Math.ceil(window.innerHeight - banner.top + 12)) + "px";
      }
    }
    avoidConsentOverlap();
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(avoidConsentOverlap).observe(document.body, { childList: true });
    }
    window.addEventListener("resize", avoidConsentOverlap, { passive: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
