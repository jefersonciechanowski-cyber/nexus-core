(() => {
  'use strict';

  const source = document.currentScript;
  const pixelId = String(source?.dataset.metaPixelId || '').trim();
  const consentCookie = 'nexus_marketing_consent';
  const consentVersion = 'v1';
  const consentMaxAge = 60 * 60 * 24 * 180;
  let preference = readPreference();
  let pixelInitialized = false;

  function readPreference() {
    const prefix = `${consentCookie}=`;
    const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
    const stored = value ? decodeURIComponent(value.slice(prefix.length)) : '';
    if (stored === `${consentVersion}:granted`) return 'granted';
    if (stored === `${consentVersion}:denied`) return 'denied';
    return 'unknown';
  }

  function writePreference(value) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${consentCookie}=${encodeURIComponent(`${consentVersion}:${value}`)}; Max-Age=${consentMaxAge}; Path=/; SameSite=Lax${secure}`;
    preference = value;
  }

  function deleteCookie(name) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    if (location.hostname === 'nexuscore.app.br' || location.hostname.endsWith('.nexuscore.app.br')) {
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.nexuscore.app.br; SameSite=Lax${secure}`;
    }
  }

  function initializePixel() {
    if (pixelInitialized || preference !== 'granted' || !pixelId) return;

    /* Meta Pixel base loader. It is created only after marketing consent. */
    !function(f,b,e,v,n,t,s) {
      if (f.fbq) return;
      n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
      t=b.createElement(e);t.async=!0;t.src=v;
      s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
    }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

    window.fbq('set', 'autoConfig', 'false', pixelId);
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
    pixelInitialized = true;
  }

  function revokePixel() {
    if (typeof window.fbq === 'function') window.fbq('consent', 'revoke');
    deleteCookie('_fbp');
    deleteCookie('_fbc');
  }

  function track(eventName, parameters = {}) {
    if (preference !== 'granted' || !pixelId) return false;
    initializePixel();
    window.fbq('track', eventName, parameters);
    return true;
  }

  function injectStyles() {
    if (document.getElementById('nexusCookieStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusCookieStyles';
    style.textContent = `
      .nexus-cookie{position:fixed;left:18px;right:18px;bottom:18px;z-index:120;display:none;justify-content:center;pointer-events:none}
      .nexus-cookie.visible{display:flex}
      .nexus-cookie-card{width:min(900px,100%);padding:20px;border:1px solid #42545c;border-radius:13px;background:#0a151a;color:#f3efe5;box-shadow:0 24px 80px rgba(0,0,0,.58);pointer-events:auto}
      .nexus-cookie-copy{display:grid;gap:7px}.nexus-cookie-copy strong{font:800 16px/1.3 Inter,"Segoe UI",Arial,sans-serif}.nexus-cookie-copy p{margin:0;color:#a6b0b5;font:13px/1.55 Inter,"Segoe UI",Arial,sans-serif}.nexus-cookie-copy a{color:#e0b84a;text-decoration:underline;text-underline-offset:3px}
      .nexus-cookie-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;margin-top:15px}.nexus-cookie-actions button{min-height:40px;padding:0 16px;border:1px solid #4a5c64;border-radius:8px;background:#101f26;color:#f3efe5;font:750 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer}.nexus-cookie-actions button:last-child{border-color:#dca92f;background:linear-gradient(180deg,#e5b744,#c68d20);color:#181207}
      .nexus-cookie-link{padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
      @media(max-width:680px){.nexus-cookie{left:10px;right:10px;bottom:10px}.nexus-cookie-card{padding:17px}.nexus-cookie-actions{display:grid;grid-template-columns:1fr 1fr}.nexus-cookie-actions button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function mountBanner() {
    injectStyles();
    if (!document.getElementById('nexusCookieBanner')) {
      const banner = document.createElement('section');
      banner.id = 'nexusCookieBanner';
      banner.className = 'nexus-cookie';
      banner.setAttribute('role', 'dialog');
      banner.setAttribute('aria-labelledby', 'nexusCookieTitle');
      banner.innerHTML = `
        <div class="nexus-cookie-card">
          <div class="nexus-cookie-copy">
            <strong id="nexusCookieTitle">Sua privacidade no site Nexus Core</strong>
            <p>Com sua autorização, usamos o Pixel da Meta para medir visitas, pedidos de demonstração e início de checkout. Não enviamos dados operacionais do Nexus SST. Você pode recusar ou alterar sua escolha a qualquer momento na <a href="privacidade.html">Política de Privacidade</a>.</p>
          </div>
          <div class="nexus-cookie-actions">
            <button type="button" data-cookie-choice="denied">Recusar</button>
            <button type="button" data-cookie-choice="granted">Aceitar</button>
          </div>
        </div>`;
      document.body.appendChild(banner);
      banner.querySelectorAll('[data-cookie-choice]').forEach(button => {
        button.addEventListener('click', () => {
          const choice = button.dataset.cookieChoice;
          writePreference(choice);
          banner.classList.remove('visible');
          if (choice === 'granted') initializePixel();
          else revokePixel();
        });
      });
    }

    document.querySelectorAll('[data-cookie-preferences]').forEach(button => {
      button.addEventListener('click', () => document.getElementById('nexusCookieBanner')?.classList.add('visible'));
    });

    if (preference === 'unknown') document.getElementById('nexusCookieBanner')?.classList.add('visible');
  }

  window.NexusMarketing = Object.freeze({
    track,
    getPreference: () => preference,
    openPreferences: () => document.getElementById('nexusCookieBanner')?.classList.add('visible')
  });

  if (preference === 'granted') initializePixel();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBanner, { once: true });
  else mountBanner();
})();
