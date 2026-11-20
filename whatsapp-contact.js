(() => {
  "use strict";

  // Public commercial contact. Leave blank until the team confirms its official
  // WhatsApp Business number (Brazilian country code + DDD + number).
  // Never fall back to a private user's phone or to an unrelated CRM channel.
  const officialSalesPhone = "";
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
      .nexus-whatsapp-contact{position:fixed;right:20px;bottom:24px;z-index:110;display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:46px;padding:0 16px;border-radius:999px;border:1px solid #3eb579;background:#147d4d;color:#fff!important;font:700 13px/1.25 Inter,"Segoe UI",Arial,sans-serif;text-decoration:none!important;box-shadow:0 12px 32px rgba(0,0,0,.25);transition:transform .18s ease,background .18s ease}
      .nexus-whatsapp-contact:hover{background:#0f6c42;transform:translateY(-2px)}
      .nexus-whatsapp-contact:focus-visible{outline:3px solid #f4d47d;outline-offset:3px}
      .nexus-whatsapp-contact-icon{font-size:20px;line-height:1}
      @media(max-width:680px){.nexus-whatsapp-contact{right:12px;bottom:18px;min-height:44px;padding:0 13px}.nexus-whatsapp-contact[data-context="sst"]{bottom:96px}}
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
    link.innerHTML = '<span class="nexus-whatsapp-contact-icon" aria-hidden="true">✆</span><span>WhatsApp</span>';
    document.body.appendChild(link);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
