(() => {
  'use strict';

  let installed = false;
  let readinessLoading = false;
  const byId = id => document.getElementById(id);
  const state = () => window.NEXUS_SST_APP?.getState?.();
  const templates = () => window.NexusDocumentTemplates;

  function nexusDocumentLogoUrl() {
    return new URL('logo-nexus-core-document.svg', window.location.href).href;
  }

  function localDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function issuedAt() {
    return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function issuedBy() {
    const visibleUser = window.NEXUS_DEMO_USER;
    if (visibleUser?.name) return visibleUser.name;
    try {
      const session = JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}');
      return session.userName || session.fullName || session.email || 'Usuário autenticado';
    } catch {
      return 'Usuário autenticado';
    }
  }

  function documentCode(prefix) {
    const now = new Date();
    const date = localDateISO(now).replaceAll('-', '');
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join('');
    const suffix = window.crypto?.randomUUID
      ? window.crypto.randomUUID().slice(0, 4).toUpperCase()
      : Math.random().toString(16).slice(2, 6).toUpperCase();
    return `${prefix}-${date}-${time}-${suffix}`;
  }

  function preparePopup() {
    const popup = window.open('', '_blank', 'width=1180,height=820');
    if (!popup) {
      window.alert('O navegador bloqueou a prévia. Permita pop-ups para o NexusSST e tente novamente.');
      return null;
    }
    popup.opener = null;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Preparando documento...</title></head><body style="font-family:Arial,sans-serif;padding:40px;color:#0c1920">Preparando documento e registrando a emissão...</body></html>');
    popup.document.close();
    return popup;
  }

  function openDocument(html, title, popup) {
    if (!popup) return false;
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.document.title = title;
    popup.document.querySelectorAll('[data-document-action]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.documentAction === 'print') popup.print();
        if (button.dataset.documentAction === 'close') popup.close();
      });
    });
    return true;
  }

  async function logGeneration(documentType, code, sourceTrainingRecordId, scope) {
    const { error } = await window.NexusData.getClient().rpc('log_sst_document_generation', {
      p_document_type: documentType,
      p_document_code: code,
      p_source_training_record_id: sourceTrainingRecordId || null,
      p_scope: scope || {}
    });
    if (error) {
      const failure = new Error('A emissão não pôde ser registrada na auditoria. O documento não foi aberto.');
      failure.cause = error;
      throw failure;
    }
  }

  function selectOptions(element, items, placeholder, currentValue, getLabel = item => item.name) {
    if (!element) return;
    element.innerHTML = `<option value="">${templates().escapeHtml(placeholder)}</option>` + items.map(item => `<option value="${templates().escapeHtml(item.id)}">${templates().escapeHtml(getLabel(item))}</option>`).join('');
    if ([...element.options].some(option => option.value === String(currentValue || ''))) element.value = String(currentValue || '');
  }

  function filteredEmployees() {
    const current = state();
    if (!current) return [];
    const unitId = byId('documentUnit')?.value || '';
    const sectorId = byId('documentSector')?.value || '';
    const employeeId = byId('documentEmployee')?.value || '';
    return current.employees.filter(employee =>
      (!unitId || String(employee.unitId) === unitId)
      && (!sectorId || String(employee.sectorId) === sectorId)
      && (!employeeId || String(employee.id) === employeeId)
    );
  }

  function renderFilters() {
    const current = state();
    if (!current || !byId('documentUnit')) return;
    const unitValue = byId('documentUnit').value;
    const sectorValue = byId('documentSector').value;
    const employeeValue = byId('documentEmployee').value;
    selectOptions(byId('documentUnit'), current.units, 'Todas as unidades', unitValue);
    const sectors = current.sectors.filter(sector => !byId('documentUnit').value || String(sector.unitId) === byId('documentUnit').value);
    selectOptions(byId('documentSector'), sectors, 'Todos os setores', sectorValue);
    const employees = current.employees.filter(employee =>
      (!byId('documentUnit').value || String(employee.unitId) === byId('documentUnit').value)
      && (!byId('documentSector').value || String(employee.sectorId) === byId('documentSector').value)
    );
    selectOptions(byId('documentEmployee'), employees, 'Todos os colaboradores', employeeValue);
  }

  async function requireCompanyLogo() {
    const company = await window.NexusCompany?.getProfile?.();
    if (!company) throw new Error('Os dados da empresa não puderam ser carregados.');
    if (!company.logo_path || !company.logoUrl) throw new Error('Cadastre a logo da empresa em Cadastros > Empresa antes de emitir documentos personalizados.');
    return company;
  }

  async function updateReadiness() {
    const box = byId('documentReadiness');
    if (!box || readinessLoading) return;
    readinessLoading = true;
    try {
      const company = await window.NexusCompany?.getProfile?.();
      const current = state();
      const completed = current?.trainingRecordHistory?.filter(record => record.status === 'COMPLETED').length || 0;
      const cancelled = current?.trainingRecordHistory?.filter(record => record.status === 'CANCELLED').length || 0;
      const companyReady = Boolean(company?.legal_name || company?.trade_name || company?.name);
      const logoReady = Boolean(company?.logo_path && company?.logoUrl);
      box.innerHTML = `<strong>${companyReady && logoReady ? 'Central pronta para emissão' : 'Complete a identidade documental'}</strong>
        <p>Empresa: ${companyReady ? 'identificada' : 'cadastro incompleto'}<br>Logo da empresa: ${logoReady ? 'configurada' : 'pendente'}<br>Treinamentos ativos: ${completed}<br>Registros cancelados preservados: ${cancelled}</p>`;
    } catch (error) {
      console.error('Falha ao verificar a central documental.', error);
      box.innerHTML = '<strong>Central documental indisponível</strong><p>Confira a migration da etapa e os dados da empresa.</p>';
    } finally {
      readinessLoading = false;
    }
  }

  function certificateMissingFields(record) {
    const checks = [
      ['natureza do treinamento', record.trainingKind && record.trainingKind !== 'UNSPECIFIED'],
      ['nome preservado do trabalhador', record.employeeNameSnapshot],
      ['conteúdo programático', record.programContent],
      ['local de realização', record.location],
      ['qualificação do instrutor', record.instructorDocument],
      ['responsável técnico', record.technicalResponsible],
      ['qualificação do responsável técnico', record.technicalResponsibleQualification],
      ['carga horária', Number(record.workloadHours) > 0]
    ];
    return checks.filter(([, valid]) => !valid).map(([label]) => label);
  }

  async function printTrainingCertificate(recordId) {
    const current = state();
    const record = current?.trainingRecordHistory?.find(item => String(item.id) === String(recordId));
    if (!record) return window.alert('Registro de treinamento não encontrado. Atualize a página e tente novamente.');
    if (record.status !== 'COMPLETED') return window.alert('Registros cancelados permanecem no histórico, mas não podem gerar certificados.');
    const missing = certificateMissingFields(record);
    if (missing.length) return window.alert(`Este registro não possui todos os dados obrigatórios para o certificado: ${missing.join(', ')}. Registros antigos devem manter o certificado externo ou ser cancelados e refeitos com os dados completos.`);

    const popup = preparePopup();
    if (!popup) return;
    try {
      const company = await requireCompanyLogo();
      const employee = current.employees.find(item => String(item.id) === String(record.employeeId));
      const code = `CERT-${record.code}`;
      await logGeneration('TRAINING_CERTIFICATE', code, record.id, {
        record_code: record.code,
        employee_id: record.employeeId,
        training_name: record.trainingName
      });
      const html = templates().buildTrainingCertificate({
        documentCode: code,
        issuedAt: issuedAt(),
        issuedBy: issuedBy(),
        company,
        employee,
        record,
        nexusLogoUrl: nexusDocumentLogoUrl()
      });
      openDocument(html, code, popup);
    } catch (error) {
      console.error('Falha ao preparar o certificado.', error);
      popup.close?.();
      window.alert(error.message || 'Não foi possível preparar o certificado.');
    }
  }

  function daysUntil(value) {
    if (!value) return -99999;
    const target = new Date(`${value}T12:00:00`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.ceil((target - today) / 86400000);
  }

  function dueStatus(value) {
    const days = daysUntil(value);
    if (days < 0) return { label: 'Crítico', className: 'critical' };
    if (days <= 30) return { label: 'Atenção', className: 'attention' };
    return { label: 'Bom', className: 'good' };
  }

  function statusCell(label, className = 'neutral') {
    return { html: `<span class="status ${className}">${templates().escapeHtml(label)}</span>` };
  }

  function dateCell(value) {
    return { html: `<span class="date-value">${templates().escapeHtml(templates().formatDate(value))}</span>` };
  }

  function datePairCell(start, end) {
    return {
      html: `<span class="date-pair"><span class="date-value">${templates().escapeHtml(templates().formatDate(start))}</span><span aria-hidden="true">/</span><span class="date-value">${templates().escapeHtml(templates().formatDate(end))}</span></span>`
    };
  }

  function addDays(value, days) {
    if (!value || !Number(days)) return '';
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + Number(days));
    return localDateISO(date);
  }

  function applicableRules(employee) {
    const current = state();
    const rows = current.matrixRules.filter(rule =>
      rule.active !== false
      && (!rule.unitId || String(rule.unitId) === String(employee.unitId))
      && (!rule.sectorId || String(rule.sectorId) === String(employee.sectorId))
      && (!rule.jobRoleId || String(rule.jobRoleId) === String(employee.jobRoleId))
      && (!rule.effective || rule.effective <= localDateISO())
    );
    const selected = new Map();
    rows.sort((a, b) => ((b.unitId ? 1 : 0) + (b.sectorId ? 2 : 0) + (b.jobRoleId ? 4 : 0)) - ((a.unitId ? 1 : 0) + (a.sectorId ? 2 : 0) + (a.jobRoleId ? 4 : 0)));
    rows.forEach(rule => {
      const key = `${rule.type}|${rule.itemId || rule.itemName}`;
      if (!selected.has(key)) selected.set(key, rule);
    });
    return [...selected.values()];
  }

  function currentRequirement(employee, rule) {
    const current = state();
    if (rule.type === 'Treinamento') {
      const record = current.trainingRecords.filter(item => String(item.employeeId) === String(employee.id) && String(item.trainingTypeId) === String(rule.itemId)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (!record) return { status: { label: 'Crítico', className: 'critical' }, detail: 'Treinamento não realizado' };
      return { status: dueStatus(record.due), detail: `Registro ${record.code} · vence em ${templates().formatDate(record.due)}` };
    }
    if (rule.type === 'EPI') {
      const movement = current.epiMovements.filter(item => item.status === 'Entregue' && item.isActive && String(item.employeeId) === String(employee.id) && String(item.epiId) === String(rule.itemId)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (!movement) return { status: { label: 'Crítico', className: 'critical' }, detail: 'EPI obrigatório não entregue' };
      const due = movement.dueDate || addDays(movement.date, movement.appliedValidity || rule.validity);
      return { status: dueStatus(due), detail: `Entregue em ${templates().formatDate(movement.date)} · troca em ${templates().formatDate(due)}` };
    }
    if (rule.type === 'Exame') {
      const record = current.collections.filter(item => String(item.employeeId) === String(employee.id) && String(item.examId) === String(rule.itemId)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      if (!record) return { status: { label: 'Crítico', className: 'critical' }, detail: 'Exame obrigatório sem registro' };
      if (rule.validity) {
        const due = addDays(record.date, rule.validity);
        return { status: dueStatus(due), detail: `Última coleta em ${templates().formatDate(record.date)} · vence em ${templates().formatDate(due)}` };
      }
      const raw = String(record.status || '').toUpperCase();
      const status = raw.includes('BOM') ? { label: 'Bom', className: 'good' } : raw.includes('ATEN') ? { label: 'Atenção', className: 'attention' } : { label: 'Crítico', className: 'critical' };
      return { status, detail: `Resultado registrado em ${templates().formatDate(record.date)}` };
    }
    return { status: { label: 'Atenção', className: 'attention' }, detail: 'Requisito definido na Matriz; confira a evidência específica' };
  }

  function between(value, start, end) {
    return Boolean(value && value >= start && value <= end);
  }

  function scopeMatches(item, employeeIds, unitId, sectorId) {
    if (item.employeeId) return employeeIds.has(String(item.employeeId));
    return (!unitId || String(item.unitId || '') === unitId) && (!sectorId || String(item.sectorId || '') === sectorId);
  }

  function dossierData(company, start, end) {
    const current = state();
    const employees = filteredEmployees();
    const employeeIds = new Set(employees.map(employee => String(employee.id)));
    const unitId = byId('documentUnit').value;
    const sectorId = byId('documentSector').value;
    const unitMap = new Map(current.units.map(item => [String(item.id), item]));
    const sectorMap = new Map(current.sectors.map(item => [String(item.id), item]));
    const employeeMap = new Map(current.employees.map(item => [String(item.id), item]));
    const epiMap = new Map(current.epis.map(item => [String(item.id), item]));
    const examMap = new Map(current.exams.map(item => [String(item.id), item]));
    const roleMap = new Map(current.jobRoles.map(item => [String(item.id), item]));
    const requirementRows = [];

    employees.forEach(employee => applicableRules(employee).forEach(rule => {
      const result = currentRequirement(employee, rule);
      if (result.status.className === 'good') return;
      requirementRows.push([
        employee.name,
        `${unitMap.get(String(employee.unitId))?.name || '—'} / ${sectorMap.get(String(employee.sectorId))?.name || '—'}`,
        rule.type,
        rule.itemName,
        statusCell(result.status.label, result.status.className),
        result.detail
      ]);
    }));

    const trainingRows = current.trainingRecordHistory.filter(record => employeeIds.has(String(record.employeeId)) && between(record.date, start, end)).map(record => {
      const employee = employeeMap.get(String(record.employeeId));
      return [record.code, record.employeeNameSnapshot || employee?.name || '—', record.trainingName, datePairCell(record.date, record.due), `${record.instructor} / ${record.technicalResponsible || 'RT não informado'}`, record.status === 'COMPLETED' ? statusCell('Válido', 'good') : statusCell('Cancelado', 'neutral')];
    });

    const epiRows = current.epiMovements.filter(movement => employeeIds.has(String(movement.employeeId)) && between(movement.date, start, end)).map(movement => {
      const due = movement.dueDate || addDays(movement.date, movement.appliedValidity);
      return [dateCell(movement.date), employeeMap.get(String(movement.employeeId))?.name || '—', epiMap.get(String(movement.epiId))?.name || '—', movement.status, movement.status === 'Entregue' ? `${movement.appliedValidity || '—'} dias / ${templates().formatDate(due)}` : movement.returnReason || 'Encerramento registrado', movement.technicalResponsible || '—'];
    });

    const occurrenceRows = current.risks.filter(record => scopeMatches(record, employeeIds, unitId, sectorId) && between(record.date, start, end)).map(record => [record.code || '—', dateCell(record.date), employeeMap.get(String(record.employeeId))?.name || 'Sem colaborador', record.type, record.severity, `${record.status === 'CANCELLED' ? 'Cancelada' : 'Registrada'} · ${record.desc}${record.cancelReason ? ` · Motivo: ${record.cancelReason}` : ''}`]);

    const examRows = current.collections.filter(record => employeeIds.has(String(record.employeeId)) && between(record.date, start, end)).map(record => [dateCell(record.date), employeeMap.get(String(record.employeeId))?.name || '—', examMap.get(String(record.examId))?.name || '—', `${record.year || ''} / ${record.collection || ''}`, record.value ?? '—', record.status || 'Sem parâmetro']);

    const selectedEmployeeForMatrix = employeeMap.get(byId('documentEmployee').value);
    const matrixRules = selectedEmployeeForMatrix
      ? applicableRules(selectedEmployeeForMatrix)
      : current.matrixRules.filter(rule => rule.active !== false && (!unitId || !rule.unitId || String(rule.unitId) === unitId) && (!sectorId || !rule.sectorId || String(rule.sectorId) === sectorId));
    const matrixRows = matrixRules.map(rule => [unitMap.get(String(rule.unitId))?.name || 'Todas', sectorMap.get(String(rule.sectorId))?.name || 'Todos', roleMap.get(String(rule.jobRoleId))?.name || rule.role || 'Todas', rule.type, rule.itemName, rule.validity ? `${rule.validity} dias` : 'Conforme requisito']);

    const selectedUnit = unitMap.get(unitId)?.name;
    const selectedSector = sectorMap.get(sectorId)?.name;
    const selectedEmployee = employeeMap.get(byId('documentEmployee').value)?.name;
    const scope = [selectedUnit, selectedSector, selectedEmployee].filter(Boolean).join(' / ') || 'Toda a empresa';
    const activeTrainings = current.trainingRecords.filter(record => employeeIds.has(String(record.employeeId))).length;
    return {
      company,
      nexusLogoUrl: nexusDocumentLogoUrl(),
      documentCode: documentCode('DF-SST'),
      issuedAt: issuedAt(),
      issuedBy: issuedBy(),
      scopeLabel: `${scope} · período de ${templates().formatDate(start)} a ${templates().formatDate(end)}`,
      summary: [
        { label: 'Colaboradores no escopo', value: employees.length },
        { label: 'Pendências atuais', value: requirementRows.length },
        { label: 'Treinamentos ativos', value: activeTrainings },
        { label: 'Registros no período', value: trainingRows.length + epiRows.length + occurrenceRows.length + examRows.length }
      ],
      pendingRows: requirementRows,
      trainingRows,
      epiRows,
      occurrenceRows,
      examRows,
      matrixRows
    };
  }

  async function generateInspectionDossier() {
    const start = byId('documentStartDate').value;
    const end = byId('documentEndDate').value;
    if (!start || !end) return window.alert('Informe a data inicial e a data final do dossiê.');
    if (end < start) return window.alert('A data final não pode ser anterior à data inicial.');
    if (!filteredEmployees().length) return window.alert('Nenhum colaborador foi encontrado no escopo selecionado.');
    const popup = preparePopup();
    if (!popup) return;
    try {
      const company = await requireCompanyLogo();
      const data = dossierData(company, start, end);
      await logGeneration('INSPECTION_DOSSIER', data.documentCode, null, {
        unit_id: byId('documentUnit').value || null,
        sector_id: byId('documentSector').value || null,
        employee_id: byId('documentEmployee').value || null,
        start_date: start,
        end_date: end
      });
      const html = templates().buildInspectionDossier(data);
      openDocument(html, data.documentCode, popup);
    } catch (error) {
      console.error('Falha ao preparar o dossiê.', error);
      popup.close?.();
      window.alert(error.message || 'Não foi possível preparar o dossiê.');
    }
  }

  async function printCurrentReport() {
    const table = byId('reportTableElement');
    const title = byId('reportResultTitle')?.textContent?.trim();
    if (!table || !title || title === 'Prévia do Relatório') return window.alert('Gere a prévia do relatório antes de abrir o PDF.');
    const popup = preparePopup();
    if (!popup) return;
    try {
      const company = await requireCompanyLogo();
      const clone = table.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
      clone.querySelectorAll('.badge').forEach(element => {
        const label = element.textContent.trim();
        const normalized = label.toLocaleUpperCase('pt-BR');
        const className = normalized.includes('BOM') || normalized.includes('VÁLID')
          ? 'good'
          : (normalized.includes('ATEN') || normalized.includes('REGISTRAD') ? 'attention' : (normalized.includes('CRÍT') ? 'critical' : 'neutral'));
        element.className = `status ${className}`;
      });
      const code = documentCode('REL-SST');
      await logGeneration('CUSTOM_REPORT', code, null, { title });
      const html = templates().buildReport({
        title,
        tableHtml: clone.outerHTML,
        company,
        nexusLogoUrl: nexusDocumentLogoUrl(),
        documentCode: code,
        issuedAt: issuedAt(),
        issuedBy: issuedBy()
      });
      openDocument(html, code, popup);
    } catch (error) {
      console.error('Falha ao preparar o relatório.', error);
      popup.close?.();
      window.alert(error.message || 'Não foi possível preparar o relatório.');
    }
  }

  function render() {
    renderFilters();
    updateReadiness();
  }

  function install() {
    if (installed || !byId('generateInspectionDossier') || !state() || !templates()) return;
    installed = true;
    const today = localDateISO();
    byId('documentStartDate').value ||= `${today.slice(0, 4)}-01-01`;
    byId('documentEndDate').value ||= today;
    byId('documentUnit').addEventListener('change', () => {
      byId('documentSector').value = '';
      byId('documentEmployee').value = '';
      renderFilters();
    });
    byId('documentSector').addEventListener('change', () => {
      byId('documentEmployee').value = '';
      renderFilters();
    });
    byId('generateInspectionDossier').addEventListener('click', generateInspectionDossier);
    byId('printReport').onclick = printCurrentReport;
    document.addEventListener('nexus:company-loaded', updateReadiness);
    window.NexusDocuments = { render, printTrainingCertificate, generateInspectionDossier, printCurrentReport };
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
