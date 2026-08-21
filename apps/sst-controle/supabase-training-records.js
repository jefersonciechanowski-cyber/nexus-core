(() => {
  'use strict';

  let installed = false;
  const byId = id => document.getElementById(id);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app()?.getState?.();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  const modalityLabels = {
    IN_PERSON: 'Presencial',
    ONLINE: 'Online',
    HYBRID: 'Híbrido'
  };
  const trainingKindLabels = {
    INITIAL: 'Inicial',
    PERIODIC: 'Periódico',
    EVENTUAL: 'Eventual',
    UNSPECIFIED: 'Não informado (registro legado)'
  };
  const recordSelect = 'id,record_code,employee_id,training_type_id,training_name,unit_id,sector_id,job_role_id,matrix_rule_id,applied_validity_days,completed_at,expires_at,certificate_number,certificate_path,instructor_name,instructor_entity,instructor_document,workload_hours,modality,training_location,program_content,notes,status,created_by,created_at,cancelled_at,cancel_reason,cancelled_by,training_kind,technical_responsible_name,technical_responsible_qualification,employee_name_snapshot,company_name_snapshot,company_registration_type_snapshot,company_registration_number_snapshot';

  function recordFromRow(row) {
    return {
      id: row.id,
      code: row.record_code,
      employeeId: row.employee_id,
      trainingTypeId: row.training_type_id,
      trainingName: row.training_name,
      unitId: row.unit_id || '',
      sectorId: row.sector_id || '',
      jobRoleId: row.job_role_id || '',
      matrixRuleId: row.matrix_rule_id || '',
      validityDays: row.applied_validity_days,
      date: row.completed_at,
      due: row.expires_at,
      certificate: row.certificate_number || '',
      certificatePath: row.certificate_path || '',
      instructor: row.instructor_name || '',
      instructorEntity: row.instructor_entity || '',
      instructorDocument: row.instructor_document || '',
      workloadHours: Number(row.workload_hours || 0),
      modality: row.modality,
      location: row.training_location || '',
      programContent: row.program_content || '',
      notes: row.notes || '',
      trainingKind: row.training_kind || 'UNSPECIFIED',
      technicalResponsible: row.technical_responsible_name || '',
      technicalResponsibleQualification: row.technical_responsible_qualification || '',
      employeeNameSnapshot: row.employee_name_snapshot || '',
      companyNameSnapshot: row.company_name_snapshot || '',
      companyRegistrationTypeSnapshot: row.company_registration_type_snapshot || '',
      companyRegistrationNumberSnapshot: row.company_registration_number_snapshot || '',
      status: row.status,
      createdBy: row.created_by || '',
      createdAt: row.created_at,
      cancelledAt: row.cancelled_at || '',
      cancelReason: row.cancel_reason || '',
      cancelledBy: row.cancelled_by || ''
    };
  }

  function formatDate(value) {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(value);
  }

  function validityStatus(due) {
    if (!due) return 'CRÍTICO';
    const target = new Date(`${due}T12:00:00`);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const days = Math.ceil((target - today) / 86400000);
    if (days < 0) return 'CRÍTICO';
    if (days <= 30) return 'ATENÇÃO';
    return 'BOM';
  }

  function certificateReady(record) {
    return Boolean(record
      && record.status === 'COMPLETED'
      && record.trainingKind !== 'UNSPECIFIED'
      && record.programContent
      && record.location
      && record.instructorDocument
      && record.technicalResponsible
      && record.technicalResponsibleQualification);
  }

  function errorMessage(error, fallback) {
    console.error(fallback, error);
    const cause = error?.cause || error;
    return cause?.message || error?.message || fallback;
  }

  async function loadRecords() {
    try {
      const rows = await window.NexusData.list({
        table: 'training_records',
        label: 'os registros de treinamento',
        select: recordSelect,
        order: { column: 'completed_at', ascending: false }
      });

      const history = rows.map(recordFromRow);
      state().trainingRecordHistory = history;
      state().trainingRecords = history.filter(record => record.status === 'COMPLETED');
      app().render();
      return history;
    } catch (error) {
      state().trainingRecordHistory = [];
      state().trainingRecords = [];
      app().render();
      window.alert(errorMessage(error, 'Não foi possível carregar os treinamentos do Supabase.'));
      return [];
    }
  }

  async function createRecord(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const employeeId = byId('trainingEmployee')?.value;
    const trainingTypeId = byId('trainingType')?.value;
    const completedAt = byId('trainingDate')?.value;
    const trainingKind = byId('trainingKind')?.value;
    const certificateNumber = byId('trainingCertificate')?.value.trim();
    const instructorName = byId('trainingInstructor')?.value.trim();
    const instructorEntity = byId('trainingInstructorEntity')?.value.trim();
    const instructorDocument = byId('trainingInstructorDocument')?.value.trim();
    const workloadHours = Number(byId('trainingHours')?.value);
    const modality = byId('trainingModality')?.value;
    const trainingLocation = byId('trainingLocation')?.value.trim();
    const programContent = byId('trainingContent')?.value.trim();
    const notes = byId('trainingNotes')?.value.trim();
    const technicalResponsible = byId('trainingTechnicalResponsible')?.value.trim();
    const technicalResponsibleQualification = byId('trainingTechnicalQualification')?.value.trim();

    if (!employeeId || !trainingTypeId || !completedAt || !trainingKind || !instructorName || !instructorDocument || !workloadHours || !modality || !trainingLocation || !programContent || !technicalResponsible || !technicalResponsibleQualification) {
      return window.alert('Preencha todos os dados obrigatórios do certificado: treinamento, natureza, data, instrutor e qualificação, carga horária, modalidade, local, conteúdo programático e responsável técnico com qualificação.');
    }

    if (completedAt > new Date().toISOString().slice(0, 10)) {
      return window.alert('A realização do treinamento não pode ser registrada em data futura.');
    }

    if (!Number.isFinite(workloadHours) || workloadHours <= 0) {
      return window.alert('Informe uma carga horária válida.');
    }

    await window.NexusData.runLocked('create-training-record', async () => {
      try {
        const rows = await window.NexusData.insert({
          table: 'training_records',
          label: 'o treinamento',
          values: {
            employee_id: employeeId,
            training_type_id: trainingTypeId,
            completed_at: completedAt,
            training_kind: trainingKind,
            certificate_number: certificateNumber || null,
            instructor_name: instructorName,
            instructor_entity: instructorEntity || null,
            instructor_document: instructorDocument || null,
            workload_hours: workloadHours,
            modality,
            training_location: trainingLocation || null,
            program_content: programContent || null,
            notes: notes || null,
            technical_responsible_name: technicalResponsible,
            technical_responsible_qualification: technicalResponsibleQualification
          },
          select: recordSelect
        });

        if (!rows[0]) throw new Error('O treinamento foi salvo, mas não pôde ser confirmado.');
        const record = recordFromRow(rows[0]);
        state().trainingRecordHistory.unshift(record);
        state().trainingRecords.unshift(record);
        form.reset();
        if (byId('trainingModality')) byId('trainingModality').value = 'IN_PERSON';
        app().render();
        window.alert(`Treinamento registrado com o código ${record.code}.`);
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível registrar o treinamento.'));
      }
    }, button);
  }

  async function cancelRecord(id) {
    const record = state().trainingRecordHistory.find(item => String(item.id) === String(id));
    if (!record) return window.alert('Registro de treinamento não encontrado.');
    if (record.status === 'CANCELLED') return window.alert('Este treinamento já está cancelado.');

    const reason = window.prompt('Informe o motivo do cancelamento. O registro continuará disponível para auditoria:');
    if (reason === null) return;
    if (!reason.trim()) return window.alert('O motivo do cancelamento é obrigatório.');
    if (!window.confirm(`Cancelar o treinamento ${record.code}? Esta ação preservará o histórico e não poderá ser desfeita.`)) return;

    await window.NexusData.runLocked(`cancel-training-record-${id}`, async () => {
      try {
        const rows = await window.NexusData.update({
          table: 'training_records',
          label: 'o treinamento',
          id,
          values: {
            status: 'CANCELLED',
            cancel_reason: reason.trim()
          },
          select: recordSelect
        });

        if (!rows[0]) throw new Error('O cancelamento foi salvo, mas não pôde ser confirmado.');
        const updated = recordFromRow(rows[0]);
        const historyIndex = state().trainingRecordHistory.findIndex(item => String(item.id) === String(id));
        state().trainingRecordHistory[historyIndex] = updated;
        state().trainingRecords = state().trainingRecords.filter(item => String(item.id) !== String(id));
        app().render();
      } catch (error) {
        window.alert(errorMessage(error, 'Não foi possível cancelar o treinamento.'));
      }
    });
  }

  function renderHistory() {
    const body = byId('trainingHistoryTable');
    const count = byId('trainingHistoryCount');
    if (!body || !count || !state()) return;

    const employeeMap = new Map((state().employees || []).map(employee => [String(employee.id), employee]));
    const allRows = state().trainingRecordHistory || [];
    const unitId = byId('trainingUnit')?.value || '';
    const sectorId = byId('trainingSector')?.value || '';
    const typeId = byId('trainingFilterType')?.value || '';
    const requiredStatus = byId('trainingStatus')?.value || '';
    const query = (byId('trainingSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
    const rows = allRows.filter(record => {
      const employee = employeeMap.get(String(record.employeeId));
      if (unitId && String(record.unitId || employee?.unitId || '') !== unitId) return false;
      if (sectorId && String(record.sectorId || employee?.sectorId || '') !== sectorId) return false;
      if (typeId && String(record.trainingTypeId) !== typeId) return false;
      if (requiredStatus && (record.status !== 'COMPLETED' || validityStatus(record.due) !== requiredStatus)) return false;
      if (query && ![
        record.code,
        record.trainingName,
        record.instructor,
        record.instructorEntity,
        employee?.name
      ].join(' ').toLocaleLowerCase('pt-BR').includes(query)) return false;
      return true;
    });
    count.textContent = rows.length === allRows.length
      ? `${rows.length} registro${rows.length === 1 ? '' : 's'} preservado${rows.length === 1 ? '' : 's'}`
      : `${rows.length} de ${allRows.length} registros preservados`;

    body.innerHTML = rows.length ? rows.map(record => {
      const employee = employeeMap.get(String(record.employeeId));
      const cancelled = record.status === 'CANCELLED';
      const entity = record.instructorEntity ? ` · ${escapeHtml(record.instructorEntity)}` : '';
      const reason = cancelled ? `<br><small>Motivo: ${escapeHtml(record.cancelReason)}</small>` : '';
      const readyForCertificate = certificateReady(record);
      const certificate = record.certificate
        ? escapeHtml(record.certificate)
        : (readyForCertificate
          ? '<span class="badge badge-bom">Nexus disponível</span>'
          : '<span style="color:var(--text-muted)">Dados documentais pendentes</span>');
      const action = cancelled
        ? '<span style="color:var(--text-muted)">Histórico preservado</span>'
        : `${readyForCertificate ? `<button type="button" class="ghost" data-training-action="certificate" data-training-id="${escapeHtml(record.id)}">Emitir certificado</button> ` : ''}<button type="button" class="ghost" data-training-action="cancel" data-training-id="${escapeHtml(record.id)}">Cancelar registro</button>`;

      return `<tr>
        <td><strong>${escapeHtml(record.code)}</strong><br><small>${formatDate(record.date)}</small></td>
        <td><strong>${escapeHtml(employee?.name || 'Colaborador não encontrado')}</strong></td>
        <td>${escapeHtml(record.trainingName)}<br><small>${escapeHtml(trainingKindLabels[record.trainingKind] || record.trainingKind)} · vence em ${formatDate(record.due)}</small></td>
        <td>${escapeHtml(record.instructor)}${entity}<br><small>${escapeHtml(record.workloadHours)} h · ${escapeHtml(modalityLabels[record.modality] || record.modality)}</small></td>
        <td>${certificate}</td>
        <td>${cancelled ? '<span class="badge badge-sem">Cancelado</span>' : '<span class="badge badge-bom">Válido</span>'}${reason}</td>
        <td>${action}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhum treinamento realizado foi registrado.</td></tr>';
  }

  function install() {
    if (installed || !byId('trainingRecordForm') || !window.NexusData || !state()) return;
    installed = true;
    byId('trainingRecordForm').onsubmit = createRecord;
    byId('trainingHistoryTable')?.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('[data-training-action]');
      if (!button) return;
      const id = button.dataset.trainingId;
      if (button.dataset.trainingAction === 'certificate') window.NexusDocuments?.printTrainingCertificate?.(id);
      if (button.dataset.trainingAction === 'cancel') cancelRecord(id);
    });
    window.cancelTrainingRecord = cancelRecord;
    window.NexusTrainingRecords = {
      loadRecords,
      createRecord,
      cancelRecord,
      renderHistory,
      certificateReady
    };
    loadRecords();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
