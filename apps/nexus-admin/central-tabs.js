/* Central Nexus: persistent single-page navigation and same-origin admin tabs.
   No privileged action is executed here: embedded pages keep their own auth/RLS. */
(() => {
  'use strict';
  const paths = {accounts:'accounts?embedded=1',courtesy:'crm-access?embedded=1'};
  const alternatePaths = {accounts:'accounts.html?embedded=1',courtesy:'crm-access.html?embedded=1'};
  const triedAlternate = new Set();
  const loaded = new Set();
  const navigation = [
    ['ai','Nexus AI','Nexus AI','IA'],
    ['overview','Visão Geral','Visão geral','Geral'],
    ['accounts','Contas e Consultorias','Contas','Contas'],
    ['clients','Clientes e Acessos','Clientes','Clientes'],
    ['products','Produtos e Planos','Planos','Planos'],
    ['payments','Pagamentos','Pagamentos','Pag.'],
    ['courtesy','Cortesias CRM','Cortesias','Cort.']
  ];
  const nav = document.querySelector('.side .nav');
  function normalizeNavigation() {
    if (!nav) return;
    const selected = navigation.map(([view,label,text,short]) => {
      const button = Array.from(nav.querySelectorAll('button[data-view]'))
        .find(item => item.dataset.view === view);
      if (!button) return null;
      if (button.textContent !== text) button.textContent = text;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label',label);
      if (button.title !== label) button.title = label;
      if (button.dataset.short !== short) button.dataset.short = short;
      return button;
    });
    if (selected.some(item => !item)) return;
    const current = Array.from(nav.children);
    if (current.length !== selected.length || current.some((node,i) => node !== selected[i])) {
      // Clean up extra/legacy links introduced after initial render without
      // replacing the actual seven button nodes or their event listeners.
      nav.replaceChildren(...selected);
    }
  }
  normalizeNavigation();
  if (nav && typeof MutationObserver !== 'undefined') {
    new MutationObserver(normalizeNavigation).observe(nav,{childList:true});
  }

  function openTab(view) {
    document.querySelector('.side .nav button[data-view="' + view + '"]')?.click();
  }
  function updateFrameHeight(frame) {
    try {
      if (frame.hidden) return;
      const doc = frame.contentDocument;
      if (!doc || doc.location?.origin !== location.origin) return;
      const desired = Math.ceil(Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0
      )) + 12;
      if (desired > 100 && desired < 12000) frame.style.height = Math.max(540,desired) + 'px';
    } catch {}
  }
  const observers = new Map();
  function mount(view,refresh=false) {
    if (!Object.hasOwn(paths,view)) return;
    const panel = document.getElementById('view-' + view);
    const frame = panel?.querySelector('iframe[data-central-embedded]');
    const status = panel?.querySelector('[data-central-embedded-status]');
    if (!frame || (loaded.has(view) && !refresh)) return;
    loaded.add(view);
    triedAlternate.delete(view);
    if (status) {
      if (status.firstChild?.nodeType === 3) status.firstChild.textContent = 'Carregando ' + (view === 'accounts' ? 'Contas e Consultorias' : 'Cortesias CRM') + '… ';
      status.hidden = false;
    }
    panel.setAttribute('aria-busy','true');
    frame.hidden = true;
    if (observers.has(view)) {
      observers.get(view).disconnect();
      observers.delete(view);
    }
    if (!frame.dataset.loadBound) {
      frame.dataset.loadBound='true';
      frame.addEventListener('load',() => {
        let valid = false;
        try {
          const inner = frame.contentWindow,doc = inner?.document;
          const canonical = (inner?.location?.pathname || '').replace(/\/$/, '');
          const target = view === 'accounts' ? 'accounts' : 'crm-access';
          valid = Boolean(inner && inner.location.origin === location.origin &&
            (canonical.endsWith('/' + target) || canonical.endsWith('/' + target + '.html')) &&
            doc?.getElementById(view === 'accounts' ? 'accountForm' : 'courtesyForm'));
          if (valid) {
            // Cloudflare may strip ?embedded=1 during canonical redirects.
            doc.documentElement.classList.add('nexus-embedded');
            frame.hidden = false;
            if (status) status.hidden = true;
            if (typeof ResizeObserver !== 'undefined') {
              const observer = new ResizeObserver(() => updateFrameHeight(frame));
              observer.observe(doc.body);
              observers.set(view,observer);
            }
            requestAnimationFrame(() => updateFrameHeight(frame));
          }
        } catch {}
        if (!valid) {
          if (!triedAlternate.has(view)) {
            triedAlternate.add(view);
            frame.src = alternatePaths[view]; // Retry only once with the .html alias.
            return;
          }
          frame.hidden = true;
          loaded.delete(view); // Allow a retry if this route was not ready.
          if (status) {
            if (status.firstChild?.nodeType === 3) status.firstChild.textContent = 'Não foi possível abrir esta aba dentro da Central. ';
            status.hidden = false;
          }
        }
        panel.setAttribute('aria-busy','false');
      });
    }
    frame.src = paths[view];
  }
  window.addEventListener('nexus:central:view',event => {
    mount(event.detail?.view);
    const frame = document.querySelector('#view-' + event.detail?.view + ' iframe[data-central-embedded]');
    if (frame && !frame.hidden) requestAnimationFrame(() => updateFrameHeight(frame));
  });
  document.addEventListener('DOMContentLoaded',() => {
    document.querySelectorAll('[data-central-open]').forEach(control =>
      control.addEventListener('click',() => openTab(control.dataset.centralOpen)));
    document.querySelectorAll('[data-central-retry]').forEach(control =>
      control.addEventListener('click',() => mount(control.dataset.centralRetry,true)));
    if (Object.hasOwn(paths,location.hash.slice(1))) mount(location.hash.slice(1));
  });
})();
