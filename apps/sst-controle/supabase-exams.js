(() => {
  'use strict';

  let installed = false;

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function getClient() {
    if (!window.NexusAuth?.getClient) {
      throw new Error('Cliente autenticado do Supabase não está disponível.');
    }
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    const raw = sessionStorage.getItem('nexus_demo_session');
    if (!raw) throw new Error('Sessão autenticada não encontrada.');

    let session;
    try {
      session = JSON.parse(raw);
    } catch {
      throw new Error('Sessão autenticada inválida.');
    }

    const organizationId = String(session?.organizationId || '').trim();
    if (!organizationId) throw new Error('Organização autenticada não foi identificada.');
    return organizationId;
  }

  function getState() {
    const state = window.NEXUS_SST_APP?.getState?.();
    if (!state) throw new Error('Estado do SST Controle não está disponível.');
    return state;
  }

  function renderExamList() {
    const list = byId('examList');
    if (!list) return;

    const exams = getState().exams || [];
    list.innerHTML = exams.length
      ? exams.map(exam => `<li><span><strong>${escapeHtml(exam.name)}</strong></span> <small>Unidade: ${escapeHtml(exam.unit || 'Não informada')}</small><button type="button" class="ghost" data-exam-id="${escapeHtml(exam.id)}">Excluir</button></li>`).join('')
      : '<li><span style="color:var(--text-muted)">Nenhum exame cadastrado.</span></li>';

    list.querySelectorAll('[data-exam-id]').forEach(button => {
      button.addEventListener('click', () => deleteExam(button.dataset.examId));
    });
  }

  async function listExams() {
    try {
      const organizationId = getOrganizationId();
      const { data, error } = await getClient()
        .from('exam_catalog')
        .select('id, name, measurement_unit')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('name', { ascending: true });

      if (error) throw error;

      getState().exams = (data || []).map(exam => ({
        id: exam.id,
        name: exam.name,
        unit: exam.measurement_unit || ''
      }));
      window.NEXUS_SST_APP.render();
    } catch (error) {
      console.error('Falha ao carregar o catálogo de exames.', error);
      getState().exams = [];
      renderExamList();
      window.alert('Não foi possível carregar os exames do Supabase.');
    }
  }

  async function createExam(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const name = byId('examName')?.value.trim();
    const measurementUnit = byId('examUnit')?.value.trim();
    if (!name) {
      window.alert('Informe o nome do exame ou indicador.');
      return;
    }

    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;

    try {
      const organizationId = getOrganizationId();
      const { error } = await getClient()
        .from('exam_catalog')
        .insert({
          organization_id: organizationId,
          name,
          measurement_unit: measurementUnit || null,
          active: true
        });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um exame com este nome nesta organização.');
        }
        throw error;
      }

      form.reset();
      await listExams();
    } catch (error) {
      console.error('Falha ao cadastrar exame.', error);
      window.alert(error.message || 'Não foi possível cadastrar o exame.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteExam(id) {
    if (!id || !window.confirm('Excluir este exame? Esta ação não poderá ser desfeita.')) return;

    try {
      const organizationId = getOrganizationId();
      const { error } = await getClient()
        .from('exam_catalog')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) throw error;
      await listExams();
    } catch (error) {
      console.error('Falha ao excluir exame.', error);
      window.alert('Não foi possível excluir o exame.');
    }
  }

  function install() {
    if (installed) return;
    const form = byId('examForm');
    if (!form || !window.NEXUS_SST_APP?.getState) return;

    installed = true;
    form.onsubmit = createExam;
    listExams();
  }

  window.NexusExams = { listExams, createExam, deleteExam, renderExamList };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
