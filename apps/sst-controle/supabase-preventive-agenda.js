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

  function installStyles() {
    if ($('nexusPreventiveCleanStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusPreventiveCleanStyles';
    style.textContent = `
      #agenda .preventive-layout { grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr); gap:16px; }
      #agenda .preventive-people { display:grid; gap:9px; margin-top:12px; }
      #agenda .preventive-person { padding:13px 14px; border:1px solid var(--border); border-radius:10px; background:var(--surface-subtle); }
      #agenda .preventive-person strong { font-size:13px; }
      #agenda .preventive-person small { display:block; margin-top:4px; color:var(--text-muted); }
      #agenda .table-card, #agenda > .card { box-shadow:none; }
      #agenda .table-wrap { overflow:visible; }
      #agenda .table-wrap table { width:100%; border-collapse:separate; border-spacing:0; }
      #agenda .table-wrap thead { display:none; }
      #agenda #preventiveTable { display:grid; gap:10px; }
      #agenda #preventiveTable tr { display:grid; grid-template-columns:175px minmax(240px,1.25fr) minmax(190px,.9fr) 132px; gap:20px; align-items:center; padding:16px 17px; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
      #agenda #preventiveTable td { border:0; padding:0; min-width:0; }
      #agenda .preventive-date { display:grid; gap:7px; justify-items:start; align-content:center; }
      #agenda .preventive-date strong { font-size:16px; white-space:nowrap; }
      #agenda .preventive-date small { display:block; margin-top:3px; color:var(--text-muted); }
      #agenda .preventive-date .preventive-badge { display:inline-flex; width:max-content; max-width:100%; white-space:nowrap; }
      #agenda .preventive-obligation { padding-left:2px; }
      #agenda .preventive-obligation strong { display:block; font-size:14px; line-height:1.4; overflow-wrap:anywhere; }
      #agenda .preventive-obligation small, #agenda .preventive-impact small { display:block; color:var(--text-muted); margin-top:5px; line-height:1.4; }
      #agenda .preventive-impact strong { display:block; font-size:12px; line-height:1.4; overflow-wrap:anywhere; }
      #agenda .preventive-open { width:132px; min-height:38px; padding:7px 12px; white-space:nowrap; }
      #agenda .table-header { align-items:center; gap:14px; }
      #agenda .table-header input { max-width:300px; }

      #documentacao .nexus-file-input { position:absolute !important; width:1px !important; height:1px !important; opacity:0 !important; pointer-events:none !important; }
      #documentacao .nexus-file-picker { min-height:39px; display:grid; grid-template-columns:auto minmax(0,1fr); align-items:center; gap:10px; padding:4px 5px; border:1px solid var(--border); border-radius:8px; background:var(--surface-subtle); }
      #documentacao .nexus-file-button { min-height:30px; width:auto; padding:5px 10px; white-space:nowrap; font-size:11px; }
      #documentacao .nexus-file-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); font-size:11px; font-weight:500; }

      @media (max-width:1080px) {
        #agenda .preventive-layout { grid-template-columns:1fr; }
        #agenda #preventiveTable tr { grid-template-columns:165px minmax(0,1fr) minmax(170px,.8fr); }
        #agenda #preventiveTable td:last-child { grid-column:1/-1; }
        #agenda .preventive-open { width:auto; min-width:132px; }
      }
      @media (max-width:720px) {
        #agenda #preventiveTable tr { grid-template-columns:1fr; gap:12px; padding:15px; }
        #agenda #preventiveTable td:last-child { grid-column:auto; }
        #agenda .table-header { align-items:stretch; }
        #agenda .table-header input { max-width:none; width:100%; }
        #agenda .preventive-date { grid-template-columns:minmax(0,1fr) auto; align-items:center; justify-items:stretch; }
        #agenda .preventive-date .preventive-badge { justify-self:end; }
        #agenda .preventive-open { width:100%; }
        #documentacao .nexus-file-picker { grid-template-columns:1fr; }
        #documentacao .nexus-file-button { width:100%; }
        #documentacao .nexus-file-name { padding:1px 5px 4px; }
      }
    `;
    document.head.appendChild(style);
  }

  function polishComplianceFileInputs() {
    const configs = [
      ['companyDocumentFile', 'Selecionar arquivo'],
      ['inspectionFile', 'Selecionar arquivo'],
      ['requirementFile', 'Selecionar arquivo']
    ];

    configs.forEach(([id, buttonLabel]) => {
      const input = $(id);
      if (!input || input.dataset.nexusPolished === 'true') return;
      input.dataset.nexusPolished = 'true';
      input.classList.add('nexus-file-input');

      const picker = document.createElement('span');
      picker.className = 'nexus-file-picker';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost nexus-file-button';
      button.textContent = buttonLabel;
      const fileName = document.createElement('span');
      fileName.className = 'nexus-file-name';

      const syncName = () => {
        fileName.textContent = input.files?.[0]?.name || 'Nenhum arquivo selecionado';
        fileName.title = input.files?.[0]?.name || '';
      };

      button.addEventListener('click', event => {
        event.preventDefault();
        input.click();
      });
      input.addEventListener('change', syncName);
      input.form?.addEventListener('reset', () => setTimeout(syncName, 0));

      syncName();
      picker.append(button, fileName);
      input.after(picker);
    });
  }

  function ruleMatches(rule, employee) {
    return rule.active !== false
      && (!rule.unitId || same(rule.unitId, employee.unitId))
      && (!rule.sectorId || same(rule.sectorId, employee.sectorId))
      && (!rule.jobRoleId || same(rule.jobRoleId, employee.jobRoleId));
  }

  function latest(items, dateField) { return items.slice().sort((a, b) => iso(b[dateField]).localeCompare(iso(a[dateField])))[0]; }

  function buildEmployeeDeadlines() {
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
        deadlines.push({
          id: `${rule.type}:${employee.id}:${rule.id}`,
          type: rule.type,
          item: rule.itemName || 'Obrigação SST',
          due,
          status: level(due),
          source: 'employee',
          employeeId: employee.id,
          subjectName: employee.name,
          unitId: employee.unitId || null,
          sectorId: employee.sectorId || null,
          employee
        });
      });
    });
    return deadlines;
  }

  function buildDeadlines() {
    const compliance = window.NexusCompanyCompliance?.getDeadlines?.() || [];
    return [...buildEmployeeDeadlines(), ...compliance].sort((a, b) => String(a.due).localeCompare(String(b.due)));
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
    return deadlines.filter(item =>
      (!selected.unit || same(item.unitId, selected.unit))
      && (!selected.sector || same(item.sectorId, selected.sector))
      && (!selected.employee || same(item.employeeId, selected.employee))
      && (!selected.type || item.type === selected.type)
      && (!selected.status || item.status === selected.status)
      && (!selected.start || item.due >= selected.start)
      && (!selected.end || item.due <= selected.end)
      && (!selected.search || `${item.subjectName || ''} ${item.item || ''} ${item.type || ''}`.toLowerCase().includes(selected.search))
    );
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
    if (type === 'Documento' || type === 'Fiscalização') {
      window.NexusCompanyCompliance?.openModule?.(type);
      return;
    }
    const tab = document.querySelector(`[data-tab="${type === 'Treinamento' ? 'treinamentos' : type === 'EPI' ? 'epis' : 'coletas'}"]`);
    tab?.click();
  }

  function impactLocation(item, current) {
    const unit = current.units.find(candidate => same(candidate.id, item.unitId));
    const sector = current.sectors.find(candidate => same(candidate.id, item.sectorId));
    if (sector) return `${unit?.name || 'Unidade'} / ${sector.name}`;
    if (unit) return unit.name;
    return item.source === 'employee' ? 'Local não informado' : 'Empresa inteira';
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
    ['OVERDUE', 'DUE_7', 'DUE_15', 'DUE_30'].forEach((status, index) => {
      const target = status === 'OVERDUE' ? 'preventiveOverdue' : `preventive${[7, 15, 30][index - 1]}`;
      $(target).textContent = items.filter(item => item.status === status).length;
    });

    $('preventiveSummary').textContent = `${items.length} obrigação${items.length === 1 ? '' : 'ões'} no período selecionado`;
    const people = new Map();
    items.forEach(item => {
      const key = item.employeeId ? `employee:${item.employeeId}` : `${item.source}:${item.subjectName}:${item.unitId || ''}`;
      const previous = people.get(key) || { subjectName:item.subjectName || 'Empresa', unitId:item.unitId, sectorId:item.sectorId, count:0, critical:0, source:item.source };
      previous.count += 1;
      previous.critical += item.status === 'OVERDUE' ? 1 : 0;
      people.set(key, previous);
    });

    $('preventivePeople').innerHTML = people.size ? [...people.values()]
      .sort((a, b) => b.critical - a.critical || b.count - a.count)
      .slice(0, 10)
      .map(item => `<div class="preventive-person"><div><strong>${esc(item.subjectName)}</strong><small>${esc(impactLocation(item, current))}</small></div><span class="badge ${item.critical ? 'badge-critico' : 'badge-atencao'}">${item.critical ? `${item.critical} vencido(s)` : `${item.count} prazo(s)`}</span></div>`)
      .join('') : '<div class="requirements-empty">Nenhum impacto encontrado pelos filtros.</div>';

    $('preventiveTable').innerHTML = items.length ? items.map(item => {
      const days = daysUntil(item.due);
      return `<tr>
        <td><div class="preventive-date"><div><strong>${formatDate(item.due)}</strong><small>${days < 0 ? `${Math.abs(days)} dia(s) vencido` : `${days} dia(s)`}</small></div><span class="badge preventive-badge ${item.status}">${label(item.status)}</span></div></td>
        <td class="preventive-obligation"><strong>${esc(item.item)}</strong><small>${esc(item.type)}</small></td>
        <td class="preventive-impact"><strong>${esc(item.subjectName || 'Empresa')}</strong><small>${esc(impactLocation(item, current))}</small></td>
        <td><button class="ghost preventive-open" data-type="${esc(item.type)}" type="button">Abrir registro</button></td>
      </tr>`;
    }).join('') : '<tr><td style="text-align:center;">Nenhuma obrigação encontrada no período selecionado.</td></tr>';
    $('preventiveTable').querySelectorAll('.preventive-open').forEach(button => button.onclick = () => openModule(button.dataset.type));
    renderCalendar(items);
    polishComplianceFileInputs();
  }

  function ensureComplianceScript() {
    if (window.NexusCompanyCompliance) {
      polishComplianceFileInputs();
      return;
    }
    if (document.querySelector('script[data-nexus-compliance]')) return;
    const script = document.createElement('script');
    script.src = 'supabase-company-compliance.js';
    script.dataset.nexusCompliance = 'true';
    script.onload = () => {
      polishComplianceFileInputs();
      render();
    };
    document.body.appendChild(script);
  }

  function install() {
    if (!$('agenda') || !state()) return;
    installStyles();
    const typeSelect = $('preventiveType');
    if (typeSelect && ![...typeSelect.options].some(option => option.value === 'Documento')) {
      typeSelect.insertAdjacentHTML('beforeend', '<option value="Documento">Documentos da empresa</option><option value="Fiscalização">Fiscalizações</option>');
    }
    const agendaSubtitle = $('agenda').querySelector('p.subtitle');
    if (agendaSubtitle) agendaSubtitle.textContent = 'Centralize exames, treinamentos, EPIs, documentos e exigências oficiais para agir antes do vencimento.';
    const peopleHeading = $('preventivePeople')?.closest('.card')?.querySelector('h3');
    if (peopleHeading) peopleHeading.textContent = 'Impactados no período';
    if ($('preventiveSearch')) $('preventiveSearch').placeholder = 'Pesquisar obrigação ou responsável';

    ['preventiveUnit', 'preventiveSector', 'preventiveEmployee', 'preventiveType', 'preventiveStatus', 'preventiveStart', 'preventiveEnd'].forEach(id => $(id).addEventListener('change', render));
    $('preventiveSearch').addEventListener('input', render);
    $('preventiveClear').onclick = () => { ['preventiveUnit', 'preventiveSector', 'preventiveEmployee', 'preventiveType', 'preventiveStatus', 'preventiveStart', 'preventiveEnd', 'preventiveSearch'].forEach(id => { $(id).value = ''; }); render(); };
    $('preventivePrevMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() - 1); render(); };
    $('preventiveNextMonth').onclick = () => { calendarDate.setMonth(calendarDate.getMonth() + 1); render(); };
    $('preventiveToday').onclick = () => { calendarDate = new Date(); render(); };
    const originalRender = window.NEXUS_SST_APP.render;
    window.NEXUS_SST_APP.render = (...args) => { const result = originalRender(...args); render(); return result; };
    window.NexusPreventiveAgenda = { render, getDeadlines: buildDeadlines, openModule };
    ensureComplianceScript();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();