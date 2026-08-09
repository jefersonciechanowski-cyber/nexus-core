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

  function renderTrainingTypeList() {
    const list = byId('trainingTypeList');
    if (!list) return;

    const trainingTypes = getState().trainingTypes || [];
    list.innerHTML = trainingTypes.length
      ? trainingTypes.map(training => `<li><span><strong>${escapeHtml(training.name)}</strong>${training.code ? ` — ${escapeHtml(training.code)}` : ''}</span><small>Validade padrão: ${escapeHtml(training.validity)} dias | Certificado: ${escapeHtml(training.certificate)}</small><button type="button" class="ghost" data-training-type-id="${escapeHtml(training.id)}">Excluir</button></li>`).join('')
      : '<li><span style="color:var(--text-muted)">Nenhum tipo de treinamento cadastrado.</span></li>';

    list.querySelectorAll('[data-training-type-id]').forEach(button => {
      button.addEventListener('click', () => deleteTrainingType(button.dataset.trainingTypeId));
    });
  }

  async function listTrainingTypes() {
    try {
      const organizationId = getOrganizationId();
      const { data, error } = await getClient()
        .from('training_catalog')
        .select('id, name, code, validity_days, requires_certificate')
        .eq('organization_id', organizationId)
        .eq('active', true)
        .order('name', { ascending: true });

      if (error) throw error;

      getState().trainingTypes = (data || []).map(training => ({
        id: training.id,
        name: training.name,
        code: training.code || '',
        validity: training.validity_days,
        certificate: training.requires_certificate ? 'Sim' : 'Não'
      }));
      window.NEXUS_SST_APP.render();
    } catch (error) {
      console.error('Falha ao carregar o catálogo de tipos de treinamento.', error);
      getState().trainingTypes = [];
      renderTrainingTypeList();
      window.alert('Não foi possível carregar os tipos de treinamento do Supabase.');
    }
  }

  async function createTrainingType(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const name = byId('trainingTypeName')?.value.trim();
    const code = byId('trainingTypeCode')?.value.trim();
    const validityDays = Number(byId('trainingTypeValidity')?.value);
    const requiresCertificate = byId('trainingTypeCertificate')?.value === 'Sim';

    if (!name || !Number.isInteger(validityDays) || validityDays <= 0) {
      window.alert('Informe o nome e uma validade positiva em dias.');
      return;
    }

    const button = form.querySelector('[type="submit"]');
    if (button) button.disabled = true;

    try {
      const organizationId = getOrganizationId();
      const { error } = await getClient()
        .from('training_catalog')
        .insert({
          organization_id: organizationId,
          name,
          code: code || null,
          validity_days: validityDays,
          requires_certificate: requiresCertificate,
          active: true
        });

      if (error) {
        if (error.code === '23505') {
          throw new Error('Já existe um tipo de treinamento com este nome nesta organização.');
        }
        throw error;
      }

      form.reset();
      await listTrainingTypes();
    } catch (error) {
      console.error('Falha ao cadastrar tipo de treinamento.', error);
      window.alert(error.message || 'Não foi possível cadastrar o tipo de treinamento.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteTrainingType(id) {
    if (!id) return;

    const state = getState();
    const hasTrainingRecords = (state.trainingRecordHistory || state.trainingRecords)
      .some(record => String(record.trainingTypeId) === String(id));
    const hasMatrixRules = state.matrixRules.some(rule => rule.type === 'Treinamento' && String(rule.itemId) === String(id));
    if (hasTrainingRecords || hasMatrixRules) {
      window.alert('Não é possível excluir este tipo de treinamento porque existem registros ou regras da Matriz de Controle vinculados a ele.');
      return;
    }

    if (!window.confirm('Excluir este tipo de treinamento? Esta ação não poderá ser desfeita.')) return;

    try {
      const organizationId = getOrganizationId();
      const { error } = await getClient()
        .from('training_catalog')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) throw error;
      await listTrainingTypes();
    } catch (error) {
      console.error('Falha ao excluir tipo de treinamento.', error);
      window.alert('Não foi possível excluir o tipo de treinamento.');
    }
  }

  function install() {
    if (installed) return;
    const form = byId('trainingTypeForm');
    if (!form || !window.NEXUS_SST_APP?.getState) return;

    installed = true;
    form.onsubmit = createTrainingType;
    listTrainingTypes();
  }

  window.NexusTrainingTypes = {
    listTrainingTypes,
    createTrainingType,
    deleteTrainingType,
    renderTrainingTypeList
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
