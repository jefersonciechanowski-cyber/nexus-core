(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  let states = new Map();
  let installed = false;

  function relevant() {
    return (window.NexusPreventiveAgenda?.getDeadlines?.() || []).filter(item => item.status !== 'PLANNED');
  }

  function stateFor(item) { return states.get(item.id); }
  function isRead(item) { return Boolean(stateFor(item)?.read_at); }
  function formatDate(value) { const [year, month, day] = String(value || '').slice(0, 10).split('-'); return year ? `${day}/${month}/${year}` : '—'; }
  function label(status) { return { OVERDUE: 'Vencido', DUE_7: 'Até 7 dias', DUE_15: '8 a 15 dias', DUE_30: '16 a 30 dias' }[status] || 'Atenção'; }

  async function loadStates() {
    const rows = await window.NexusData.list({ table: 'notification_alert_states', select: 'id,alert_key,category,due_date,read_at,email_sent_at,whatsapp_sent_at', label: 'alertas' });
    states = new Map(rows.map(row => [row.alert_key, row]));
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

  function render() {
    const all = relevant();
    const unread = all.filter(item => !isRead(item));
    const badge = $('alertBadge');
    badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    badge.hidden = unread.length === 0;
    $('alertSummary').textContent = `${unread.length} pendente(s) de ${all.length} alerta(s) ativo(s)`;
    const items = filtered();
    const current = window.NEXUS_SST_APP.getState();
    $('alertList').innerHTML = items.length ? items.map(item => { const unit = current.units.find(candidate => String(candidate.id) === String(item.employee.unitId)); const sector = current.sectors.find(candidate => String(candidate.id) === String(item.employee.sectorId)); return `<article class="alert-item ${item.status} ${isRead(item) ? 'read' : ''}" data-key="${esc(item.id)}"><div class="alert-item-main"><span class="badge preventive-badge ${esc(item.status)}">${esc(label(item.status))}</span><strong>${esc(item.item)}</strong><p>${esc(item.employee.name)} · ${esc(unit?.name || 'Unidade não informada')} / ${esc(sector?.name || 'Setor não informado')}<br>${esc(item.type)} · vence em ${formatDate(item.due)}</p></div><div class="alert-actions"><button class="ghost alert-open" type="button">Abrir registro</button><button class="ghost alert-toggle" type="button">${isRead(item) ? 'Marcar não lido' : 'Marcar como lido'}</button></div></article>`; }).join('') : '<div class="requirements-empty">Nenhum alerta encontrado para os filtros selecionados.</div>';
    $('alertList').querySelectorAll('.alert-item').forEach(element => {
      const item = all.find(candidate => candidate.id === element.dataset.key);
      element.querySelector('.alert-open').onclick = () => { close(); window.NexusPreventiveAgenda.openModule(item.type); };
      element.querySelector('.alert-toggle').onclick = async () => { try { await persist(item, isRead(item) ? null : new Date().toISOString()); render(); } catch (error) { console.error('Falha ao atualizar alerta.', error); window.alert('Não foi possível atualizar o alerta no Supabase.'); } };
    });
  }

  function open() { $('alertPanel').classList.add('open'); $('alertBackdrop').classList.add('open'); $('alertButton').setAttribute('aria-expanded', 'true'); render(); }
  function close() { $('alertPanel').classList.remove('open'); $('alertBackdrop').classList.remove('open'); $('alertButton').setAttribute('aria-expanded', 'false'); }

  async function refresh() {
    try { await loadStates(); render(); } catch (error) { console.error('Falha ao carregar a Central de Alertas.', error); $('alertSummary').textContent = 'Não foi possível carregar os alertas.'; }
  }

  function install() {
    if (installed || !$('alertButton') || !window.NexusData || !window.NexusPreventiveAgenda) return;
    installed = true;
    $('alertButton').onclick = () => $('alertPanel').classList.contains('open') ? close() : open();
    $('alertClose').onclick = close;
    $('alertBackdrop').onclick = close;
    $('alertCategory').onchange = render;
    $('alertDeadline').onchange = render;
    $('alertSituation').onchange = render;
    const originalRender = window.NEXUS_SST_APP.render;
    window.NEXUS_SST_APP.render = (...args) => { const result = originalRender(...args); render(); return result; };
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
