(() => {
  'use strict';

  const entities = {
    units: { table: 'units', select: 'id, name, establishment_kind, registration_type, registration_number, cnae_preponderant, esocial_valid_from, esocial_valid_to, cnpj_responsible, caepf_type, construction_contribution_substitution, postal_code, street, street_number, address_complement, district, city, state', label: 'a unidade', order: { column: 'name' } },
    sectors: { table: 'sectors', select: 'id, unit_id, name', label: 'o setor', order: { column: 'name' } },
    jobRoles: { table: 'job_roles', select: 'id, name', label: 'a função', order: { column: 'name' } },
    employees: { table: 'employees', select: 'id, unit_id, sector_id, job_role_id, full_name, shift, active, job_roles ( name )', label: 'o colaborador', order: { column: 'full_name' } }
  };
  const brazilianStates = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
  let installed = false;
  let editingUnitId = null;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const message = text => window.alert(text);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app().getState();
  const digits = value => String(value || '').replace(/\D/g, '');
  const hasAllowedNumericInput = value => /^[0-9./\-\s]*$/.test(String(value || ''));
  const hasAllowedPostalCodeInput = value => /^[0-9\-\s]*$/.test(String(value || ''));

  function formatCnpj(value) { return window.NexusCnpj.format(value); }

  function formatPostalCode(value) {
    if (!hasAllowedPostalCodeInput(value)) return String(value || '');
    return digits(value).replace(/^(\d{5})(\d)/, '$1-$2').slice(0, 9);
  }

  function formatRegistration(type, value) {
    return type === 'CNPJ' ? formatCnpj(value) : digits(value);
  }

  function isValidCnpj(value) { return window.NexusCnpj.isValid(value); }

  function dateFromMonth(value) { return value ? `${value}-01` : null; }
  function monthFromDate(value) { return value ? String(value).slice(0, 7) : ''; }
  function isLegalProfileComplete(unit) {
    const base = Boolean(unit?.name && unit?.establishmentKind && unit?.registrationType && unit?.registrationNumber && unit?.cnaePreponderant && unit?.esocialValidFrom);
    return base && (unit.registrationType !== 'CAEPF' || Boolean(unit.caepfType));
  }

  function mapUnit(row) {
    return {
      id: row.id,
      name: row.name,
      establishmentKind: row.establishment_kind || 'UNIDADE',
      registrationType: row.registration_type || '',
      registrationNumber: row.registration_number || '',
      cnaePreponderant: row.cnae_preponderant || '',
      esocialValidFrom: row.esocial_valid_from || '',
      esocialValidTo: row.esocial_valid_to || '',
      cnpjResponsible: row.cnpj_responsible || '',
      caepfType: row.caepf_type || '',
      constructionContributionSubstitution: row.construction_contribution_substitution || '',
      postalCode: row.postal_code || '',
      street: row.street || '',
      streetNumber: row.street_number || '',
      addressComplement: row.address_complement || '',
      district: row.district || '',
      city: row.city || '',
      state: row.state || ''
    };
  }

  function mapSector(row) { return { id: row.id, unitId: row.unit_id, name: row.name }; }
  function mapRole(row) { return { id: row.id, name: row.name }; }
  function mapEmployee(row) {
    const role = Array.isArray(row.job_roles) ? row.job_roles[0] : row.job_roles;
    return { id: row.id, name: row.full_name, unitId: row.unit_id, sectorId: row.sector_id, jobRoleId: row.job_role_id, role: role?.name || '', shift: row.shift, active: row.active };
  }

  async function loadAll() {
    try {
      window.NexusData.getClient();
      window.NexusData.getOrganizationId();
      const requests = [
        { key: 'units', label: 'unidades', map: mapUnit, promise: window.NexusData.list(entities.units) },
        { key: 'sectors', label: 'setores', map: mapSector, promise: window.NexusData.list(entities.sectors) },
        { key: 'jobRoles', label: 'funções', map: mapRole, promise: window.NexusData.list(entities.jobRoles) },
        { key: 'employees', label: 'colaboradores', map: mapEmployee, promise: window.NexusData.list({ ...entities.employees, filters: [{ column: 'active', value: true }] }) }
      ];
      const results = await Promise.allSettled(requests.map(request => request.promise));
      let hasFailure = false;
      results.forEach((result, index) => {
        const request = requests[index];
        if (result.status === 'fulfilled') state()[request.key] = result.value.map(request.map);
        else { hasFailure = true; console.error(`Falha ao carregar ${request.label}.`, result.reason); }
      });
      app().render();
      if (hasFailure) message('Alguns dados da estrutura organizacional não puderam ser atualizados. Os demais foram carregados normalmente.');
    } catch (cause) {
      console.error('Falha ao carregar a estrutura organizacional.', cause);
      message('Não foi possível carregar a estrutura organizacional do Supabase.');
    }
  }

  async function validateReference(table, id, extraFilters = []) {
    if (!id || !await window.NexusData.exists({ table, filters: [{ column: 'id', value: id }, ...extraFilters] })) throw new Error('O registro selecionado não pertence à organização autenticada.');
  }

  function updateConditionalUnitFields() {
    const type = byId('unitRegistrationType')?.value || '';
    document.querySelectorAll('[data-unit-registration="CNO"]').forEach(element => { element.hidden = type !== 'CNO'; });
    document.querySelectorAll('[data-unit-registration="CAEPF"]').forEach(element => { element.hidden = type !== 'CAEPF'; });
    if (type !== 'CNO') {
      byId('unitCnpjResponsible').value = '';
      byId('unitConstructionContributionSubstitution').value = '';
    }
    if (type !== 'CAEPF') byId('unitCaepfType').value = '';
  }

  function unitValuesFromForm() {
    const name = byId('unitName').value.trim();
    const establishmentKind = byId('unitEstablishmentKind').value;
    const registrationType = byId('unitRegistrationType').value || null;
    const rawRegistrationNumber = byId('unitRegistrationNumber').value;
    const rawCnaePreponderant = byId('unitCnaePreponderant').value;
    const rawCnpjResponsible = byId('unitCnpjResponsible').value;
    const rawPostalCode = byId('unitPostalCode').value;
    if (Boolean(registrationType) !== Boolean(rawRegistrationNumber.trim())) throw new Error('Informe o tipo e o número da inscrição juntos.');
    if (registrationType === 'CNPJ' && !window.NexusCnpj.isValid(rawRegistrationNumber)) throw new Error('Informe um CNPJ válido.');
    if ((registrationType === 'CAEPF' || registrationType === 'CNO') && !hasAllowedNumericInput(rawRegistrationNumber)) throw new Error('A inscrição deve conter apenas números e formatação permitida.');
    if (rawCnaePreponderant && !hasAllowedNumericInput(rawCnaePreponderant)) throw new Error('O CNAE deve conter apenas números e formatação permitida.');
    if (rawPostalCode && !hasAllowedPostalCodeInput(rawPostalCode)) throw new Error('O CEP deve conter apenas números, hífen e espaços.');
    if (rawCnpjResponsible && !window.NexusCnpj.isValid(rawCnpjResponsible)) throw new Error('Informe um CNPJ válido para o responsável pela obra.');
    const registrationNumber = registrationType === 'CNPJ'
      ? window.NexusCnpj.normalize(rawRegistrationNumber)
      : digits(rawRegistrationNumber);
    const cnaePreponderant = digits(rawCnaePreponderant);
    const esocialValidFrom = dateFromMonth(byId('unitEsocialValidFrom').value);
    const esocialValidTo = dateFromMonth(byId('unitEsocialValidTo').value);
    const cnpjResponsible = window.NexusCnpj.normalize(rawCnpjResponsible);
    const postalCode = digits(rawPostalCode);
    const unitState = byId('unitState').value || null;

    if (!name || !establishmentKind) throw new Error('Informe o nome e o tipo da unidade.');
    if (registrationType === 'CAEPF' && registrationNumber.length !== 14) throw new Error('O CAEPF deve possuir 14 dígitos.');
    if (registrationType === 'CNO' && registrationNumber.length !== 12) throw new Error('O CNO deve possuir 12 dígitos.');
    if (cnaePreponderant && cnaePreponderant.length !== 7) throw new Error('O CNAE preponderante deve possuir 7 dígitos.');
    if (postalCode && postalCode.length !== 8) throw new Error('O CEP deve possuir 8 dígitos.');
    if (unitState && !brazilianStates.has(unitState)) throw new Error('Informe uma UF brasileira válida.');
    if (esocialValidFrom && esocialValidTo && esocialValidTo < esocialValidFrom) throw new Error('O fim da validade eSocial não pode ser anterior ao início.');

    return {
      name,
      establishment_kind: establishmentKind,
      registration_type: registrationType,
      registration_number: registrationNumber || null,
      cnae_preponderant: cnaePreponderant || null,
      esocial_valid_from: esocialValidFrom,
      esocial_valid_to: esocialValidTo,
      cnpj_responsible: registrationType === 'CNO' ? cnpjResponsible || null : null,
      caepf_type: registrationType === 'CAEPF' && byId('unitCaepfType').value ? Number(byId('unitCaepfType').value) : null,
      construction_contribution_substitution: registrationType === 'CNO' && byId('unitConstructionContributionSubstitution').value ? Number(byId('unitConstructionContributionSubstitution').value) : null,
      postal_code: postalCode || null,
      street: byId('unitStreet').value.trim() || null,
      street_number: byId('unitStreetNumber').value.trim() || null,
      address_complement: byId('unitAddressComplement').value.trim() || null,
      district: byId('unitDistrict').value.trim() || null,
      city: byId('unitCity').value.trim() || null,
      state: unitState
    };
  }

  function resetUnitForm() {
    const form = byId('unitForm');
    form.reset();
    byId('unitEstablishmentKind').value = 'UNIDADE';
    editingUnitId = null;
    byId('unitSubmitButton').textContent = 'Cadastrar Unidade';
    byId('unitCancelEdit').hidden = true;
    updateConditionalUnitFields();
  }

  function fillUnitForm(unit) {
    byId('unitName').value = unit.name || '';
    byId('unitEstablishmentKind').value = unit.establishmentKind || 'UNIDADE';
    byId('unitRegistrationType').value = unit.registrationType || '';
    byId('unitRegistrationNumber').value = unit.registrationNumber || '';
    byId('unitCnaePreponderant').value = unit.cnaePreponderant || '';
    byId('unitEsocialValidFrom').value = monthFromDate(unit.esocialValidFrom);
    byId('unitEsocialValidTo').value = monthFromDate(unit.esocialValidTo);
    byId('unitCnpjResponsible').value = unit.cnpjResponsible || '';
    byId('unitCaepfType').value = unit.caepfType || '';
    byId('unitConstructionContributionSubstitution').value = unit.constructionContributionSubstitution || '';
    byId('unitPostalCode').value = unit.postalCode || '';
    byId('unitStreet').value = unit.street || '';
    byId('unitStreetNumber').value = unit.streetNumber || '';
    byId('unitAddressComplement').value = unit.addressComplement || '';
    byId('unitDistrict').value = unit.district || '';
    byId('unitCity').value = unit.city || '';
    byId('unitState').value = unit.state || '';
    byId('unitRegistrationNumber').dispatchEvent(new Event('input'));
    byId('unitCnpjResponsible').dispatchEvent(new Event('input'));
    byId('unitPostalCode').dispatchEvent(new Event('input'));
    updateConditionalUnitFields();
  }

  async function submitUnit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const action = editingUnitId ? 'update-unit' : 'create-unit';
    await window.NexusData.runLocked(action, async () => {
      try {
        const values = unitValuesFromForm();
        if (editingUnitId) await window.NexusData.update({ ...entities.units, id: editingUnitId, values });
        else await window.NexusData.insert({ ...entities.units, values });
        resetUnitForm();
        await loadAll();
      } catch (cause) {
        console.error('Falha ao salvar unidade.', cause);
        message(cause.message || 'Não foi possível salvar a unidade.');
      }
    }, form.querySelector('[type="submit"]'));
  }

  function editUnit(id) {
    const unit = state().units.find(item => String(item.id) === String(id));
    if (!unit) return message('Unidade não encontrada. Atualize a página e tente novamente.');
    editingUnitId = unit.id;
    fillUnitForm(unit);
    byId('unitSubmitButton').textContent = 'Salvar Alterações';
    byId('unitCancelEdit').hidden = false;
    byId('unitForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitSector(event) {
    event.preventDefault();
    const form = event.currentTarget, name = byId('sectorName').value.trim(), unitId = byId('sectorUnit').value;
    if (!name || !unitId) return message('Informe o nome e selecione a unidade do setor.');
    await window.NexusData.runLocked('create-sector', async () => {
      try { await validateReference('units', unitId); await window.NexusData.insert({ ...entities.sectors, values: { name, unit_id: unitId } }); form.reset(); await loadAll(); }
      catch (cause) { console.error('Falha ao cadastrar setor.', cause); message('Não foi possível cadastrar o setor.'); }
    }, form.querySelector('[type="submit"]'));
  }

  async function submitRole(event) {
    event.preventDefault();
    const form = event.currentTarget, name = byId('jobRoleName').value.trim();
    if (!name) return message('Informe o nome da função.');
    await window.NexusData.runLocked('create-job-role', async () => {
      try { await window.NexusData.insert({ ...entities.jobRoles, values: { name } }); form.reset(); await loadAll(); }
      catch (cause) { console.error('Falha ao cadastrar função.', cause); message('Não foi possível cadastrar a função.'); }
    }, form.querySelector('[type="submit"]'));
  }

  async function submitEmployee(event) {
    event.preventDefault();
    const form = event.currentTarget, fullName = byId('empName').value.trim(), unitId = byId('empUnit').value, sectorId = byId('empSector').value, jobRoleId = byId('empRole').value, shift = byId('empShift').value;
    if (!fullName || !unitId || !sectorId || !jobRoleId) return message('Preencha nome, unidade, setor e função do colaborador.');
    await window.NexusData.runLocked('create-employee', async () => {
      try {
        await validateReference('units', unitId);
        await validateReference('sectors', sectorId, [{ column: 'unit_id', value: unitId }]);
        await validateReference('job_roles', jobRoleId);
        await window.NexusData.insert({ ...entities.employees, values: { full_name: fullName, unit_id: unitId, sector_id: sectorId, job_role_id: jobRoleId, shift, active: true } });
        form.reset(); await loadAll();
      } catch (cause) { console.error('Falha ao cadastrar colaborador.', cause); message('Não foi possível cadastrar o colaborador.'); }
    }, form.querySelector('[type="submit"]'));
  }

  async function linkCounts(configs) { return Promise.all(configs.map(config => window.NexusData.count(config))); }

  async function deleteEntity(key, id) {
    const definition = entities[key];
    const linksByEntity = {
      units: [{ table: 'sectors', filters: [{ column: 'unit_id', value: id }] }, { table: 'employees', filters: [{ column: 'unit_id', value: id }] }],
      sectors: [{ table: 'employees', filters: [{ column: 'sector_id', value: id }] }, { table: 'control_matrix_rules', filters: [{ column: 'sector_id', value: id }] }, { table: 'epi_deliveries', filters: [{ column: 'sector_id', value: id }] }],
      jobRoles: [{ table: 'employees', filters: [{ column: 'job_role_id', value: id }] }, { table: 'control_matrix_rules', filters: [{ column: 'job_role_id', value: id }] }]
    };
    await window.NexusData.runLocked(`delete-${key}-${id}`, async () => {
      try {
        const counts = await linkCounts(linksByEntity[key]);
        if (counts.some(Boolean)) return message('Não é possível excluir este registro porque existem vínculos associados.');
        if (!window.confirm(`Excluir ${definition.label}? Esta ação não poderá ser desfeita.`)) return;
        await window.NexusData.remove({ ...definition, id }); await loadAll();
      } catch (cause) { console.error(`Falha ao excluir ${key}.`, cause); message('Não foi possível excluir o registro.'); }
    });
  }

  async function deactivateEmployee(id) {
    await window.NexusData.runLocked(`deactivate-employee-${id}`, async () => {
      try {
        if (!window.confirm('Desativar este colaborador? O histórico será preservado.')) return;
        await window.NexusData.update({ ...entities.employees, id, values: { active: false } }); await loadAll();
      } catch (cause) { console.error('Falha ao desativar colaborador.', cause); message('Não foi possível desativar o colaborador.'); }
    });
  }

  function renderManagedLists() {
    const current = state();
    const unitName = id => current.units.find(item => String(item.id) === String(id))?.name || 'Sem unidade';
    const unitList = byId('unitList'), sectorList = byId('sectorList'), roleList = byId('jobRoleList'), employeeList = byId('employeeList');
    if (unitList) unitList.innerHTML = current.units.length ? current.units.map(item => {
      const registration = item.registrationType && item.registrationNumber ? `${item.registrationType}: ${formatRegistration(item.registrationType, item.registrationNumber)}` : 'Sem inscrição legal';
      const location = [item.city, item.state].filter(Boolean).join(' / ');
      const profileStatus = isLegalProfileComplete(item) ? 'Cadastro completo' : 'Cadastro legal incompleto';
      return `<li><span><strong>${esc(item.name)}</strong><small>Tipo: ${esc(item.establishmentKind)} | Inscrição: ${esc(registration)}${location ? ` | ${esc(location)}` : ''}</small><small>${esc(profileStatus)}</small></span><span><button type="button" class="ghost" onclick="editUnit('${esc(item.id)}')">Editar</button><button type="button" class="ghost" onclick="deleteUnit('${esc(item.id)}')">Excluir</button></span></li>`;
    }).join('') : '<li><span style="color:var(--text-muted)">Nenhuma unidade cadastrada.</span></li>';
    if (sectorList) sectorList.innerHTML = current.sectors.length ? current.sectors.map(item => `<li><span><strong>${esc(item.name)}</strong></span><small>${esc(unitName(item.unitId))}</small><button type="button" class="ghost" onclick="deleteSector('${esc(item.id)}')">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhum setor cadastrado.</span></li>';
    if (roleList) roleList.innerHTML = current.jobRoles.length ? current.jobRoles.map(item => `<li><span><strong>${esc(item.name)}</strong></span><button type="button" class="ghost" onclick="deleteJobRole('${esc(item.id)}')">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhuma função cadastrada.</span></li>';
    if (employeeList) current.employees.forEach((item, index) => {
      const listItem = employeeList.children[index];
      if (!listItem || listItem.querySelector('[data-organizational-action="deactivate"]')) return;
      const viewButton = listItem.querySelector('button');
      const actions = document.createElement('span');
      const deactivateButton = document.createElement('button');
      deactivateButton.type = 'button'; deactivateButton.className = 'ghost'; deactivateButton.dataset.organizationalAction = 'deactivate'; deactivateButton.textContent = 'Desativar'; deactivateButton.onclick = () => deactivateEmployee(item.id);
      if (viewButton) actions.appendChild(viewButton);
      actions.appendChild(deactivateButton); listItem.appendChild(actions);
    });
  }

  function installUnitMasks() {
    const registration = byId('unitRegistrationNumber');
    const responsible = byId('unitCnpjResponsible');
    const postalCode = byId('unitPostalCode');
    const cnae = byId('unitCnaePreponderant');
    registration.addEventListener('input', () => {
      registration.value = byId('unitRegistrationType').value === 'CNPJ'
        ? formatCnpj(registration.value)
        : hasAllowedNumericInput(registration.value) ? digits(registration.value) : registration.value;
    });
    responsible.addEventListener('input', () => { responsible.value = formatCnpj(responsible.value); });
    postalCode.addEventListener('input', () => { postalCode.value = formatPostalCode(postalCode.value); });
    cnae.addEventListener('input', () => { cnae.value = hasAllowedNumericInput(cnae.value) ? digits(cnae.value) : cnae.value; });
    byId('unitRegistrationType').addEventListener('change', () => { registration.dispatchEvent(new Event('input')); updateConditionalUnitFields(); });
  }

  function install() {
    if (installed || !app()?.getState || !app()?.render || !window.NexusData) return;
    installed = true;
    byId('unitForm').onsubmit = submitUnit;
    byId('unitCancelEdit').onclick = resetUnitForm;
    installUnitMasks();
    updateConditionalUnitFields();
    byId('sectorForm').onsubmit = submitSector;
    byId('jobRoleForm').onsubmit = submitRole;
    byId('employeeForm').onsubmit = submitEmployee;
    window.editUnit = editUnit;
    window.deleteUnit = id => deleteEntity('units', id);
    window.deleteSector = id => deleteEntity('sectors', id);
    window.deleteJobRole = id => deleteEntity('jobRoles', id);
    window.deactivateEmployee = deactivateEmployee;
    loadAll();
  }

  window.NexusOrganizational = { loadAll, renderManagedLists, isLegalProfileComplete };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
