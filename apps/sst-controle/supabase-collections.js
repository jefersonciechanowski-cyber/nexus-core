(() => {
  'use strict';

  let installed = false;
  let editingId = null;
  let editingRecord = null;
  let employeeSelectionRequest = 0;

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
    if (exam?.resultType === 'QUALITATIVE') return 'Resultado qualitativo';
    const labels = { NONE: 'Sem classificação automática', LOWER_IS_BETTER: 'Quanto menor, melhor', HIGHER_IS_BETTER: 'Quanto maior, melhor', TARGET_RANGE: 'Faixa ideal' };
    return labels[exam?.evaluation?.mode] || labels.NONE;
  }

  function setEligibilityMessage(message) {
    const element = byId('collectionEligibilityMessage');
    element.textContent = message || '';
    element.hidden = !message;
  }

  function refreshExamDetails() {
    const exam = examFor(byId('collectionExam').value);
    const info = byId('collectionExamInfo');
    if (!exam) { info.hidden = true; info.textContent = ''; return; }
    info.textContent = `Unidade: ${exam.unit || 'não informada'} · Avaliação: ${evaluationLabel(exam)}`;
    info.hidden = false;
  }

  function updateResultInput(selectedQualitativeResult = '', historicalStatus = '') {
    const exam = examFor(byId('collectionExam').value);
    const numericInput = byId('collectionValue');
    const qualitativeInput = byId('collectionQualitativeResult');
    const qualitative = exam?.resultType === 'QUALITATIVE';

    numericInput.hidden = Boolean(exam) && qualitative;
    numericInput.disabled = Boolean(exam) && qualitative;
    numericInput.required = Boolean(exam) && !qualitative;
    qualitativeInput.hidden = !qualitative;
    qualitativeInput.disabled = !qualitative;
    qualitativeInput.required = qualitative;
    if (qualitative) {
      numericInput.value = '';
      const currentResult = selectedQualitativeResult || qualitativeInput.value;
      const options = [...(exam.qualitativeOptions || [])];
      if (currentResult && !options.some(option => option.label === currentResult)) options.push({ label: currentResult, status: historicalStatus || 'SEM PARÂMETRO', historical: true });
      selectOptions('collectionQualitativeResult', options.map(option => ({ id: option.label, name: `${option.label} — ${option.status}${option.historical ? ' (histórico)' : ''}` })), 'Selecione o resultado', currentResult);
    } else {
      qualitativeInput.value = '';
      selectOptions('collectionQualitativeResult', [], 'Selecione o resultado');
    }
  }

  function refreshStatusPreview() {
    const preview = byId('collectionStatusPreview');
    const exam = examFor(byId('collectionExam').value);
    if (!exam) {
      preview.hidden = true;
      preview.textContent = '';
      return;
    }
    if (exam.resultType === 'QUALITATIVE') {
      const option = (exam.qualitativeOptions || []).find(item => item.label === byId('collectionQualitativeResult').value);
      if (!option) { preview.hidden = true; preview.textContent = ''; return; }
      preview.textContent = `Classificação: ${option.status}`;
      preview.hidden = false;
      return;
    }
    const rawValue = byId('collectionValue').value.trim();
    const value = Number(rawValue);
    if (!rawValue || !Number.isFinite(value)) { preview.hidden = true; preview.textContent = ''; return; }
    preview.textContent = `Classificação: ${window.NexusExams?.classifyValue?.(exam.id, value) || 'SEM PARÂMETRO'}`;
    preview.hidden = false;
  }

  async function populateRequiredExams(selectedExamId = '') {
    const requestId = ++employeeSelectionRequest;
    const employeeId = byId('collectionEmployee').value;
    const employee = employeeFor(employeeId);
    const select = byId('collectionExam');
    if (!employee) {
      selectOptions('collectionExam', [], 'Selecione primeiro o colaborador');
      select.disabled = true;
      setEligibilityMessage('Selecione o colaborador para carregar os exames exigidos pelo setor.');
      updateResultInput();
      refreshExamDetails();
      refreshStatusPreview();
      return;
    }
    if (!employee.sectorId) {
      selectOptions('collectionExam', [], 'Colaborador sem setor');
      select.disabled = true;
      setEligibilityMessage('Este colaborador não possui setor definido. Atualize o cadastro antes de registrar a coleta.');
      updateResultInput();
      refreshExamDetails();
      refreshStatusPreview();
      return;
    }

    try {
      selectOptions('collectionExam', [], 'Carregando exames exigidos…');
      select.disabled = true;
      setEligibilityMessage('Carregando os exames exigidos pelo setor do colaborador.');
      updateResultInput();
      refreshExamDetails();
      refreshStatusPreview();
      if (!window.NexusSectorExams?.listRequirements || !window.NexusSectorExams?.requiredExamsForEmployee) throw new Error('Módulo de vínculos de exames por setor não está disponível.');
      await window.NexusSectorExams.listRequirements();
      if (requestId !== employeeSelectionRequest || byId('collectionEmployee').value !== employeeId) return;
      const exams = window.NexusSectorExams?.requiredExamsForEmployee?.(employee.id) || [];
      const legacyExam = selectedExamId && !exams.some(exam => String(exam.id) === String(selectedExamId)) ? examFor(selectedExamId) : null;
      const options = legacyExam ? [...exams, { ...legacyExam, name: `${legacyExam.name} (vínculo histórico)` }] : exams;
      selectOptions('collectionExam', options, exams.length ? 'Selecione o exame exigido' : 'Nenhum exame vinculado ao setor', selectedExamId);
      select.disabled = !options.length;
      setEligibilityMessage(exams.length ? '' : 'Não há exames ativos vinculados ao setor deste colaborador.');
    } catch (error) {
      console.error('Falha ao carregar exames exigidos pelo setor.', error);
      selectOptions('collectionExam', [], 'Não foi possível carregar os exames');
      select.disabled = true;
      setEligibilityMessage('Não foi possível carregar os exames exigidos pelo setor. Tente novamente.');
    }
    updateResultInput();
    refreshExamDetails();
    refreshStatusPreview();
  }

  function valuesFromForm() {
    const employeeId = byId('collectionEmployee').value;
    const examId = byId('collectionExam').value;
    const exam = examFor(examId);
    const collectionNumber = Number(byId('collectionNumber').value);
    const collectedAt = byId('collectionDate').value;
    const rawValue = byId('collectionValue').value.trim();
    const qualitativeResult = byId('collectionQualitativeResult').value.trim();
    const today = new Date().toISOString().slice(0, 10);

    if (!employeeId || !examId || !exam) throw new Error('Selecione o colaborador e um exame exigido pelo setor.');
    if (!Number.isInteger(collectionNumber) || collectionNumber < 1) throw new Error('Informe um número de coleta inteiro maior ou igual a 1.');
    if (!collectedAt) throw new Error('Informe a data da coleta.');
    if (collectedAt > today) throw new Error('A data da coleta não pode estar no futuro.');

    if (exam.resultType === 'QUALITATIVE') {
      const option = (exam.qualitativeOptions || []).find(item => item.label === qualitativeResult);
      const preservesHistoricalResult = editingRecord
        && String(editingRecord.examId) === String(examId)
        && qualitativeResult === editingRecord.qualitativeResult;
      if (!option && !preservesHistoricalResult) throw new Error('Selecione um resultado qualitativo configurado para este exame.');
      return {
        employee_id: employeeId,
        exam_id: examId,
        collection_number: collectionNumber,
        collected_at: collectedAt,
        value: null,
        qualitative_result: qualitativeResult,
        status: option?.status || editingRecord.status
      };
    }

    const value = Number(rawValue);
    if (!rawValue || !Number.isFinite(value)) throw new Error('Informe um valor numérico válido.');
    return {
      employee_id: employeeId,
      exam_id: examId,
      collection_number: collectionNumber,
      collected_at: collectedAt,
      value,
      qualitative_result: null,
      status: window.NexusExams?.classifyValue?.(examId, value) || 'SEM PARÂMETRO'
    };
  }

  function resetForm() {
    byId('collectionForm').reset();
    editingId = null;
    editingRecord = null;
    byId('collectionFormTitle').textContent = 'Registrar Nova Coleta';
    byId('collectionSubmitButton').textContent = 'Registrar Coleta';
    byId('collectionCancelEdit').hidden = true;
    populateRequiredExams();
  }

  async function listCollections() {
    try {
      const { data, error } = await getClient()
        .from('exam_records')
        .select('id, employee_id, exam_id, exam_name, collected_at, value, qualitative_result, result_type_snapshot, status, collection_number, measurement_unit_snapshot, esocial_reportable_snapshot, esocial_procedure_code_snapshot, created_at')
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
        qualitativeResult: record.qualitative_result,
        resultTypeSnapshot: record.result_type_snapshot,
        status: record.status,
        examNameSnapshot: record.exam_name,
        measurementUnitSnapshot: record.measurement_unit_snapshot,
        esocialReportableSnapshot: record.esocial_reportable_snapshot,
        esocialProcedureCodeSnapshot: record.esocial_procedure_code_snapshot
      }));
      window.NEXUS_SST_APP?.render?.();
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
    const submitButton = byId('collectionSubmitButton');
    submitButton.disabled = true;
    try {
      const values = valuesFromForm();
      const result = editingId
        ? await getClient().from('exam_records').update(values).eq('id', editingId).eq('organization_id', getOrganizationId())
        : await getClient().from('exam_records').insert({ ...values, organization_id: getOrganizationId() });
      if (result.error) throw result.error;
      resetForm();
      await listCollections();
    } catch (error) {
      console.error('Falha ao salvar coleta.', error);
      if (error?.code === '23505') window.alert('Já existe um resultado deste exame para este colaborador, neste ano e número de coleta.');
      else window.alert(error.message || 'Não foi possível salvar a coleta.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function editCollection(id) {
    const record = getState().collections.find(collection => String(collection.id) === String(id));
    if (!record) return window.alert('Coleta não encontrada.');
    editingId = record.id;
    editingRecord = record;
    byId('collectionEmployee').value = record.employeeId || '';
    await populateRequiredExams(record.examId || '');
    byId('collectionExam').value = record.examId || '';
    byId('collectionNumber').value = record.collection ?? '';
    byId('collectionDate').value = record.date || '';
    updateResultInput(record.qualitativeResult || '', record.status || '');
    byId('collectionValue').value = record.value ?? '';
    byId('collectionQualitativeResult').value = record.qualitativeResult ?? '';
    byId('collectionFormTitle').textContent = 'Editar Coleta';
    byId('collectionSubmitButton').textContent = 'Salvar Alterações';
    byId('collectionCancelEdit').hidden = false;
    refreshExamDetails();
    refreshStatusPreview();
    byId('collectionForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filteredCollections() {
    const filters = {
      unit: byId('filterCollectionUnit').value,
      sector: byId('filterCollectionSector').value,
      employee: byId('filterCollectionEmployee').value,
      exam: byId('filterCollectionExam').value,
      year: byId('filterYear').value,
      collection: byId('filterCollection').value,
      status: byId('filterCollectionStatus').value
    };
    return getState().collections.filter(record => {
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
      const result = record.resultTypeSnapshot === 'QUALITATIVE' || record.qualitativeResult ? record.qualitativeResult || '—' : `${record.value ?? '—'}${unitSuffix}`;
      return `<tr><td><strong>${escapeHtml(employee?.name || 'Colaborador não encontrado')}</strong></td><td>${escapeHtml(unit?.name || '—')} / ${escapeHtml(sector?.name || '—')}</td><td>${escapeHtml(examName)}${record.examId ? '' : '<small style="display:block">Exame não vinculado</small>'}</td><td>${escapeHtml(record.date || '—')}</td><td>${escapeHtml(record.collection ? `Coleta ${record.collection}` : '—')}</td><td>${escapeHtml(result)}</td><td>${escapeHtml(record.status || 'SEM PARÂMETRO')}</td><td><button type="button" class="ghost" data-collection-edit="${escapeHtml(record.id)}">Editar</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhum registro de coleta encontrado.</td></tr>';
    byId('collectionTable').querySelectorAll('[data-collection-edit]').forEach(button => button.addEventListener('click', () => { editCollection(button.dataset.collectionEdit); }));
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
    byId('collectionEmployee').onchange = () => { populateRequiredExams(); };
    byId('collectionExam').onchange = () => { updateResultInput(); refreshExamDetails(); refreshStatusPreview(); };
    byId('collectionValue').oninput = refreshStatusPreview;
    byId('collectionQualitativeResult').onchange = refreshStatusPreview;
    byId('filterCollectionUnit').onchange = renderCollectionTable;
    byId('applyCollectionFilter').onclick = renderCollectionTable;
    byId('clearCollectionFilter').onclick = clearFilters;
    window.NexusCollections = { listCollections, renderCollectionTable, editCollection, resetForm, populateRequiredExams };
    resetForm();
    listCollections();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
