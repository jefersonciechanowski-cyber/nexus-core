/* Nexus Central: low-cost support alert monitor.
   Reads only metadata permitted by the existing admin AAL2 RLS policy.
   Browser alerts are opt-in; no notifications with customer text or email.
   This runs only while the Central page is open (not a background push service). */
(() => {
  'use strict';

  const POLL_INTERVAL_MS = 60_000;
  const OVERDUE_MS = 10 * 60_000;
  const MAX_ROWS = 100;
  const nav = document.querySelector('.side .nav button[data-view="support"]');
  const enableButton = document.getElementById('supportEnableBrowserAlerts');
  const summary = document.getElementById('supportAlertSummary');
  if (!nav || !summary) return;

  const originalTitle = document.title;
  let initialized = false;
  let latestOpenId = '';
  let latestOpenTime = 0;
  let inFlight = false;
  let stopped = false;
  let totalOpen = 0;

  function browserSupported() {
    return 'Notification' in window && window.isSecureContext;
  }

  function refreshPermissionButton() {
    if (!enableButton) return;
    enableButton.hidden = !browserSupported();
    if (!browserSupported()) return;
    const permission = window.Notification.permission;
    enableButton.disabled = permission !== 'default';
    enableButton.textContent = permission === 'granted'
      ? 'Alertas do navegador ativos'
      : permission === 'denied'
        ? 'Notificações bloqueadas no navegador'
        : 'Ativar alertas do navegador';
  }

  function showToast() {
    const existing = document.getElementById('centralSupportNewToast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'centralSupportNewToast';
    toast.className = 'central-support-new-toast';
    toast.setAttribute('role','status');
    const label = document.createElement('span');
    label.textContent = 'Novo chamado de suporte recebido';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Ver chamado';
    open.addEventListener('click',() => {
      nav.click();
      toast.remove();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label','Dispensar aviso');
    close.addEventListener('click',()=>toast.remove());
    toast.append(label,open,close);
    document.body.append(toast);
  }

  function notifyNewTicket() {
    showToast();
    // A registered Web Push device receives the same event via its Service Worker.
    // Do not display a second local browser notification for the same ticket.
    if (window.NexusCentralPush?.active) return;
    if (!browserSupported() || window.Notification.permission !== 'granted') return;
    try {
      const notification = new window.Notification('Nexus Central · suporte', {
        body: 'Um novo chamado aguarda atendimento na Central.',
        tag: 'nexus-central-new-support',
        silent: false
      });
      notification.onclick = () => {
        window.focus();
        nav.click();
        notification.close();
      };
    } catch {
      // Browser notification can be unavailable even when permission was granted.
    }
  }

  function setBadge(count,overdueCount,partial) {
    totalOpen = count;
    if (count > 0) {
      nav.dataset.supportAlertCount = count > 99 ? '99+' : String(count);
      nav.dataset.supportHasOverdue = overdueCount ? 'true' : 'false';
      nav.title = count + ' chamado(s) de suporte aguardando';
      if (overdueCount) nav.title += ' · ' + overdueCount + (partial ? '+' : '') + ' há mais de 10 minutos';
      document.title = '(' + count + ') ' + originalTitle;
    } else {
      delete nav.dataset.supportAlertCount;
      delete nav.dataset.supportHasOverdue;
      nav.title = 'Suporte';
      document.title = originalTitle;
    }
    if (!count) {
      summary.textContent = 'Nenhum chamado aguardando atendimento.';
    } else {
      summary.textContent = count + ' aguardando atendimento' +
        (overdueCount ? ' · ' + overdueCount + (partial ? '+' : '') + ' há mais de 10 min' : '') + '.';
    }
  }

  async function eligibleClient() {
    if (!window.NexusAuth?.getClient) return null;
    const client = window.NexusAuth.getClient();
    const {data:sessionData,error:sessionError} = await client.auth.getSession();
    if (sessionError || !sessionData?.session?.access_token) return null;
    const {data:aal,error:aalError} = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError || aal?.currentLevel !== 'aal2') return null;
    return client;
  }

  async function check() {
    if (inFlight || stopped) return;
    inFlight = true;
    try {
      const client = await eligibleClient();
      if (!client) {
        // Never display stale counts after sign-out or MFA downgrade.
        setBadge(0,0,false);
        summary.textContent = 'Entre com autenticação em duas etapas para receber alertas.';
        initialized = false;
        latestOpenId = '';
        latestOpenTime = 0;
        return;
      }
      const {data,error,count} = await client
        .from('support_requests')
        .select('id,protocol,created_at',{count:'exact'})
        .eq('status','open')
        .order('created_at',{ascending:false})
        .limit(MAX_ROWS);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const newest = rows[0];
      const created = newest ? Date.parse(newest.created_at) || 0 : 0;
      const overdue = rows.filter(item => (Date.now() - Date.parse(item.created_at)) > OVERDUE_MS).length;
      const openCount = Number.isInteger(count) ? count : rows.length;
      const partial = openCount > rows.length;
      setBadge(openCount,overdue,partial);

      // First read establishes a baseline; do not alert for historic/test records.
      if (initialized && newest && newest.id !== latestOpenId && created > latestOpenTime) {
        notifyNewTicket();
      }
      initialized = true;
      latestOpenId = newest?.id || '';
      latestOpenTime = Math.max(latestOpenTime,created);
    } catch {
      // Failure must never be presented as zero tickets.
      summary.textContent = 'Não foi possível atualizar os alertas agora.';
    } finally {
      inFlight = false;
    }
  }

  if (enableButton) {
    enableButton.addEventListener('click',async() => {
      if (!browserSupported() || window.Notification.permission !== 'default') return;
      try { await window.Notification.requestPermission(); } catch {}
      refreshPermissionButton();
    });
  }
  refreshPermissionButton();

  window.addEventListener('nexus:central:view', event => {
    if (event.detail?.view === 'support') void check();
  });
  window.addEventListener('nexus:support:changed',() => void check());
  window.addEventListener('focus',() => void check());
  document.addEventListener('visibilitychange',() => {
    if (!document.hidden) void check();
  });
  window.addEventListener('pagehide',() => { stopped = true; });
  window.addEventListener('pageshow',() => { stopped = false; void check(); });
  // Allow the Central's asynchronous login restore to finish before the first check.
  window.setTimeout(() => void check(), 2500);
  window.setInterval(() => void check(),POLL_INTERVAL_MS);
})();
