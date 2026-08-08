(() => {
  'use strict';

  let installed = false;

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
    if (!Array.isArray(current.sectorExamRequirements)) current.sectorExamRequirements = [];
    return current;
  }

  function sectorFor(id) { return getState().sectors.find(sector => String(sector.id) === String(id)); }
  function examFor(id) { return getState().exams.find(exam => String(exam.id) === String(id)); }

  function renderSelect(id, items, label, selected) {
    const select = byId(id);
    if (!select) return;
    const current = selected ?? select.value;
    select.innerHTML = `<option value="">${escapeHtml(label)}</option>` + items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    if ([...select.options].some(option => option.value === String(current))) select.value = String(current);
  }

  function render() {
    const state = getState();
    renderSelect('sectorExamSector', state.sectors, 'Selecione o setor');
    renderSelect('sectorExamExam', state.exams.filter(exam => exam.active !== false), 'Selecione o exame');

    const list = byId('sectorExamRequirementList');
    if (!list) return;
    list.innerHTML = state.sectorExamRequirements.length
      ? state.sectorExamRequirements.map(requirement => {
        const sector = sectorFor(requirement.sectorId);
        const exam = examFor(requirement.examId);
        const stateLabel = requirement.active ? 'Ativo' : 'Inativo';
        const toggleLabel = requirement.active ? 'Desativar' : 'Reativar';
        return `<li><span><strong>${escapeHtml(exam?.name || 'Exame indisponível')}</strong><small>${escapeHtml(sector?.name || 'Setor indisponível')} · ${escapeHtml(exam?.resultType === 'QUALITATIVE' ? 'Qualitativo' : 'Numérico')} · ${stateLabel}</small></span><span><button type="button" class="ghost" data-sector-exam-toggle="${escapeHtml(requirement.id)}">${toggleLabel}</button><button type="button" class="ghost" data-sector-exam-remove="${escapeHtml(requirement.id)}">Desvincular</button></span></li>`;
      }).join('')
      : '<li><span style="color:var(--text-muted)">Nenhum exame vinculado a setor.</span></li>';
    list.querySelectorAll('[data-sector-exam-remove]').forEach(button => button.addEventListener('click', () => removeRequirement(button.dataset.sectorExamRemove)));
    list.querySelectorAll('[data-sector-exam-toggle]').forEach(button => button.addEventListener('click', () => toggleRequirement(button.dataset.sectorExamToggle)));
  }

  async function listRequirements() {
    const { data, error } = await getClient()
      .from('sector_exam_requirements')
      .select('id, sector_id, exam_id, active')
      .eq('organization_id', getOrganizationId())
      .order('created_at');
    if (error) throw error;
    getState().sectorExamRequirements = (data || []).map(requirement => ({
      id: requirement.id,
      sectorId: requirement.sector_id,
      examId: requirement.exam_id,
      active: requirement.active
    }));
    render();
    return getState().sectorExamRequirements;
  }

  function requiredExamsForEmployee(employeeId) {
    const employee = getState().employees.find(item => String(item.id) === String(employeeId));
    if (!employee?.sectorId) return [];
    const requirementExamIds = new Set(getState().sectorExamRequirements
      .filter(requirement => requirement.active && String(requirement.sectorId) === String(employee.sectorId))
      .map(requirement => String(requirement.examId)));
    return getState().exams.filter(exam => exam.active !== false && requirementExamIds.has(String(exam.id)));
  }

  async function submitRequirement(event) {
    event.preventDefault();
    const sectorId = byId('sectorExamSector').value;
    const examId = byId('sectorExamExam').value;
    if (!sectorId || !examId) return window.alert('Selecione o setor e o exame para criar o vínculo.');
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await getClient()
        .from('sector_exam_requirements')
        .insert({ organization_id: getOrganizationId(), sector_id: sectorId, exam_id: examId });
      if (error) throw error;
      event.currentTarget.reset();
      await listRequirements();
      window.NexusCollections?.populateRequiredExams?.();
    } catch (error) {
      console.error('Falha ao vincular exame ao setor.', error);
      if (error?.code === '23505') window.alert('Este exame já está vinculado ao setor selecionado. Reative o vínculo existente ou desvincule-o antes de criar outro.');
      else window.alert(error.message || 'Não foi possível vincular o exame ao setor.');
    } finally {
      button.disabled = false;
    }
  }

  async function removeRequirement(id) {
    if (!window.confirm('Desvincular este exame do setor? Coletas já registradas serão preservadas.')) return;
    try {
      const { error } = await getClient()
        .from('sector_exam_requirements')
        .delete()
        .eq('id', id)
        .eq('organization_id', getOrganizationId());
      if (error) throw error;
      await listRequirements();
      window.NexusCollections?.populateRequiredExams?.();
    } catch (error) {
      console.error('Falha ao desvincular exame do setor.', error);
      window.alert(error.message || 'Não foi possível desvincular o exame do setor.');
    }
  }

  async function toggleRequirement(id) {
    const requirement = getState().sectorExamRequirements.find(item => String(item.id) === String(id));
    if (!requirement) return;
    try {
      const { error } = await getClient()
        .from('sector_exam_requirements')
        .update({ active: !requirement.active })
        .eq('id', requirement.id)
        .eq('organization_id', getOrganizationId());
      if (error) throw error;
      await listRequirements();
      window.NexusCollections?.populateRequiredExams?.();
    } catch (error) {
      console.error('Falha ao atualizar vínculo de exame por setor.', error);
      window.alert(error.message || 'Não foi possível atualizar o vínculo de exame por setor.');
    }
  }

  function install() {
    if (installed || !byId('sectorExamRequirementForm') || !window.NEXUS_SST_APP?.getState) return;
    installed = true;
    byId('sectorExamRequirementForm').onsubmit = submitRequirement;
    window.NexusSectorExams = { listRequirements, requiredExamsForEmployee, render };
    listRequirements().catch(error => {
      console.error('Falha ao carregar vínculos de exames por setor.', error);
      getState().sectorExamRequirements = [];
      render();
      window.alert('Não foi possível carregar os vínculos de exames por setor.');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
