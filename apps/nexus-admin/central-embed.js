/* Embedded management documents are allowed only from the same origin.
   Direct visits keep their original header, navigation and logout controls. */
(() => {
  'use strict';
  if (window.parent === window) return;
  if (new URLSearchParams(location.search).get('embedded') !== '1') return;
  try {
    if (window.parent.location.origin !== location.origin) return;
    document.documentElement.classList.add('nexus-embedded');
  } catch {
    // A foreign-origin parent is never allowed to request the embedded presentation.
  }
})();
