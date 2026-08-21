(() => {
  'use strict';

  const path = window.location.pathname;
  const isAdminRoute = path.includes('/apps/nexus-admin/');
  const isLoginRoute = /\/apps\/nexus-admin\/login\.html$/.test(path);
  if (!isAdminRoute || isLoginRoute) return;

  document.documentElement.style.visibility = 'hidden';

  const loginUrl = '/apps/nexus-admin/login.html';
  let attempts = 0;

  async function denyAccess() {
    try {
      if (window.NexusAuth?.logout) await window.NexusAuth.logout();
    } catch {}
    window.location.replace(loginUrl);
  }

  async function enforceAdmin() {
    if (!window.NexusAuth?.restoreSession) {
      attempts += 1;
      if (attempts <= 120) {
        window.setTimeout(enforceAdmin, 25);
        return;
      }
      await denyAccess();
      return;
    }

    try {
      const session = await window.NexusAuth.restoreSession();
      if (!session || session.role !== 'nexus_admin') {
        await denyAccess();
        return;
      }
      document.documentElement.style.visibility = '';
    } catch {
      await denyAccess();
    }
  }

  enforceAdmin();
})();
