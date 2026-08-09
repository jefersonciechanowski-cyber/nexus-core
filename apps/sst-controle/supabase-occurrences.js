(() => {
  'use strict';

  let installed = false;
  const byId = id => document.getElementById(id);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app()?.getState?.();

  const severityToDatabase = {
    Baixa: 'LOW',
    Média: 'MEDIUM',
    Alta: 'HIGH'
  };

  const severityFromDatabase = {
    LOW: 'Baixa',
    MEDIUM: 'Média',
    HIGH: 'Alta / Crítica'
  };

  function typeFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      active: row.active,
      createdAt: row.created_at
    };
  }

  function occurrenceFromRow(row) {
    return {
      id: row.id,
      employeeId: row.employee_id,
      occurrenceTypeId: row.occurrence_type_id,
      type: row.occurrence_type,
      severity: severityFromDatabase[row.severity] || row.severity,
      severityCode: row.severity,
      date: row.occurred_at,
      desc: row.description,
      unitId: row.unit_id || '',
      sectorId: row.sector_id || '',
      status: row.status,
      cancelledAt: row.cancelled_at || '',
      cancelReason: row.cancel_reason || '',
      createdBy: row.created_by || '',
      cancelledBy: row.cancelled_by || '',
      createdAt: row.created_at
    };
  }

  function errorMessage(error, fallback) {
    console.error(fallback, error);
    const cause = error?.cause || error;
    if (cause?.code === '23505') {
      return 'Já existe um tipo de ocorrência ativo com este nome.';
    }
    return cause?.message || error?.message || fallback;
  }

  async function loadOccurrenceTypes() {
    const rows = await window.NexusData.list({
      table: 'occurrence_types',
      label: 'os tipos de ocorrência',
      select: 'id,name,active,created_at',
      filters: [{ column: 'active', value: true }],
      order: { column: 'name', ascending: true }
    });
    state().occurrenceTypes = rows.map(typeFromRow);
    return state().occurrenceTypes;
  }

  async function loadOccurrences() {
    const rows = await window.NexusData.list({
      table: 'occurrences',
      label: 'as ocorrências',
      select: 'id,employee_id,occurrence_type_id,occurrence_type,severity,description,occurred_at,unit_id,sector_id,status,cancelled_at,cancel_reason,created_by,cancelled_by,created_at',
      order: { column: 'occurred_at', ascending: false }
    });
    state().risks = rows.map(occurrenceFromRow);
    return state().risks;
  }

  async function loadAll() {
    try {
      await Promise.all([loadOccurrenceTypes(), loadOccurrences()]);
      app().render();
    } catch (error) {
      state().occurrenceTypes = [];
      state().risks = [];
      app().render();
      window.alert(errorMessage(error, 'Não foi possível carregar riscos e incidentes do Supabase.'));
    }
  }

  async function createOccurrenceType(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const name = byId('ocTypeName')?.value.trim();
    if (!name) return window.alert('Informe o nome do tipo de ocorrência.');

    await window.NexusData.runLocked('create-occurrence-type', async () => {
      try {
        const rows = await window.NexusData.insert({
          table: 'occurrence_types',
          label: 'o tipo de ocorrência',
          values: { name },
          select: 'id,name,active,created_at'
        });
        if (!rows[0]) throw new Error('O tipo foi salvo, mas não pôde ser confirmado.');
        state().occurrenceTypes.push(typeFromRow(rows[0]));
        state().occurrenceTypes.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
        form.reset();
        app().render();
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível cadastrar o tipo de ocorrência.'));
      }
    }, button);
  }

  async function createOccurrence(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const employeeId = byId('riskEmployee')?.value;
    const occurrenceTypeId = byId('riskType')?.value;
    const severity = severityToDatabase[byId('riskSeverity')?.value];
    const occurredAt = byId('riskDate')?.value;
    const description = byId('riskDesc')?.value.trim();

    if (!employeeId || !occurrenceTypeId || !severity || !occurredAt || !description) {
      return window.alert('Informe colaborador, tipo, severidade, data e descrição da ocorrência.');
    }

    await window.NexusData.runLocked('create-occurrence', async () => {
      try {
        const rows = await window.NexusData.insert({
          table: 'occurrences',
          label: 'a ocorrência',
          values: {
            employee_id: employeeId,
            occurrence_type_id: occurrenceTypeId,
            severity,
            occurred_at: occurredAt,
            description
          },
          select: 'id,employee_id,occurrence_type_id,occurrence_type,severity,description,occurred_at,unit_id,sector_id,status,cancelled_at,cancel_reason,created_by,cancelled_by,created_at'
        });
        if (!rows[0]) throw new Error('A ocorrência foi salva, mas não pôde ser confirmada.');
        state().risks.unshift(occurrenceFromRow(rows[0]));
        form.reset();
        app().render();
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível registrar a ocorrência.'));
      }
    }, button);
  }

  async function deactivateOccurrenceType(id) {
    const occurrenceType = state().occurrenceTypes.find(item => String(item.id) === String(id));
    if (!occurrenceType) return window.alert('Tipo de ocorrência não encontrado.');
    if (!window.confirm(`Desativar o tipo “${occurrenceType.name}”? O histórico será preservado.`)) return;

    await window.NexusData.runLocked(`deactivate-occurrence-type-${id}`, async () => {
      try {
        await window.NexusData.update({
          table: 'occurrence_types',
          label: 'o tipo de ocorrência',
          id,
          values: { active: false }
        });
        state().occurrenceTypes = state().occurrenceTypes.filter(item => String(item.id) !== String(id));
        app().render();
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível desativar o tipo de ocorrência.'));
      }
    });
  }

  async function cancelOccurrence(id) {
    const occurrence = state().risks.find(item => String(item.id) === String(id));
    if (!occurrence) return window.alert('Ocorrência não encontrada.');
    if (occurrence.status === 'CANCELLED') return window.alert('Esta ocorrência já está cancelada.');

    const reason = window.prompt('Informe o motivo do cancelamento. O registro continuará no histórico:');
    if (reason === null) return;
    if (!reason.trim()) return window.alert('O motivo do cancelamento é obrigatório.');
    if (!window.confirm('Confirmar o cancelamento desta ocorrência? Esta ação preservará o histórico e não poderá ser desfeita.')) return;

    await window.NexusData.runLocked(`cancel-occurrence-${id}`, async () => {
      try {
        const rows = await window.NexusData.update({
          table: 'occurrences',
          label: 'a ocorrência',
          id,
          values: {
            status: 'CANCELLED',
            cancel_reason: reason.trim()
          },
          select: 'id,employee_id,occurrence_type_id,occurrence_type,severity,description,occurred_at,unit_id,sector_id,status,cancelled_at,cancel_reason,created_by,cancelled_by,created_at'
        });
        if (!rows[0]) throw new Error('O cancelamento foi salvo, mas não pôde ser confirmado.');
        const index = state().risks.findIndex(item => String(item.id) === String(id));
        state().risks[index] = occurrenceFromRow(rows[0]);
        app().render();
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível cancelar a ocorrência.'));
      }
    });
  }

  function install() {
    if (installed || !byId('riskForm') || !byId('occurrenceTypeForm') || !window.NexusData || !state()) return;
    installed = true;
    byId('riskForm').onsubmit = createOccurrence;
    byId('occurrenceTypeForm').onsubmit = createOccurrenceType;
    window.cancelOccurrence = cancelOccurrence;
    window.deactivateOccurrenceType = deactivateOccurrenceType;
    window.NexusOccurrences = {
      loadAll,
      loadOccurrenceTypes,
      loadOccurrences,
      createOccurrence,
      createOccurrenceType,
      cancelOccurrence,
      deactivateOccurrenceType
    };
    loadAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
