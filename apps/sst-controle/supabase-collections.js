(() => {
  'use strict';

  let installed = false;
  let editingId = null;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));

  function getClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Cliente autenticado do Supabase não está disponível.');
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); } catch { throw new Error('Sessão autenticada inválida.'); }
    const organizationId = String(session?.organizationId || '').trim();
    if (!organizationId) throw new Error('Organização autenticada não foi identificada.');
    return organizationId;
  }

  function getState() {
    const current = window.NEXUS_SST_APP?.getState?.();
    if (!current) throw new Error('Estado do SST Controle não está disponível.');
    return current;
  }

  function selectOptions(id, items, label, selected) {
    const select = byId(id);
    if (!select) return;
    const current = selected ?? select.value;
    select.innerHTML = `<option value="">${escapeHtml(label)}</option>` + items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    if ([...select.options].some(option => option.value === String(current))) select.value = String(current);
  }

  function examFor(id) { return getState().exams.find(exam => String(exam.id) === String(id)); }
  function employeeFor(id) { return getState().employees.find(employee => String(employee.id) === String(id)); }
  function unitFor(id) { return getState().units.find(unit => String(unit.id) === String(id)); }
  function sectorFor(id) { return getState().sectors.find(sector => String(sector.id) === String(id)); }

  function evaluationLabel(exam) {
    const labels = { NONE: 'Sem classificação automática', LOWER_IS_BETTER: 'Quanto menor, melhor', HIGHER_IS_BETTER: 'Quanto maior, melhor', TARGET_RANGE: 'Faixa ideal' };
    return labels[exam?.evaluation?.mode] || labels.NONE;
  }

  function refreshExamDetails() {
    const exam = examFor(byId('collectionExam').value);
    const info = byId('collectionExamInfo');
    if (!exam) { info.hidden = true; info.textContent = ''; return; }
    info.textContent = `Unidade: ${exam.unit || 'não informada'} · Avaliação: ${evaluationLabel(exam)}`;
    info.hidden = false;
  }

  function refreshStatusPreview() {
    const preview = byId('collectionStatusPreview');
    const examId = byId('collectionExam').value;
    const rawValue = byId('collectionValue').value.trim();
    const value = Number(rawValue);
    if (!examId || !rawValue || !Number.isFinite(value)) { preview.hidden = true; preview.textContent = ''; return; }
    preview.textContent = `Classificação: ${window.NexusExams?.classifyValue?.(examId, value) || 'SEM PARÂMETRO'}`;
    preview.hidden = false;
  }

  function valuesFromForm() {
    const employeeId = byId('collectionEmployee').value;
    const examId = byId('collectionExam').value;
    const collectionNumber = Number(byId('collectionNumber').value);
    const collectedAt = byId('collectionDate').value;
    const rawValue = byId('collectionValue').value.trim();
    const value = Number(rawValue);
    const today = new Date().toISOString().slice(0, 10);

    if (!employeeId || !examId) throw new Error('Selecione o colaborador e o exame.');
    if (!Number.isInteger(collectionNumber) || collectionNumber < 1) throw new Error('Informe um número de coleta inteiro maior ou igual a 1.');
    if (!collectedAt) throw new Error('Informe a data da coleta.');
    if (collectedAt > today) throw new Error('A data da coleta não pode estar no futuro.');
    if (!rawValue || !Number.isFinite(value)) throw new Error('Informe um valor numérico válido.');

    return {
      employee_id: employeeId,
      exam_id: examId,
      collection_number: collectionNumber,
      collected_at: collectedAt,
      value,
      status: window.NexusExams?.classifyValue?.(examId, value) || 'SEM PARÂMETRO'
    };
  }

  function resetForm() {
    byId('collectionForm').reset();
    editingId = null;
    byId('collectionFormTitle').textContent = 'Registrar Nova Coleta';
    byId('collectionSubmitButton').textContent = 'Registrar Coleta';
    byId('collectionCancelEdit').hidden = true;
    refreshExamDetails();
    refreshStatusPreview();
  }

  async function listCollections() {
    try {
      const { data, error } = await getClient()
        .from('exam_records')
        .select('id, employee_id, exam_id, exam_name, collected_at, value, status, collection_number, measurement_unit_snapshot, esocial_reportable_snapshot, esocial_procedure_code_snapshot, created_at')
        .eq('organization_id', getOrganizationId())
        .order('collected_at', { ascending: false })
        .order('collection_number', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      getState().collections = (data || []).map(record => ({
        id: record.id,
        employeeId: record.employee_id,
        examId: record.exam_id,
        year: record.collected_at ? Number(record.collected_at.slice(0, 4)) : null,
        collection: record.collection_number,
        date: record.collected_at,
        value: record.value,
        status: record.status,
        examNameSnapshot: record.exam_name,
        measurementUnitSnapshot: record.measurement_unit_snapshot,
        esocialReportableSnapshot: record.esocial_reportable_snapshot,
        esocialProcedureCodeSnapshot: record.esocial_procedure_code_snapshot
      }));
      window.NEXUS_SST_APP.render();
      renderCollectionTable();
    } catch (error) {
      console.error('Falha ao carregar coletas.', error);
      getState().collections = [];
      renderCollectionTable();
      window.alert('Não foi possível carregar as coletas do Supabase.');
    }
  }

  async function submitCollection(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = byId('collectionSubmitButton');
    submitButton.disabled = true;
    try {
      const values = valuesFromForm();
      let result;
      if (editingId) {
        result = await getClient().from('exam_records').update(values).eq('id', editingId).eq('organization_id', getOrganizationId());
      } else {
        result = await getClient().from('exam_records').insert({ ...values, organization_id: getOrganizationId() });
      }
      if (result.error) throw result.error;
      resetForm();
      await listCollections();
    } catch (error) {
      console.error('Falha ao salvar coleta.', error);
      if (error?.code === '23505') window.alert('Já existe um resultado deste exame para este colaborador, nesta data e número de coleta.');
      else window.alert(error.message || 'Não foi possível salvar a coleta.');
    } finally {
      submitButton.disabled = false;
    }
  }

  function editCollection(id) {
    const record = getState().collections.find(collection => String(collection.id) === String(id));
    if (!record) return window.alert('Coleta não encontrada.');
    editingId = record.id;
    byId('collectionEmployee').value = record.employeeId || '';
    byId('collectionExam').value = record.examId || '';
    byId('collectionNumber').value = record.collection ?? '';
    byId('collectionDate').value = record.date || '';
    byId('collectionValue').value = record.value ?? '';
    byId('collectionFormTitle').textContent = 'Editar Coleta';
    byId('collectionSubmitButton').textContent = 'Salvar Alterações';
    byId('collectionCancelEdit').hidden = false;
    refreshExamDetails();
    refreshStatusPreview();
    byId('collectionForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filteredCollections() {
    const current = getState();
    const filters = {
      unit: byId('filterCollectionUnit').value,
      sector: byId('filterCollectionSector').value,
      employee: byId('filterCollectionEmployee').value,
      exam: byId('filterCollectionExam').value,
      year: byId('filterYear').value,
      collection: byId('filterCollection').value,
      status: byId('filterCollectionStatus').value
    };
    return current.collections.filter(record => {
      const employee = employeeFor(record.employeeId);
      return (!filters.unit || String(employee?.unitId) === filters.unit)
        && (!filters.sector || String(employee?.sectorId) === filters.sector)
        && (!filters.employee || String(record.employeeId) === filters.employee)
        && (!filters.exam || String(record.examId) === filters.exam)
        && (!filters.year || String(record.year) === filters.year)
        && (!filters.collection || String(record.collection) === filters.collection)
        && (!filters.status || record.status === filters.status);
    });
  }

  function renderCollectionTable() {
    const state = getState();
    const selected = { year: byId('filterYear').value, collection: byId('filterCollection').value, sector: byId('filterCollectionSector').value };
    const sectors = byId('filterCollectionUnit').value ? state.sectors.filter(sector => String(sector.unitId) === byId('filterCollectionUnit').value) : state.sectors;
    selectOptions('filterCollectionSector', sectors, 'Todos os setores', selected.sector);
    const years = [...new Set(state.collections.map(record => record.year).filter(Boolean))].sort((a, b) => b - a).map(year => ({ id: year, name: year }));
    const numbers = [...new Set(state.collections.map(record => record.collection).filter(Boolean))].sort((a, b) => a - b).map(number => ({ id: number, name: `Coleta ${number}` }));
    selectOptions('filterYear', years, 'Todos os anos', selected.year);
    selectOptions('filterCollection', numbers, 'Todas as coletas', selected.collection);

    const rows = filteredCollections();
    byId('collectionTable').innerHTML = rows.length ? rows.map(record => {
      const employee = employeeFor(record.employeeId);
      const unit = unitFor(employee?.unitId);
      const sector = sectorFor(employee?.sectorId);
      const linkedExam = examFor(record.examId);
      const examName = linkedExam?.name || record.examNameSnapshot || 'Exame não vinculado';
      const unitSuffix = record.measurementUnitSnapshot ? ` ${record.measurementUnitSnapshot}` : '';
      return `<tr><td><strong>${escapeHtml(employee?.name || 'Colaborador não encontrado')}</strong></td><td>${escapeHtml(unit?.name || '—')} / ${escapeHtml(sector?.name || '—')}</td><td>${escapeHtml(examName)}${record.examId ? '' : '<small style="display:block">Exame não vinculado</small>'}</td><td>${escapeHtml(record.date || '—')}</td><td>${escapeHtml(record.collection ? `Coleta ${record.collection}` : '—')}</td><td>${escapeHtml(record.value ?? '—')}${escapeHtml(unitSuffix)}</td><td>${escapeHtml(record.status || 'SEM PARÂMETRO')}</td><td><button type="button" class="ghost" data-collection-edit="${escapeHtml(record.id)}">Editar</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhum registro de coleta encontrado.</td></tr>';
    byId('collectionTable').querySelectorAll('[data-collection-edit]').forEach(button => button.addEventListener('click', () => editCollection(button.dataset.collectionEdit)));
  }

  function clearFilters() {
    ['filterCollectionUnit', 'filterCollectionSector', 'filterCollectionEmployee', 'filterCollectionExam', 'filterYear', 'filterCollection', 'filterCollectionStatus'].forEach(id => { byId(id).value = ''; });
    renderCollectionTable();
  }

  function install() {
    if (installed || !byId('collectionForm') || !window.NEXUS_SST_APP?.getState) return;
    installed = true;
    byId('collectionForm').onsubmit = submitCollection;
    byId('collectionCancelEdit').onclick = resetForm;
    byId('collectionExam').onchange = () => { refreshExamDetails(); refreshStatusPreview(); };
    byId('collectionValue').oninput = refreshStatusPreview;
    byId('filterCollectionUnit').onchange = renderCollectionTable;
    byId('applyCollectionFilter').onclick = renderCollectionTable;
    byId('clearCollectionFilter').onclick = clearFilters;
    window.NexusCollections = { listCollections, renderCollectionTable, editCollection, resetForm };
    resetForm();
    listCollections();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
