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
  function formatDateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }
  function label(status) { return { OVERDUE: 'Vencido', DUE_7: 'Até 7 dias', DUE_15: '8 a 15 dias', DUE_30: '16 a 30 dias' }[status] || 'Atenção'; }
  function session() { try { return JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); } catch { return {}; } }
  function readableError(error, fallback = 'Não foi possível concluir a operação.') {
    const cause = error?.cause;
    const raw = cause?.message || cause?.details || error?.message || '';
    const text = String(raw);

    if (/notification_email_preferences/i.test(text) && /(could not find the table|schema cache|pgrst205)/i.test(text)) {
      return 'A tabela de preferências de e-mail ainda não foi criada no Supabase. Aplique a atualização de banco do PR #36 e tente novamente.';
    }
    if (/notification_delivery_logs/i.test(text) && /(could not find the table|schema cache|pgrst205)/i.test(text)) {
      return 'A tabela de histórico de envios ainda não foi criada no Supabase. Aplique a atualização de banco do PR #36 e tente novamente.';
    }
    if (/send-alert-emails/i.test(text) && /(not found|404|function)/i.test(text)) {
      return 'A função de envio de e-mails ainda não foi publicada no Supabase.';
    }
    if (/failed to fetch|networkerror|network request failed/i.test(text)) {
      return 'Não foi possível conectar ao serviço agora. Verifique a conexão e tente novamente.';
    }
    if (/only send testing emails to your own email address/i.test(text)) {
      return 'O domínio de teste do Resend só pode enviar para o e-mail da própria conta Resend. Confirme se o destinatário é o e-mail usado no Resend.';
    }
    if (/domain is not verified|verify a domain/i.test(text)) {
      return 'O remetente ainda não está verificado no Resend. Para enviar a outros destinatários, será necessário verificar um domínio.';
    }

    return text || fallback;
  }

  function configureAlertButton() {
    const button = $('alertButton');
    if (!button) return;
    const badge = $('alertBadge');
    const textNode = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) textNode.nodeValue = 'Alertas';
    else button.insertBefore(document.createTextNode('Alertas'), badge || null);

    if (!document.getElementById('nexusAlertTextButtonStyles')) {
      const style = document.createElement('style');
      style.id = 'nexusAlertTextButtonStyles';
      style.textContent = `
        .alert-button { width:auto !important; min-width:82px !important; padding:0 12px !important; font-size:12px !important; }
        .alert-email-actions { flex-wrap:wrap; justify-content:flex-start !important; }
        .alert-email-actions button { flex:1 1 120px; }
        @media (min-width:1181px) { .nexus-topbar { grid-template-columns:220px minmax(280px,1fr) auto auto !important; } }
        @media (min-width:901px) and (max-width:1180px) { .nexus-topbar { grid-template-columns:210px minmax(220px,1fr) auto !important; } }
        @media (min-width:761px) and (max-width:900px) { .nexus-topbar { grid-template-columns:minmax(190px,.8fr) minmax(230px,1.2fr) auto !important; } }
      `;
      document.head.appendChild(style);
    }
  }

  function configureEmailTestButton() {
    const actions = $('alertEmailSend')?.parentElement;
    if (!actions || $('alertEmailTest')) return;
    const button = document.createElement('button');
    button.id = 'alertEmailTest';
    button.className = 'ghost';
    button.type = 'button';
    button.textContent = 'Enviar teste';
    actions.insertBefore(button, $('alertEmailSend'));
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

  function filtered() {
    const category = $('alertCategory')?.value || '';
    const deadline = $('alertDeadline')?.value || '';
    const situation = $('alertSituation')?.value || 'UNREAD';
    return relevant().filter(item => (!category || item.type === category) && (!deadline || item.status === deadline) && (situation === 'ALL' || (situation === 'READ') === isRead(item)));
  }

  function checkedDeadlines() { return [...document.querySelectorAll('.alert-email-deadline:checked')].map(input => input.value); }
  function parsedRecipients() { return [...new Set($('alertEmailRecipients').value.split(/[;,\s]+/).map(value => value.trim().toLowerCase()).filter(Boolean))]; }
  function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

  function renderEmail() {
    if (!emailPreferences || !$('alertEmailEnabled')) return;
    $('alertEmailEnabled').checked = Boolean(emailPreferences.enabled);
    $('alertEmailRecipients').value = (emailPreferences.recipients || []).join(', ');
    const selected = new Set(emailPreferences.deadline_statuses || defaultDeadlines);
    document.querySelectorAll('.alert-email-deadline').forEach(input => { input.checked = selected.has(input.value); });
    $('alertEmailHistory').innerHTML = emailHistory.length ? emailHistory.map(item => `<div class="alert-email-history-item"><span><strong>${esc(item.recipient)}</strong><small>${formatDateTime(item.sent_at || item.created_at)} · ${formatDate(item.due_date)}${item.error_message ? ` · ${esc(item.error_message)}` : ''}</small></span><span class="${esc(item.status)}">${item.status === 'sent' ? 'Enviado' : 'Erro'}</span></div>`).join('') : '<small>Nenhum envio registrado.</small>';
    $('alertEmailStatus').textContent = emailPreferences.enabled ? 'Envio automático ativo. Cada alerta é enviado uma única vez por prazo e destinatário.' : 'Envio automático desativado.';
  }

  function render() {
    const all = relevant();
    const unread = all.filter(item => !isRead(item));
    const badge = $('alertBadge');
    badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    badge.hidden = unread.length === 0;
    $('alertSummary').textContent = `${unread.length} pendente(s) de ${all.length} alerta(s) ativo(s)`;
    const items = filtered();
    const current = window.NEXUS_SST_APP.getState();
    $('alertList').innerHTML = items.length ? items.map(item => { const unit = current.units.find(candidate => String(candidate.id) === String(item.employee.unitId)); const sector = current.sectors.find(candidate => String(candidate.id) === String(item.employee.sectorId)); const emailed = stateFor(item)?.email_sent_at; return `<article class="alert-item ${item.status} ${isRead(item) ? 'read' : ''}" data-key="${esc(item.id)}"><div class="alert-item-main"><span class="badge preventive-badge ${esc(item.status)}">${esc(label(item.status))}</span><strong>${esc(item.item)}</strong><p>${esc(item.employee.name)} · ${esc(unit?.name || 'Unidade não informada')} / ${esc(sector?.name || 'Setor não informado')}<br>${esc(item.type)} · vence em ${formatDate(item.due)}${emailed ? `<br>E-mail enviado em ${formatDateTime(emailed)}` : ''}</p></div><div class="alert-actions"><button class="ghost alert-open" type="button">Abrir registro</button><button class="ghost alert-toggle" type="button">${isRead(item) ? 'Marcar não lido' : 'Marcar como lido'}</button></div></article>`; }).join('') : '<div class="requirements-empty">Nenhum alerta encontrado para os filtros selecionados.</div>';
    $('alertList').querySelectorAll('.alert-item').forEach(element => {
      const item = all.find(candidate => candidate.id === element.dataset.key);
      element.querySelector('.alert-open').onclick = () => { close(); window.NexusPreventiveAgenda.openModule(item.type); };
      element.querySelector('.alert-toggle').onclick = async () => { try { await persist(item, isRead(item) ? null : new Date().toISOString()); render(); } catch (error) { console.error('Falha ao atualizar alerta.', error); window.alert('Não foi possível atualizar o alerta no Supabase.'); } };
    });
  }

  async function saveEmailPreferences() {
    const recipients = parsedRecipients();
    const deadlineStatuses = checkedDeadlines();
    const enabled = $('alertEmailEnabled').checked;
    if (recipients.length > 10 || recipients.some(recipient => !validEmail(recipient))) throw new Error('Informe até 10 endereços de e-mail válidos.');
    if (enabled && (!recipients.length || !deadlineStatuses.length)) throw new Error('Informe ao menos um destinatário e um prazo para ativar o envio.');
    const values = { enabled, recipients, deadline_statuses: deadlineStatuses };

    if (emailPreferences?.id) {
      await window.NexusData.update({ table: 'notification_email_preferences', id: emailPreferences.id, values: { ...values, updated_at: new Date().toISOString() }, label: 'preferências de e-mail' });
    } else {
      await window.NexusData.insert({ table: 'notification_email_preferences', values, label: 'preferências de e-mail' });
    }

    await loadEmailPreferences();
    if (!emailPreferences?.id) throw new Error('As preferências não puderam ser confirmadas após o salvamento.');
    renderEmail();
  }

  function emailPayload() {
    const current = window.NEXUS_SST_APP.getState();
    return relevant().map(item => ({ id: item.id, type: item.type, item: item.item, employeeName: item.employee.name, unitName: current.units.find(unit => String(unit.id) === String(item.employee.unitId))?.name || 'Unidade não informada', sectorName: current.sectors.find(sector => String(sector.id) === String(item.employee.sectorId))?.name || 'Setor não informado', due: item.due, status: item.status }));
  }

  async function sendTestEmail() {
    if (!emailPreferences?.enabled) throw new Error('Ative e salve as preferências de e-mail antes de testar.');
    if (!(emailPreferences.recipients || []).length) throw new Error('Salve ao menos um destinatário antes de testar.');
    const { data, error } = await window.NexusData.getClient().functions.invoke('send-alert-emails', { body: { test: true } });
    if (error || data?.error || data?.failed) throw new Error(data?.error || 'Não foi possível enviar o e-mail de teste.');
    $('alertEmailStatus').textContent = `E-mail de teste enviado com sucesso para ${data.sent || 0} destinatário(s).`;
  }

  async function sendEmailAlerts(manual = true) {
    if (!emailPreferences?.enabled) { if (manual) throw new Error('Ative e salve as preferências de e-mail antes de enviar.'); return; }
    const alerts = emailPayload();
    if (!alerts.length) { if (manual) $('alertEmailStatus').textContent = 'Nenhum alerta pendente para enviar.'; return; }
    const { data, error } = await window.NexusData.getClient().functions.invoke('send-alert-emails', { body: { alerts } });
    if (error || data?.error) throw new Error(data?.error || 'Não foi possível enviar os alertas por e-mail.');
    await Promise.all([loadStates(), loadEmailHistory()]);
    render();
    renderEmail();
    $('alertEmailStatus').textContent = `${data.sent || 0} envio(s) concluído(s), ${data.skipped || 0} já enviado(s) e ${data.failed || 0} falha(s).`;
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
        try { await sendEmailAlerts(false); } catch (error) { console.error('Falha no envio automático por e-mail.', error); $('alertEmailStatus').textContent = readableError(error); }
      }
    } catch (error) {
      console.error('Falha ao carregar a Central de Alertas.', error);
      $('alertSummary').textContent = 'Não foi possível carregar os alertas.';
      $('alertEmailStatus').textContent = readableError(error, 'Não foi possível carregar a integração de e-mail.');
    }
  }

  function install() {
    if (installed || !$('alertButton') || !window.NexusData || !window.NexusPreventiveAgenda) return;
    installed = true;
    configureAlertButton();
    configureEmailTestButton();
    $('alertButton').onclick = () => $('alertPanel').classList.contains('open') ? close() : open();
    $('alertClose').onclick = close;
    $('alertBackdrop').onclick = close;
    $('alertCategory').onchange = render;
    $('alertDeadline').onchange = render;
    $('alertSituation').onchange = render;
    $('alertEmailSave').onclick = event => window.NexusData.runLocked('email-preferences', async () => { try { await saveEmailPreferences(); $('alertEmailStatus').textContent = 'Preferências salvas com sucesso.'; } catch (error) { $('alertEmailStatus').textContent = readableError(error); } }, event.currentTarget);
    $('alertEmailTest').onclick = event => window.NexusData.runLocked('email-test', async () => { try { $('alertEmailStatus').textContent = 'Enviando e-mail de teste...'; await sendTestEmail(); } catch (error) { $('alertEmailStatus').textContent = readableError(error); } }, event.currentTarget);
    $('alertEmailSend').onclick = event => window.NexusData.runLocked('email-dispatch', async () => { try { $('alertEmailStatus').textContent = 'Enviando alertas...'; await sendEmailAlerts(true); } catch (error) { $('alertEmailStatus').textContent = readableError(error); } }, event.currentTarget);
    const originalRender = window.NEXUS_SST_APP.render;
    window.NEXUS_SST_APP.render = (...args) => { const result = originalRender(...args); render(); return result; };
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
