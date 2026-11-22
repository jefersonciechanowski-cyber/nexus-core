/* Nexus Central — retains administrative pages as same-origin, one-time-loaded tabs.
   Only existing authenticated documents handle account and courtesy changes. */
(() => {
  'use strict';
  const paths = {accounts:'accounts.html?embedded=1',courtesy:'crm-access.html?embedded=1'};
  const loaded = new Set();
  function mount(view) {
    if (!Object.hasOwn(paths,view)) return;
    const panel = document.getElementById('view-' + view);
    const frame = panel?.querySelector('iframe[data-central-embedded]');
    const status = panel?.querySelector('[data-central-embedded-status]');
    if (!frame || loaded.has(view)) return;
    loaded.add(view);
    if (status) status.hidden = false;
    frame.addEventListener('load', () => {
      // The old page is loaded only inside this section and never replaces the Central shell.
      if (status) status.hidden = true;
      frame.hidden = false;
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
