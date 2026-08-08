(() => {
  'use strict';

  let installed = false;
  let editingId = null;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
  const evaluationFields = ['good_min', 'good_max', 'attention_min', 'attention_max'];
  const qualitativeStatuses = ['BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO'];

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

  function fieldElement(field) {
    return byId(`exam${field.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('')}`);
  }

  function normalizeQualitativeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options
      .filter(option => option && typeof option === 'object')
      .map(option => ({ label: String(option.label || '').trim(), status: String(option.status || '') }))
      .filter(option => option.label && qualitativeStatuses.includes(option.status));
  }

  function qualitativeOptionRow(option = {}) {
    const label = escapeHtml(option.label || '');
    const statuses = qualitativeStatuses.map(status => `<option value="${status}"${option.status === status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('');
    return `<div data-qualitative-option style="display:grid;grid-template-columns:minmax(180px,1fr) minmax(150px,180px) auto;gap:8px;"><input data-qualitative-option-label placeholder="Rótulo exibido (ex.: Normal)" value="${label}"><select data-qualitative-option-status>${statuses}</select><button type="button" class="ghost" data-qualitative-option-remove aria-label="Remover opção">Remover</button></div>`;
  }

  function renderQualitativeOptionInputs(options = []) {
    const container = byId('examQualitativeOptions');
    const normalized = normalizeQualitativeOptions(options);
    container.innerHTML = normalized.map(qualitativeOptionRow).join('');
    container.querySelectorAll('[data-qualitative-option-remove]').forEach(button => button.addEventListener('click', () => {
      button.closest('[data-qualitative-option]').remove();
    }));
  }

  function addQualitativeOption(option = {}) {
    const container = byId('examQualitativeOptions');
    container.insertAdjacentHTML('beforeend', qualitativeOptionRow(option));
    container.lastElementChild.querySelector('[data-qualitative-option-remove]').addEventListener('click', event => {
      event.currentTarget.closest('[data-qualitative-option]').remove();
    });
  }

  function qualitativeOptionsFromForm() {
    const seenLabels = new Set();
    const options = [...byId('examQualitativeOptions').querySelectorAll('[data-qualitative-option]')].map(row => ({
      label: row.querySelector('[data-qualitative-option-label]').value.trim(),
      status: row.querySelector('[data-qualitative-option-status]').value
    }));
    if (options.some(option => !option.label || !qualitativeStatuses.includes(option.status))) throw new Error('Informe o rótulo e a classificação de cada opção qualitativa.');
    options.forEach(option => {
      const key = option.label.toLocaleLowerCase('pt-BR');
      if (seenLabels.has(key)) throw new Error('As opções qualitativas não podem ter rótulos duplicados.');
      seenLabels.add(key);
    });
    return options;
  }

  function classifyValue(id, value) {
    const exam = getState().exams.find(item => String(item.id) === String(id));
    const rule = exam?.evaluation;
    const numericValue = Number(value);
    if (!exam || exam.resultType !== 'NUMERIC' || !rule || rule.mode === 'NONE' || !Number.isFinite(numericValue)) return 'SEM PARÂMETRO';
    if (rule.mode === 'LOWER_IS_BETTER') return numericValue <= rule.goodMax ? 'BOM' : numericValue <= rule.attentionMax ? 'ATENÇÃO' : 'CRÍTICO';
    if (rule.mode === 'HIGHER_IS_BETTER') return numericValue >= rule.goodMin ? 'BOM' : numericValue >= rule.attentionMin ? 'ATENÇÃO' : 'CRÍTICO';
    return numericValue >= rule.goodMin && numericValue <= rule.goodMax ? 'BOM' : numericValue >= rule.attentionMin && numericValue <= rule.attentionMax ? 'ATENÇÃO' : 'CRÍTICO';
  }

  function updateForm() {
    const qualitative = byId('examResultType').value === 'QUALITATIVE';
    const mode = qualitative ? 'NONE' : byId('examEvaluationMode').value;
    byId('examEvaluationMode').disabled = qualitative;
    byId('examEvaluationMode').value = mode;
    byId('examQualitativeOptionsWrap').hidden = !qualitative;
    if (qualitative && !byId('examQualitativeOptions').children.length) addQualitativeOption();
    byId('examEsocialProcedureCode').hidden = byId('examEsocialReportable').value !== 'true';
    evaluationFields.forEach(field => {
      const visible = (mode === 'LOWER_IS_BETTER' && ['good_max', 'attention_max'].includes(field))
        || (mode === 'HIGHER_IS_BETTER' && ['good_min', 'attention_min'].includes(field))
        || mode === 'TARGET_RANGE';
      fieldElement(field).hidden = !visible;
    });
  }

  function valuesFromForm() {
    const resultType = byId('examResultType').value;
    const reportable = byId('examEsocialReportable').value === 'true';
    const procedureCode = byId('examEsocialProcedureCode').value.trim();
    const evaluationMode = resultType === 'QUALITATIVE' ? 'NONE' : byId('examEvaluationMode').value;
    const qualitativeOptions = resultType === 'QUALITATIVE' ? qualitativeOptionsFromForm() : [];
    if (!byId('examName').value.trim()) throw new Error('Informe o nome do exame.');
    if (reportable && !/^\d{4}$/.test(procedureCode)) throw new Error('Informe o código Tabela 27 com 4 dígitos.');
    if (resultType === 'QUALITATIVE' && !qualitativeOptions.length) throw new Error('Configure ao menos uma opção para o exame qualitativo.');

    const rule = { evaluation_mode: evaluationMode };
    evaluationFields.forEach(field => {
      const element = fieldElement(field);
      rule[field] = element.hidden ? null : (element.value === '' ? null : Number(element.value));
      if (rule[field] !== null && !Number.isFinite(rule[field])) throw new Error('Informe limites numéricos válidos.');
    });
    if (evaluationMode === 'LOWER_IS_BETTER' && !(rule.good_max < rule.attention_max)) throw new Error('Bom até deve ser menor que Atenção até.');
    if (evaluationMode === 'HIGHER_IS_BETTER' && !(rule.attention_min < rule.good_min)) throw new Error('Atenção mínima deve ser menor que Bom mínimo.');
    if (evaluationMode === 'TARGET_RANGE' && !(rule.attention_min <= rule.good_min && rule.good_min <= rule.good_max && rule.good_max <= rule.attention_max)) throw new Error('As faixas informadas são inválidas.');

    return {
      catalog: {
        name: byId('examName').value.trim(),
        measurement_unit: byId('examUnit').value.trim() || null,
        result_type: resultType,
        qualitative_options: qualitativeOptions,
        esocial_reportable: reportable,
        esocial_procedure_code: reportable ? procedureCode : null,
        active: true
      },
      rule
    };
  }

  async function listExams() {
    try {
      const { data, error } = await getClient()
        .from('exam_catalog')
        .select('id,name,measurement_unit,result_type,qualitative_options,esocial_reportable,esocial_procedure_code,active,exam_evaluation_rules(evaluation_mode,good_min,good_max,attention_min,attention_max)')
        .eq('organization_id', getOrganizationId())
        .eq('active', true)
        .order('name');
      if (error) throw error;
      getState().exams = (data || []).map(row => {
        const rule = Array.isArray(row.exam_evaluation_rules) ? row.exam_evaluation_rules[0] : row.exam_evaluation_rules;
        return {
          id: row.id,
          name: row.name,
          unit: row.measurement_unit || '',
          resultType: row.result_type,
          qualitativeOptions: normalizeQualitativeOptions(row.qualitative_options),
          eSocialReportable: row.esocial_reportable,
          esocialProcedureCode: row.esocial_procedure_code || '',
          active: row.active,
          evaluation: {
            mode: rule?.evaluation_mode || 'NONE',
            goodMin: rule?.good_min,
            goodMax: rule?.good_max,
            attentionMin: rule?.attention_min,
            attentionMax: rule?.attention_max
          }
        };
      });
      window.NEXUS_SST_APP?.render?.();
      window.NexusSectorExams?.render?.();
    } catch (error) {
      console.error('Falha ao carregar exames.', error);
      window.alert('Não foi possível carregar os exames.');
    }
  }

  function renderExamList() {
    const list = byId('examList');
    if (!list) return;
    list.innerHTML = getState().exams.length ? getState().exams.map(exam => {
      const type = exam.resultType === 'QUALITATIVE' ? 'Qualitativo' : 'Numérico';
      const options = exam.resultType === 'QUALITATIVE' ? ` | Opções: ${exam.qualitativeOptions.map(option => `${option.label} → ${option.status}`).join(', ') || 'não configuradas'}` : '';
      return `<li><span><strong>${escapeHtml(exam.name)}</strong><small>${escapeHtml(type)}${exam.unit ? ` | ${escapeHtml(exam.unit)}` : ''}${options} | ${exam.eSocialReportable ? `Tabela 27: ${escapeHtml(exam.esocialProcedureCode)}` : 'Não configurado'} | ${escapeHtml(exam.evaluation.mode)}</small></span><span><button class="ghost" type="button" onclick="editExam('${escapeHtml(exam.id)}')">Editar</button><button class="ghost" type="button" onclick="deleteExam('${escapeHtml(exam.id)}')">Excluir</button></span></li>`;
    }).join('') : '<li>Nenhum exame cadastrado.</li>';
  }

  async function submit(event) {
    event.preventDefault();
    try {
      const values = valuesFromForm();
      const organizationId = getOrganizationId();
      let id = editingId;
      if (id) {
        const { error } = await getClient().from('exam_catalog').update(values.catalog).eq('id', id).eq('organization_id', organizationId);
        if (error) throw error;
      } else {
        const { data, error } = await getClient().from('exam_catalog').insert({ ...values.catalog, organization_id: organizationId }).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      const { error: ruleError } = await getClient().from('exam_evaluation_rules').upsert({ exam_id: id, ...values.rule });
      if (ruleError) throw ruleError;
      reset();
      await listExams();
    } catch (error) {
      console.error('Falha ao salvar exame.', error);
      window.alert(error.message || 'Não foi possível salvar o exame.');
    }
  }

  function reset() {
    byId('examForm').reset();
    renderQualitativeOptionInputs();
    editingId = null;
    byId('examSubmitButton').textContent = 'Cadastrar Exame';
    byId('examCancelEdit').hidden = true;
    updateForm();
  }

  function editExam(id) {
    const exam = getState().exams.find(item => String(item.id) === String(id));
    if (!exam) return;
    editingId = id;
    byId('examName').value = exam.name;
    byId('examUnit').value = exam.unit;
    byId('examResultType').value = exam.resultType;
    renderQualitativeOptionInputs(exam.qualitativeOptions);
    byId('examEsocialReportable').value = String(exam.eSocialReportable);
    byId('examEsocialProcedureCode').value = exam.esocialProcedureCode;
    byId('examEvaluationMode').value = exam.evaluation.mode;
    evaluationFields.forEach(field => {
      fieldElement(field).value = exam.evaluation[field.replace(/_([a-z])/g, (_, character) => character.toUpperCase())] ?? '';
    });
    byId('examSubmitButton').textContent = 'Salvar Alterações';
    byId('examCancelEdit').hidden = false;
    updateForm();
  }

  async function deleteExam(id) {
    const state = getState();
    if (state.collections.some(collection => String(collection.examId) === String(id)) || state.matrixRules.some(rule => String(rule.itemId) === String(id))) {
      return window.alert('Não é possível excluir este exame porque existem registros ou regras da Matriz de Controle vinculados a ele.');
    }
    if (!window.confirm('Excluir este exame?')) return;
    const { error } = await getClient().from('exam_catalog').delete().eq('id', id).eq('organization_id', getOrganizationId());
    if (error) {
      console.error('Falha ao excluir exame.', error);
      if (error.code === '23503') return window.alert('Não é possível excluir este exame porque ele está vinculado a um setor. Desvincule-o primeiro.');
      return window.alert('Não foi possível excluir o exame.');
    }
    await listExams();
  }

  function install() {
    if (installed || !byId('examForm') || !window.NEXUS_SST_APP?.getState) return;
    installed = true;
    byId('examForm').onsubmit = submit;
    byId('examCancelEdit').onclick = reset;
    byId('examAddQualitativeOption').onclick = () => addQualitativeOption();
    ['examResultType', 'examEsocialReportable', 'examEvaluationMode'].forEach(id => { byId(id).onchange = updateForm; });
    byId('examEsocialProcedureCode').oninput = event => { event.target.value = event.target.value.replace(/\D/g, ''); };
    updateForm();
    window.editExam = editExam;
    window.deleteExam = deleteExam;
    listExams();
  }

  window.NexusExams = { listExams, renderExamList, classifyValue, deleteExam };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
