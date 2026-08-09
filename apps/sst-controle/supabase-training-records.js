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
        select: 'id,record_code,employee_id,training_type_id,training_name,unit_id,sector_id,job_role_id,matrix_rule_id,applied_validity_days,completed_at,expires_at,certificate_number,certificate_path,instructor_name,instructor_entity,instructor_document,workload_hours,modality,training_location,program_content,notes,status,created_by,created_at,cancelled_at,cancel_reason,cancelled_by',
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
    const certificateNumber = byId('trainingCertificate')?.value.trim();
    const instructorName = byId('trainingInstructor')?.value.trim();
    const instructorEntity = byId('trainingInstructorEntity')?.value.trim();
    const instructorDocument = byId('trainingInstructorDocument')?.value.trim();
    const workloadHours = Number(byId('trainingHours')?.value);
    const modality = byId('trainingModality')?.value;
    const trainingLocation = byId('trainingLocation')?.value.trim();
    const programContent = byId('trainingContent')?.value.trim();
    const notes = byId('trainingNotes')?.value.trim();

    if (!employeeId || !trainingTypeId || !completedAt || !instructorName || !workloadHours || !modality) {
      return window.alert('Informe colaborador, treinamento, data, instrutor, carga horária e modalidade.');
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
            certificate_number: certificateNumber || null,
            instructor_name: instructorName,
            instructor_entity: instructorEntity || null,
            instructor_document: instructorDocument || null,
            workload_hours: workloadHours,
            modality,
            training_location: trainingLocation || null,
            program_content: programContent || null,
            notes: notes || null
          },
          select: 'id,record_code,employee_id,training_type_id,training_name,unit_id,sector_id,job_role_id,matrix_rule_id,applied_validity_days,completed_at,expires_at,certificate_number,certificate_path,instructor_name,instructor_entity,instructor_document,workload_hours,modality,training_location,program_content,notes,status,created_by,created_at,cancelled_at,cancel_reason,cancelled_by'
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
          select: 'id,record_code,employee_id,training_type_id,training_name,unit_id,sector_id,job_role_id,matrix_rule_id,applied_validity_days,completed_at,expires_at,certificate_number,certificate_path,instructor_name,instructor_entity,instructor_document,workload_hours,modality,training_location,program_content,notes,status,created_by,created_at,cancelled_at,cancel_reason,cancelled_by'
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
      const certificate = record.certificate
        ? escapeHtml(record.certificate)
        : '<span style="color:var(--text-muted)">Será emitido na etapa documental</span>';
      const action = cancelled
        ? '<span style="color:var(--text-muted)">Histórico preservado</span>'
        : `<button type="button" class="ghost" onclick="cancelTrainingRecord('${escapeHtml(record.id)}')">Cancelar registro</button>`;

      return `<tr>
        <td><strong>${escapeHtml(record.code)}</strong><br><small>${formatDate(record.date)}</small></td>
        <td><strong>${escapeHtml(employee?.name || 'Colaborador não encontrado')}</strong></td>
        <td>${escapeHtml(record.trainingName)}<br><small>Vence em ${formatDate(record.due)}</small></td>
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
    window.cancelTrainingRecord = cancelRecord;
    window.NexusTrainingRecords = {
      loadRecords,
      createRecord,
      cancelRecord,
      renderHistory
    };
    loadRecords();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
