(() => {
  'use strict';

  let installed = false;
  const byId = id => document.getElementById(id);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app()?.getState?.();

  function localDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setFormMode(status) {
    const button = byId('epiMovementForm')?.querySelector('[type="submit"]');
    const reason = byId('epiMoveReason');
    const isClosure = status !== 'Entregue';
    if (button) {
      button.textContent = status === 'Descartado'
        ? 'Confirmar Descarte'
        : (status === 'Devolvido' ? 'Confirmar Retorno ao Estoque' : 'Salvar Entrega');
    }
    if (reason) {
      reason.style.display = isClosure ? '' : 'none';
      reason.required = status === 'Descartado';
      reason.placeholder = status === 'Descartado'
        ? 'Motivo obrigatório do descarte / baixa'
        : 'Condição do EPI / observação opcional';
      if (!isClosure) reason.value = '';
    }
  }

  function movementFromDelivery(row) {
    const common = {
      deliveryId: row.id,
      employeeId: row.employee_id,
      epiId: row.epi_id,
      matrixRuleId: row.matrix_rule_id,
      purchaseId: row.purchase_id,
      appliedValidity: Number(row.applied_validity_days || 0),
      dueDate: row.replacement_due_at || '',
      technicalResponsible: row.technical_responsible || 'Não definido',
      finalDisposition: row.final_disposition || '',
      unitId: row.unit_id || '',
      sectorId: row.sector_id || '',
      jobRoleId: row.job_role_id || '',
      createdAt: row.created_at
    };
    const movements = [{
      ...common,
      id: `${row.id}:delivery`,
      date: row.delivered_at,
      status: 'Entregue',
      isActive: !row.returned_at
    }];
    if (row.returned_at) {
      const discarded = row.final_disposition === 'DISCARDED';
      movements.push({
        ...common,
        id: `${row.id}:closure`,
        date: row.returned_at,
        status: discarded ? 'Descartado' : 'Devolvido',
        isActive: false,
        returnReason: row.return_reason || ''
      });
    }
    return movements;
  }

  function showError(error, fallback) {
    console.error(fallback, error);
    const message = error?.cause?.message || error?.message;
    window.alert(message || fallback);
  }

  async function loadDeliveries() {
    const rows = await window.NexusData.list({
      table: 'epi_deliveries',
      label: 'as entregas de EPIs',
      select: 'id,employee_id,epi_id,unit_id,sector_id,job_role_id,matrix_rule_id,purchase_id,delivered_at,applied_validity_days,replacement_due_at,technical_responsible,returned_at,return_reason,final_disposition,created_at',
      order: { column: 'delivered_at', ascending: true }
    });
    state().epiMovements = rows.flatMap(movementFromDelivery);
    app().render();
    return state().epiMovements;
  }

  function activeDelivery(employeeId, epiId) {
    return state().epiMovements.find(movement =>
      movement.status === 'Entregue'
      && movement.isActive
      && String(movement.employeeId) === String(employeeId)
      && String(movement.epiId) === String(epiId)
    );
  }

  async function submitMovement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const employeeId = byId('epiMoveEmp').value;
    const epiId = byId('epiMoveEpi').value;
    const movementDate = byId('epiMoveDate').value;
    const status = byId('epiMoveStatus').value;
    const reason = byId('epiMoveReason')?.value.trim() || '';

    if (!employeeId || !epiId || !movementDate) {
      return window.alert('Informe colaborador, EPI e data da movimentação.');
    }
    if (status === 'Descartado' && !reason) {
      return window.alert('Informe o motivo do descarte ou da baixa do EPI.');
    }

    await window.NexusData.runLocked('save-epi-movement', async () => {
      try {
        if (status === 'Entregue') {
          await window.NexusData.insert({
            table: 'epi_deliveries',
            label: 'a entrega de EPI',
            values: {
              employee_id: employeeId,
              epi_id: epiId,
              delivered_at: movementDate
            },
            select: 'id'
          });
        } else {
          const delivery = activeDelivery(employeeId, epiId);
          if (!delivery) {
            throw new Error('Não existe uma entrega ativa deste EPI para o colaborador selecionado.');
          }
          const finalDisposition = status === 'Descartado'
            ? 'DISCARDED'
            : 'RETURNED_TO_STOCK';
          await window.NexusData.update({
            table: 'epi_deliveries',
            label: status === 'Descartado' ? 'o descarte de EPI' : 'o retorno de EPI ao estoque',
            id: delivery.deliveryId,
            values: {
              returned_at: movementDate,
              final_disposition: finalDisposition,
              return_reason: reason || null
            }
          });
        }

        form.reset();
        setFormMode(byId('epiMoveStatus').value);
        byId('epiMoveEmp').dispatchEvent(new Event('change'));
        await loadDeliveries();
      } catch (error) {
        showError(error, status === 'Entregue'
          ? 'Não foi possível registrar a entrega de EPI.'
          : 'Não foi possível finalizar o uso do EPI.');
      }
    }, button);
  }

  function prepareClosure(deliveryId) {
    const movement = state().epiMovements.find(item =>
      item.status === 'Entregue'
      && item.isActive
      && String(item.deliveryId) === String(deliveryId)
    );
    if (!movement) return window.alert('Esta entrega não está mais ativa.');

    byId('epiMoveStatus').value = 'Descartado';
    byId('epiMoveEmp').value = movement.employeeId;
    byId('epiMoveEmp').dispatchEvent(new Event('change'));
    byId('epiMoveEpi').value = movement.epiId;
    byId('epiMoveDate').value = localDateISO();
    byId('epiMoveReason').value = '';
    setFormMode('Descartado');

    const notice = document.createElement('div');
    notice.className = 'requirements-empty';
    notice.style.borderColor = 'var(--gold)';
    notice.style.color = 'var(--text)';
    notice.textContent = 'Finalização preparada como descarte. Informe o motivo ou altere para retorno ao estoque somente se o EPI puder ser reutilizado.';
    byId('epiMoveRulePreview').replaceChildren(notice);

    byId('epiMovementForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => byId('epiMoveReason').focus({ preventScroll: true }));
  }

  function install() {
    if (installed || !byId('epiMovementForm') || !window.NexusData || !state()) return;
    installed = true;
    byId('epiMovementForm').onsubmit = submitMovement;
    byId('epiMoveStatus').addEventListener('change', event => {
      setFormMode(event.currentTarget.value);
      byId('epiMoveEmp').dispatchEvent(new Event('change'));
    });
    setFormMode(byId('epiMoveStatus').value);
    window.NexusEpiDeliveries = { loadDeliveries, submitMovement, prepareClosure };
    window.prepareEpiClosure = prepareClosure;
    window.prepareEpiReturn = prepareClosure;
    loadDeliveries().catch(error => {
      state().epiMovements = [];
      app().render();
      showError(error, 'Não foi possível carregar as entregas de EPIs.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
