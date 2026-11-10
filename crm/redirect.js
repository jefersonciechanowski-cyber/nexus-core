// The approved Nexus CRM capture and paid activation flow are deployed in
// the standalone CRM project. Do not duplicate checkout or lead submission here.
(() => {
  'use strict';
  const approved = new URL('https://crm.nexuscore.app.br/site-captacao');
  // Preserve campaign attribution and product-section deep links without
  // ever allowing the visitor to override the approved destination origin.
  approved.search = window.location.search;
  approved.hash = window.location.hash;
  window.location.replace(approved.href);
})();
