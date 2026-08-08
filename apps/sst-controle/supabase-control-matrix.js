(() => {
  'use strict';

  const typeToDatabase = {
    Exame: 'EXAM',
    Treinamento: 'TRAINING',
    EPI: 'EPI',
    Documento: 'DOCUMENT',
    Risco: 'RISK'
  };
  const typeFromDatabase = Object.fromEntries(
    Object.entries(typeToDatabase).map(([label, value]) => [value, label])
  );
  let installed = false;

  const byId = id => document.getElementById(id);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app()?.getState?.();

  function ruleFromRow(row) {
    return {
      id: row.id,
      unitId: row.unit_id || '',
      sectorId: row.sector_id || '',
      jobRoleId: row.job_role_id || '',
      type: typeFromDatabase[row.requirement_type] || row.requirement_type,
      itemId: row.epi_id || row.exam_id || row.training_id || '',
      itemName: row.requirement_name,
      validity: Number(row.validity_days || 0),
      effective: row.effective_from || '',
      active: row.active,
      createdAt: row.created_at
    };
  }

  function selectedItem(type, itemId) {
    const current = state();
    if (type === 'Exame') return current.exams.find(item => String(item.id) === String(itemId));
    if (type === 'Treinamento') return current.trainingTypes.find(item => String(item.id) === String(itemId));
    if (type === 'EPI') return current.epis.find(item => String(item.id) === String(itemId));
    return null;
  }

  function valuesFromForm() {
    const type = byId('matrixType').value;
    const unitId = byId('matrixUnit').value || null;
    const sectorId = byId('matrixSector').value || null;
    const jobRoleId = byId('matrixRole').value || null;
    const custom = type === 'Documento' || type === 'Risco';
    const itemId = custom ? null : byId('matrixItem').value || null;
    const item = custom ? null : selectedItem(type, itemId);
    const itemName = custom ? byId('matrixCustomItem').value.trim() : item?.name?.trim();
    const rawValidity = byId('matrixValidity').value;
    const validityDays = Number(rawValidity);
    const effectiveFrom = byId('matrixEffective').value || null;

    if (!typeToDatabase[type]) throw new Error('Selecione um tipo de requisito válido.');
    if (!itemName) throw new Error('Informe o requisito da Matriz.');
    if (!Number.isInteger(validityDays) || validityDays < 0) {
      throw new Error('A validade deve ser informada em dias inteiros, sem valor negativo.');
    }

    if (sectorId) {
      const selectedSector = state().sectors.find(item => String(item.id) === String(sectorId));
      if (!unitId || !selectedSector || String(selectedSector.unitId) !== String(unitId)) {
        throw new Error('Selecione uma unidade e um setor pertencente a essa unidade.');
      }
    }

    if (type === 'EPI') {
      if (!unitId || !sectorId || !jobRoleId) {
        throw new Error('Para EPIs, selecione obrigatoriamente unidade, setor e função cadastrada.');
      }
      if (!itemId) throw new Error('Selecione o EPI obrigatório.');
      if (validityDays <= 0) {
        throw new Error('Informe o prazo de troca deste EPI para o setor e a função selecionados.');
      }
    }

    return {
      unit_id: unitId,
      sector_id: sectorId,
      job_role_id: jobRoleId,
      requirement_type: typeToDatabase[type],
      exam_id: type === 'Exame' ? itemId : null,
      training_id: type === 'Treinamento' ? itemId : null,
      epi_id: type === 'EPI' ? itemId : null,
      requirement_name: itemName,
      validity_days: validityDays,
      effective_from: effectiveFrom,
      active: true
    };
  }

  function showError(error, fallback) {
    console.error(fallback, error);
    const code = error?.code || error?.cause?.code;
    if (code === '23505') {
      window.alert('Já existe uma regra ativa para esta combinação de unidade, setor, função e requisito.');
      return;
    }
    window.alert(error?.message || fallback);
  }

  async function loadRules() {
    const rows = await window.NexusData.list({
      table: 'control_matrix_rules',
      label: 'as regras da Matriz',
      select: 'id,unit_id,sector_id,job_role_id,requirement_type,exam_id,training_id,epi_id,requirement_name,validity_days,effective_from,active,created_at',
      filters: [{ column: 'active', value: true }],
      order: { column: 'created_at', ascending: true }
    });
    state().matrixRules = rows.map(ruleFromRow);
    app().render();
    return state().matrixRules;
  }

  async function submitRule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await window.NexusData.runLocked('create-control-matrix-rule', async () => {
      try {
        const values = valuesFromForm();
        const rows = await window.NexusData.insert({
          table: 'control_matrix_rules',
          label: 'a regra da Matriz',
          values,
          select: 'id,unit_id,sector_id,job_role_id,requirement_type,exam_id,training_id,epi_id,requirement_name,validity_days,effective_from,active,created_at'
        });
        if (!rows[0]) throw new Error('A regra foi salva, mas não pôde ser confirmada.');
        state().matrixRules.push(ruleFromRow(rows[0]));
        form.reset();
        app().render();
      } catch (error) {
        showError(error, 'Não foi possível salvar a regra da Matriz.');
      }
    }, form.querySelector('[type="submit"]'));
  }

  async function deactivateRule(id) {
    const rule = state().matrixRules.find(item => String(item.id) === String(id));
    if (!rule) return window.alert('Regra da Matriz não encontrada.');
    if (!window.confirm('Desativar esta regra da Matriz? O histórico será preservado.')) return;

    await window.NexusData.runLocked(`deactivate-control-matrix-rule-${id}`, async () => {
      try {
        await window.NexusData.update({
          table: 'control_matrix_rules',
          label: 'a regra da Matriz',
          id,
          values: { active: false }
        });
        state().matrixRules = state().matrixRules.filter(item => String(item.id) !== String(id));
        app().render();
      } catch (error) {
        showError(error, 'Não foi possível desativar a regra da Matriz.');
      }
    });
  }

  function install() {
    if (installed || !byId('matrixForm') || !window.NexusData || !state()) return;
    installed = true;
    byId('matrixForm').onsubmit = submitRule;
    window.NexusControlMatrix = { loadRules, submitRule, deactivateRule };
    window.deleteMatrixRule = deactivateRule;
    loadRules().catch(error => {
      state().matrixRules = [];
      app().render();
      showError(error, 'Não foi possível carregar as regras da Matriz.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
