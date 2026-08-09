(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const same = (a, b) => String(a ?? '') === String(b ?? '');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  let calendarDate = new Date();

  function state() { return window.NEXUS_SST_APP?.getState?.(); }
  function iso(value) { return String(value || '').slice(0, 10); }
  function dateIso(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function formatDate(value) { const [y, m, d] = iso(value).split('-'); return y && m && d ? `${d}/${m}/${y}` : '—'; }
  function addDays(value, days) { const date = new Date(`${iso(value)}T12:00:00`); if (Number.isNaN(date.getTime())) return ''; date.setDate(date.getDate() + Number(days || 0)); return dateIso(date); }
  function daysUntil(value) { const target = new Date(`${iso(value)}T12:00:00`); const today = new Date(); today.setHours(12, 0, 0, 0); return Number.isNaN(target.getTime()) ? null : Math.ceil((target - today) / 86400000); }
  function level(due) { const days = daysUntil(due); if (days === null) return 'MISSING'; if (days < 0) return 'OVERDUE'; if (days <= 7) return 'DUE_7'; if (days <= 15) return 'DUE_15'; if (days <= 30) return 'DUE_30'; return 'PLANNED'; }
  function label(status) { return { OVERDUE: 'Vencido', DUE_7: 'Até 7 dias', DUE_15: '8 a 15 dias', DUE_30: '16 a 30 dias', PLANNED: 'Planejado' }[status] || 'Sem prazo'; }

  function ruleMatches(rule, employee) {
    return rule.active !== false
      && (!rule.unitId || same(rule.unitId, employee.unitId))
      && (!rule.sectorId || same(rule.sectorId, employee.sectorId))
      && (!rule.jobRoleId || same(rule.jobRoleId, employee.jobRoleId));
  }

  function latest(items, dateField) { return items.slice().sort((a, b) => iso(b[dateField]).localeCompare(iso(a[dateField])))[0]; }

  function buildDeadlines() {
    const current = state();
    if (!current) return [];
    const deadlines = [];
    const employees = current.employees.filter(employee => employee.active !== false && employee.status !== 'Inativo');
    employees.forEach(employee => {
      current.matrixRules.filter(rule => ruleMatches(rule, employee)).forEach(rule => {
        let due = '';
        if (rule.type === 'Treinamento') {
          const record = latest(current.trainingRecords.filter(item => same(item.employeeId, employee.id) && same(item.trainingTypeId, rule.itemId)), 'date');
          due = record?.due || (record?.date && rule.validity ? addDays(record.date, rule.validity) : '');
        } else if (rule.type === 'Exame') {
          const record = latest(current.collections.filter(item => same(item.employeeId, employee.id) && (same(item.examId, rule.itemId) || same(item.examTypeId, rule.itemId))), 'date');
          due = record?.due || (record?.date && rule.validity ? addDays(record.date, rule.validity) : '');
        } else if (rule.type === 'EPI') {
          const movement = latest(current.epiMovements.filter(item => item.status === 'Entregue' && item.isActive && same(item.employeeId, employee.id) && same(item.epiId, rule.itemId)), 'date');
          due = movement?.dueDate || (movement?.date && (movement.appliedValidity || rule.validity) ? addDays(movement.date, movement.appliedValidity || rule.validity) : '');
        }
        if (!due) return;
        deadlines.push({ id: `${rule.type}:${employee.id}:${rule.id}`, type: rule.type, item: rule.itemName || 'Obrigação SST', employee, due, status: level(due) });
      });
    });
    return deadlines.sort((a, b) => a.due.localeCompare(b.due));
  }

  function options(id, items, placeholder) {
    const select = $(id); if (!select) return;
    const value = select.value;
    select.innerHTML = `<option value="">${esc(placeholder)}</option>${items.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
    if ([...select.options].some(option => option.value === value)) select.value = value;
  }

  function filters() {
    return { unit: $('preventiveUnit').value, sector: $('preventiveSector').value, employee: $('preventiveEmployee').value, type: $('preventiveType').value, status: $('preventiveStatus').value, start: $('preventiveStart').value, end: $('preventiveEnd').value, search: $('preventiveSearch').value.trim().toLowerCase() };
  }

  function filtered(deadlines) {
    const selected = filters();
    return deadlines.filter(item => (!selected.unit || same(item.employee.unitId, selected.unit)) && (!selected.sector || same(item.employee.sectorId, selected.sector)) && (!selected.employee || same(item.employee.id, selected.employee)) && (!selected.type || item.type === selected.type) && (!selected.status || item.status === selected.status) && (!selected.start || item.due >= selected.start) && (!selected.end || item.due <= selected.end) && (!selected.search || `${item.employee.name} ${item.item} ${item.type}`.toLowerCase().includes(selected.search)));
  }

  function renderCalendar(items) {
    const year = calendarDate.getFullYear(), month = calendarDate.getMonth();
    $('preventiveMonthLabel').textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(calendarDate);
    const first = new Date(year, month, 1), lastDay = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let index = 0; index < first.getDay(); index += 1) cells.push('<div class="preventive-day muted"></div>');
    for (let day = 1; day <= lastDay; day += 1) {
      const date = dateIso(new Date(year, month, day));
      const due = items.filter(item => item.due === date);
      cells.push(`<button class="preventive-day${date === dateIso(new Date()) ? ' today' : ''}" data-date="${date}" type="button"><strong>${day}</strong>${due.slice(0, 3).map(item => `<span class="preventive-dot ${item.status}" title="${esc(item.item)}"></span>`).join('')}${due.length > 3 ? `<small>+${due.length - 3}</small>` : ''}</button>`);
    }
    $('preventiveCalendar').innerHTML = `<div class="preventive-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="preventive-days">${cells.join('')}</div>`;
    $('preventiveCalendar').querySelectorAll('[data-date]').forEach(button => button.onclick = () => { $('preventiveStart').value = button.dataset.date; $('preventiveEnd').value = button.dataset.date; render(); });
  }

  function openModule(type) {
    const tab = document.querySelector(`[data-tab="${type === 'Treinamento' ? 'treinamentos' : type === 'EPI' ? 'epis' : 'coletas'}"]`);
    tab?.click();
  }

  function render() {
    const current = state(); if (!current) return;
    options('preventiveUnit', current.units, 'Todas as unidades');
    const unit = $('preventiveUnit').value;
    options('preventiveSector', current.sectors.filter(item => !unit || same(item.unitId, unit)), 'Todos os setores');
    const sector = $('preventiveSector').value;
    options('preventiveEmployee', current.employees.filter(item => (!unit || same(item.unitId, unit)) && (!sector || same(item.sectorId, sector))), 'Todos os colaboradores');
    const all = buildDeadlines();
    const items = filtered(all);
    ['OVERDUE', 'DUE_7', 'DUE_15', 'DUE_30'].forEach((status, index) => { $(`preventive${status === 'OVERDUE' ? 'Overdue' : [7, 15, 30][index - 1]}`).textContent = items.filter(item => item.status === status).length; });
    $('preventiveSummary').textContent = `${items.length} obrigação(ões) encontrada(s) · dados atualizados pelo Supabase`;
    const people = new Map(); items.forEach(item => people.set(item.employee.id, { employee: item.employee, count: (people.get(item.employee.id)?.count || 0) + 1, critical: (people.get(item.employee.id)?.critical || 0) + (item.status === 'OVERDUE' ? 1 : 0) }));
    $('preventivePeople').innerHTML = people.size ? [...people.values()].sort((a, b) => b.critical - a.critical || b.count - a.count).slice(0, 10).map(({ employee, count, critical }) => `<div class="preventive-person"><div><strong>${esc(employee.name)}</strong><small>${esc(current.sectors.find(item => same(item.id, employee.sectorId))?.name || 'Setor não informado')}</small></div><span class="badge ${critical ? 'badge-critico' : 'badge-atencao'}">${critical ? `${critical} vencido(s)` : `${count} prazo(s)`}</span></div>`).join('') : '<div class="requirements-empty">Nenhum colaborador afetado pelos filtros.</div>';
    $('preventiveTable').innerHTML = items.length ? items.map(item => `<tr><td><strong>${formatDate(item.due)}</strong><br><small>${daysUntil(item.due)} dia(s)</small></td><td><span class="badge preventive-badge ${item.status}">${label(item.status)}</span></td><td><strong>${esc(item.item)}</strong><br><small>${esc(item.type)}</small></td><td>${esc(item.employee.name)}</td><td>${esc(current.units.find(unitItem => same(unitItem.id, item.employee.unitId))?.name || '—')}<br><small>${esc(current.sectors.find(sectorItem => same(sectorItem.id, item.employee.sectorId))?.name || '—')}</small></td><td><button class="ghost preventive-open" data-type="${esc(item.type)}" type="button">Abrir registro</button></td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;">Nenhuma obrigação encontrada no período selecionado.</td></tr>';
    $('preventiveTable').querySelectorAll('.preventive-open').forEach(button => button.onclick = () => openModule(button.dataset.type));
    renderCalendar(items);
  }

  function install() {
    if (!$('agenda') || !state()) return;
    ['preventiveUnit', 'preventiveSector', 'preventiveEmployee', 'preventiveType', 'preventiveStatus', 'preventiveStart', 'preventiveEnd'].forEach(id => $(id).addEventListener('change', render));
    $('preventiveSearch').addEventListener('input', render);
    $('preventiveClear').onclick = () => { ['preventiveUnit', 'preventiveSector', 'preventiveEmployee', 'preventiveType', 'preventiveStatus', 'preventiveStart', 'preventiveEnd', 'preventiveSearch'].forEach(id => { $(id).value = ''; }); render(); };
    $('preventivePrevMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() - 1); render(); };
    $('preventiveNextMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() + 1); render(); };
    $('preventiveToday').onclick = () => { calendarDate = new Date(); render(); };
    const originalRender = window.NEXUS_SST_APP.render;
    window.NEXUS_SST_APP.render = (...args) => { const result = originalRender(...args); render(); return result; };
    window.NexusPreventiveAgenda = { render };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
