/* Nexus Central — retains administrative pages as same-origin, one-time-loaded tabs.
   Only existing authenticated documents handle account and courtesy changes. */
(() => {
  'use strict';
  const paths = {accounts:'accounts.html?embedded=1',courtesy:'crm-access.html?embedded=1'};
  const loaded = new Set();
  // Compact, stable navigation: exactly one tab per view, no horizontal scrolling.
  // The full label remains available to screen readers and on hover.
  const navigation = [
    ['ai','Nexus AI','Nexus AI'],
    ['overview','Visão Geral','Visão geral'],
    ['accounts','Contas e Consultorias','Contas'],
    ['clients','Clientes e Acessos','Clientes'],
    ['products','Produtos e Planos','Planos'],
    ['payments','Pagamentos','Pagamentos'],
    ['courtesy','Cortesias CRM','Cortesias']
  ];
  function normalizeNavigation() {
    const nav = document.querySelector('.side .nav');
    if (!nav) return;
    const selected = [];
    for (const [view,label,short] of navigation) {
      const button = Array.from(nav.querySelectorAll('button[data-view]'))
        .find(item => item.dataset.view === view);
      if (!button) continue;
      button.textContent = short;
      button.setAttribute('aria-label',label);
      button.title = label;
      selected.push(button);
    }
    // Preserve unexpected navigation links inside the existing Tools menu.
    const tools = document.querySelector('.central-tools-menu');
    for (const link of nav.querySelectorAll('a[href]')) {
      if (!tools) continue;
      link.classList.add('central-tool-link');
      tools.appendChild(link);
    }
    if (selected.length === navigation.length) nav.replaceChildren(...selected);
  }
  normalizeNavigation();
  function mount(view) {
    if (!Object.hasOwn(paths,view)) return;
    const panel = document.getElementById('view-' + view);
    const frame = panel?.querySelector('iframe[data-central-embedded]');
    const status = panel?.querySelector('[data-central-embedded-status]');
    if (!frame || loaded.has(view)) return;
    loaded.add(view);
    if (status) status.hidden = false;
    frame.addEventListener('load', () => {
      // A blocked frame must not appear as an empty success state.
      let sameOriginReady = false;
      try {
        const inner = frame.contentWindow;
        const doc = inner?.document;
        const canonicalPath = (inner?.location?.pathname || '').replace(/\/$/, '');
        const target = paths[view].split('?')[0].replace(/\.html$/, '');
        const canonicalAllowed = canonicalPath.endsWith('/' + target) ||
          canonicalPath.endsWith('/' + target + '.html');
        const requiredForm = view === 'accounts' ? 'accountForm' : 'courtesyForm';
        sameOriginReady = Boolean(inner && inner.location.origin === location.origin &&
          canonicalAllowed && doc?.getElementById(requiredForm));
      } catch {}
      if (sameOriginReady) {
        // A canonical redirect may drop ?embedded=1; presentation is still
        // safe because the document and parent have the same checked origin.
        frame.contentDocument.documentElement.classList.add('nexus-embedded');
        if (status) status.hidden = true;
        frame.hidden = false;
      } else {
        if (status) {
          status.firstChild.textContent = 'A incorporação não foi autorizada pela hospedagem. ';
          status.hidden = false;
        }
        frame.hidden = true;
      }
      panel.setAttribute('aria-busy','false');
    }, {once:true});
    frame.src = paths[view];
    panel.setAttribute('aria-busy','true');
  }
  function openTab(view) {
    const button = document.querySelector('.nav [data-view="' + view + '"]');
    if (button) button.click();
  }
  window.addEventListener('nexus:central:view',event => mount(event.detail?.view));
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-central-open]').forEach(control => {
      control.addEventListener('click', () => openTab(control.dataset.centralOpen));
    });
    const selected = location.hash.slice(1);
    if (Object.hasOwn(paths,selected)) mount(selected);
  });
})();
