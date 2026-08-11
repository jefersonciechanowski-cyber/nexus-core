(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const defaultDeadlines = ['OVERDUE', 'DUE_7', 'DUE_15', 'DUE_30'];
  let states = new Map();
  let emailPreferences = null;
  let emailHistory = [];
  let installed = false;
  let autoEmailAttempted = false;

  function relevant() {
    return (window.NexusPreventiveAgenda?.getDeadlines?.() || []).filter(item => item.status !== 'PLANNED');
  }

  function stateFor(item) { return states.get(item.id); }
  function isRead(item) { return Boolean(stateFor(item)?.read_at); }
  function formatDate(value) { const [year, month, day] = String(value || '').slice(0, 10).split('-'); return year ? `${day}/${month}/${year}` : '—'; }
  function label(status) { return { OVERDUE: 'Vencido', DUE_7: 'Até 7 dias', DUE_15: '8 a 15 dias', DUE_30: '16 a 30 dias' }[status] || 'Atenção'; }
  function session() { try { return JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); } catch { return {}; } }
  function readableError(error, fallback = 'Não foi possível concluir a operação.') {
    const cause = error?.cause;
    const raw = cause?.message || cause?.details || error?.message || '';
    const text = String(raw);
    if (/notification_email_preferences/i.test(text) && /(could not find the table|schema cache|pgrst205)/i.test(text)) return 'A configuração de e-mail ainda não está disponível. Atualize a página e tente novamente.';
    if (/send-alert-emails/i.test(text) && /(not found|404|function)/i.test(text)) return 'O envio de e-mail está temporariamente indisponível.';
    if (/failed to fetch|networkerror|network request failed/i.test(text)) return 'Não foi possível conectar ao serviço agora. Tente novamente.';
    if (/only send testing emails to your own email address/i.test(text)) return 'Este remetente ainda está limitado ao e-mail da conta de envio.';
    if (/domain is not verified|verify a domain/i.test(text)) return 'O remetente de e-mail ainda precisa ser verificado.';
    return text || fallback;
  }

  function configureAlertButton() {
    const button = $('alertButton');
    if (!button) return;
    const badge = $('alertBadge');
    const textNode = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = 'Alertas';
    else button.insertBefore(document.createTextNode('Alertas'), badge || null);

    if (!document.getElementById('nexusAlertSimpleStyles')) {
      const style = document.createElement('style');
      style.id = 'nexusAlertSimpleStyles';
      style.textContent = `
        .alert-button { width:auto !important; min-width:82px !important; padding:0 12px !important; font-size:12px !important; }
        .alert-panel { width:min(400px,100%) !important; right:-420px !important; padding:24px 22px !important; }
        .alert-panel.open { right:0 !important; }
        .alert-panel-filters { display:none !important; }
        .alert-list { margin-top:20px; gap:10px !important; }
        .alert-item { padding:14px !important; border-radius:10px !important; }
        .alert-item-main > strong { display:block; margin:8px 0 5px; font-size:14px; }
        .alert-item-main p { line-height:1.55; }
        .alert-actions { margin-top:10px; justify-content:flex-start !important; }
        .alert-actions .alert-toggle { display:none !important; }
        .alert-actions .alert-open { min-height:34px; padding:6px 11px; font-size:11px; }
        .alert-email { margin:20px 0 0 !important; padding:14px !important; background:transparent !important; }
        .alert-email-head { align-items:flex-start !important; }
        .alert-email-head strong { font-size:13px; }
        .alert-email-head small { display:block; margin-top:3px; line-height:1.4; }
        .alert-email-grid { margin:12px 0 10px !important; }
        .alert-email-options, .alert-email-history, #alertEmailSend, #alertEmailTest { display:none !important; }
        .alert-email-actions { display:block !important; }
        #alertEmailSave { width:100%; min-height:38px; }
        .alert-email-status { margin:8px 0 0; min-height:15px; }
        @media (min-width:1181px) { .nexus-topbar { grid-template-columns:220px minmax(280px,1fr) auto auto !important; } }
        @media (min-width:901px) and (max-width:1180px) { .nexus-topbar { grid-template-columns:210px minmax(220px,1fr) auto !important; } }
        @media (min-width:761px) and (max-width:900px) { .nexus-topbar { grid-template-columns:minmax(190px,.8fr) minmax(230px,1.2fr) auto !important; } }
      `;
      document.head.appendChild(style);
    }
  }

  function configureSimpleLayout() {
    const email = document.querySelector('.alert-email');
    const list = $('alertList');
    if (email && list && list.nextElementSibling !== email) list.after(email);
    const emailTitle = email?.querySelector('.alert-email-head strong');
    const emailHelp = email?.querySelector('.alert-email-head small');
    const recipientLabel = $('alertEmailRecipients')?.closest('label');
    if (emailTitle) emailTitle.textContent = 'Receber alertas por e-mail';
    if (emailHelp) emailHelp.textContent = 'Avisos de vencimento serão enviados automaticamente.';
    if (recipientLabel) recipientLabel.childNodes[0].nodeValue = 'E-mail';
    if ($('alertEmailSave')) $('alertEmailSave').textContent = 'Salvar';
  }

  async function loadStates() {
    const rows = await window.NexusData.list({ table: 'notification_alert_states', select: 'id,alert_key,category,due_date,read_at,email_sent_at,whatsapp_sent_at', label: 'alertas' });
    states = new Map(rows.map(row => [row.alert_key, row]));
  }
  async function loadEmailPreferences() {
    const rows = await window.NexusData.list({ table: 'notification_email_preferences', select: 'id,enabled,recipients,deadline_statuses,updated_at', label: 'preferências de e-mail' });
    emailPreferences = rows[0] || { enabled: false, recipients: session().email ? [session().email] : [], deadline_statuses: defaultDeadlines };
  }
  async function loadEmailHistory() {
    const rows = await window.NexusData.list({ table: 'notification_delivery_logs', select: 'id,alert_key,due_date,recipient,status,error_message,sent_at,created_at', filters: [{ column: 'channel', value: 'email' }], order: { column: 'created_at', ascending: false }, label: 'histórico de e-mails' });
    emailHistory = rows.slice(0, 8);
  }

  async function persist(item, readAt) {
    const existing = stateFor(item);
    const values = { category: item.type, due_date: item.due, last_seen_at: new Date().toISOString(), read_at: readAt, updated_at: new Date().toISOString() };
    const rows = existing
      ? await window.NexusData.update({ table: 'notification_alert_states', id: existing.id, values, select: 'id,alert_key,category,due_date,read_at,email_sent_at,whatsapp_sent_at', label: 'alerta' })
      : await window.NexusData.insert({ table: 'notification_alert_states', values: { alert_key: item.id, ...values }, select: 'id,alert_key,category,due_date,read_at,email_sent_at,whatsapp_sent_at', label: 'alerta' });
    states.set(item.id, rows[0]);
  }

  function pending() { return relevant().filter(item => !isRead(item)); }
  function parsedRecipients() { return [...new Set($('alertEmailRecipients').value.split(/[;,\s]+/).map(value => value.trim().toLowerCase()).filter(Boolean))]; }
  function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

  function renderEmail() {
    if (!emailPreferences || !$('alertEmailEnabled')) return;
    $('alertEmailEnabled').checked = Boolean(emailPreferences.enabled);
    $('alertEmailRecipients').value = (emailPreferences.recipients || []).join(', ');
    document.querySelectorAll('.alert-email-deadline').forEach(input => { input.checked = true; });
    if ($('alertEmailHistory')) $('alertEmailHistory').innerHTML = '';
    $('alertEmailStatus').textContent = emailPreferences.enabled ? 'Alertas por e-mail ativados.' : 'Alertas por e-mail desativados.';
  }

  function render() {
    const all = relevant();
    const items = pending();
    const badge = $('alertBadge');
    badge.textContent = items.length > 99 ? '99+' : String(items.length);
    badge.hidden = items.length === 0;
    $('alertSummary').textContent = items.length ? `${items.length} alerta(s) pendente(s)` : 'Nenhum alerta pendente';
    const current = window.NEXUS_SST_APP.getState();
    $('alertList').innerHTML = items.length ? items.map(item => {
      const unit = current.units.find(candidate => String(candidate.id) === String(item.unitId));
      const sector = current.sectors.find(candidate => String(candidate.id) === String(item.sectorId));
      const location = sector ? `${unit?.name || 'Unidade'} / ${sector.name}` : (unit?.name || (item.source === 'employee' ? 'Local não informado' : 'Empresa inteira'));
      return `<article class="alert-item ${item.status}" data-key="${esc(item.id)}"><div class="alert-item-main"><span class="badge preventive-badge ${esc(item.status)}">${esc(label(item.status))}</span><strong>${esc(item.item)}</strong><p>${esc(item.subjectName || 'Empresa')} · ${esc(location)}<br>Vencimento: ${formatDate(item.due)}</p></div><div class="alert-actions"><button class="ghost alert-open" type="button">Abrir registro</button></div></article>`;
    }).join('') : '<div class="requirements-empty">Você não tem alertas pendentes.</div>';

    $('alertList').querySelectorAll('.alert-item').forEach(element => {
      const item = all.find(candidate => candidate.id === element.dataset.key);
      element.querySelector('.alert-open').onclick = async () => {
        try { if (!isRead(item)) await persist(item, new Date().toISOString()); } catch (error) { console.error('Falha ao marcar alerta como lido.', error); }
        close();
        window.NexusPreventiveAgenda.openModule(item.type);
      };
    });
  }

  async function saveEmailPreferences() {
    const recipients = parsedRecipients();
    const enabled = $('alertEmailEnabled').checked;
    if (recipients.length > 10 || recipients.some(recipient => !validEmail(recipient))) throw new Error('Informe um endereço de e-mail válido.');
    if (enabled && !recipients.length) throw new Error('Informe o e-mail que receberá os alertas.');
    const values = { enabled, recipients, deadline_statuses: defaultDeadlines };
    if (emailPreferences?.id) await window.NexusData.update({ table: 'notification_email_preferences', id: emailPreferences.id, values: { ...values, updated_at: new Date().toISOString() }, label: 'preferências de e-mail' });
    else await window.NexusData.insert({ table: 'notification_email_preferences', values, label: 'preferências de e-mail' });
    await loadEmailPreferences();
    if (!emailPreferences?.id) throw new Error('Não foi possível confirmar a configuração de e-mail.');
    renderEmail();
  }

  function emailPayload() {
    const current = window.NEXUS_SST_APP.getState();
    return relevant().map(item => ({
      id: item.id,
      type: item.type,
      item: item.item,
      subjectName: item.subjectName || 'Empresa',
      unitName: current.units.find(unit => String(unit.id) === String(item.unitId))?.name || (item.source === 'employee' ? 'Unidade não informada' : 'Empresa inteira'),
      sectorName: current.sectors.find(sector => String(sector.id) === String(item.sectorId))?.name || (item.source === 'employee' ? 'Setor não informado' : 'Obrigação institucional'),
      due: item.due,
      status: item.status
    }));
  }

  async function sendEmailAlerts() {
    if (!emailPreferences?.enabled) return;
    const alerts = emailPayload();
    if (!alerts.length) return;
    const { data, error } = await window.NexusData.getClient().functions.invoke('send-alert-emails', { body: { alerts } });
    if (error || data?.error) throw new Error(data?.error || 'Não foi possível enviar os alertas por e-mail.');
    await Promise.all([loadStates(), loadEmailHistory()]);
    render();
  }

  function open() { $('alertPanel').classList.add('open'); $('alertBackdrop').classList.add('open'); $('alertButton').setAttribute('aria-expanded', 'true'); render(); }
  function close() { $('alertPanel').classList.remove('open'); $('alertBackdrop').classList.remove('open'); $('alertButton').setAttribute('aria-expanded', 'false'); }

  async function refresh() {
    try {
      await Promise.all([loadStates(), loadEmailPreferences(), loadEmailHistory()]);
      render();
      renderEmail();
      if (!autoEmailAttempted && emailPreferences.enabled) {
        autoEmailAttempted = true;
        try { await sendEmailAlerts(); } catch (error) { console.error('Falha no envio automático por e-mail.', error); $('alertEmailStatus').textContent = readableError(error); }
      }
    } catch (error) {
      console.error('Falha ao carregar a Central de Alertas.', error);
      $('alertSummary').textContent = 'Não foi possível carregar os alertas.';
      $('alertEmailStatus').textContent = readableError(error, 'Não foi possível carregar a configuração de e-mail.');
    }
  }

  function install() {
    if (installed || !$('alertButton') || !window.NexusData || !window.NexusPreventiveAgenda) return;
    installed = true;
    configureAlertButton();
    configureSimpleLayout();
    $('alertButton').onclick = () => $('alertPanel').classList.contains('open') ? close() : open();
    $('alertClose').onclick = close;
    $('alertBackdrop').onclick = close;
    $('alertEmailSave').onclick = event => window.NexusData.runLocked('email-preferences', async () => {
      try { await saveEmailPreferences(); $('alertEmailStatus').textContent = 'Configuração salva.'; }
      catch (error) { $('alertEmailStatus').textContent = readableError(error); }
    }, event.currentTarget);
    const originalRender = window.NEXUS_SST_APP.render;
    window.NEXUS_SST_APP.render = (...args) => { const result = originalRender(...args); render(); return result; };
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
