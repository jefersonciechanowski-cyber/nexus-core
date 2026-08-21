(() => {
  'use strict';

  let widgetId = null;
  let token = '';

  function getSiteKey() {
    return String(window.NEXUS_SUPABASE_CONFIG?.turnstileSiteKey || '').trim();
  }

  function render() {
    const container = document.getElementById('nexus-turnstile');
    const sitekey = getSiteKey();
    if (!container || !sitekey || !window.turnstile || widgetId !== null) return;

    widgetId = window.turnstile.render(container, {
      sitekey,
      theme: 'dark',
      language: 'pt-br',
      size: 'flexible',
      appearance: 'always',
      callback: value => { token = value; },
      'expired-callback': () => { token = ''; },
      'timeout-callback': () => { token = ''; },
      'error-callback': () => { token = ''; }
    });
  }

  function requireToken() {
    if (!getSiteKey()) return undefined;
    const response = token || document.querySelector('input[name="cf-turnstile-response"]')?.value || '';
    if (!response) throw new Error('Conclua a verificação de segurança antes de continuar.');
    return response;
  }

  function reset() {
    token = '';
    if (widgetId === null || !window.turnstile?.reset) return;
    try {
      window.turnstile.reset(widgetId);
    } catch {
      widgetId = null;
      render();
    }
  }

  window.nexusTurnstileReady = render;
  window.NexusTurnstile = { requireToken, reset };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
})();
