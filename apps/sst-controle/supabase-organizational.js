(() => {
  'use strict';

  const entities = {
    units: { table: 'units', select: 'id, name, establishment_kind, registration_type, registration_number, cnae_preponderant, esocial_valid_from, esocial_valid_to, cnpj_responsible, caepf_type, construction_contribution_substitution, postal_code, street, street_number, address_complement, district, city, state', label: 'a unidade', order: { column: 'name' } },
    sectors: { table: 'sectors', select: 'id, unit_id, name', label: 'o setor', order: { column: 'name' } },
    jobRoles: { table: 'job_roles', select: 'id, name', label: 'a função', order: { column: 'name' } },
    employees: { table: 'employees', select: 'id, unit_id, sector_id, job_role_id, full_name, shift, active, cpf, birth_date, esocial_worker_type, esocial_registration, esocial_category_code, relationship_start_date, relationship_end_date, job_roles ( name )', label: 'o colaborador', order: { column: 'full_name' } }
  };
  const brazilianStates = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
  let installed = false;
  let editingUnitId = null;
  let editingEmployeeId = null;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const message = text => window.alert(text);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app().getState();
  const digits = value => String(value || '').replace(/\D/g, '');
  const hasAllowedNumericInput = value => /^[0-9./\-\s]*$/.test(String(value || ''));
  const hasAllowedPostalCodeInput = value => /^[0-9\-\s]*$/.test(String(value || ''));
  const hasAllowedCpfInput = value => /^[0-9.\-\s]*$/.test(String(value || ''));

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
    return { id: row.id, name: row.full_name, unitId: row.unit_id, sectorId: row.sector_id, jobRoleId: row.job_role_id, role: role?.name || '', shift: row.shift, active: row.active, cpf: row.cpf || '', birthDate: row.birth_date || '', esocialWorkerType: row.esocial_worker_type || '', esocialRegistration: row.esocial_registration || '', esocialCategoryCode: row.esocial_category_code || '', relationshipStartDate: row.relationship_start_date || '', relationshipEndDate: row.relationship_end_date || '' };
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

  function formatCpf(value) {
    if (!hasAllowedCpfInput(value)) return String(value || '');
    return digits(value).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2').slice(0, 14);
  }

  function isValidCpf(value) {
    const cpf = digits(value);
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    const digit = length => {
      const sum = cpf.slice(0, length).split('').reduce((total, item, index) => total + Number(item) * (length + 1 - index), 0);
      const result = (sum * 10) % 11;
      return result === 10 ? 0 : result;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  }

  function employeeProfileComplete(employee) {
    const base = Boolean(employee?.name && employee?.cpf && employee?.birthDate && employee?.esocialWorkerType && employee?.relationshipStartDate && employee?.unitId && employee?.sectorId && employee?.jobRoleId);
    if (!base) return false;
    return employee.esocialWorkerType === 'VINCULO' ? Boolean(employee.esocialRegistration) : employee.esocialWorkerType === 'TSVE' ? Boolean(employee.esocialRegistration || employee.esocialCategoryCode) : false;
  }

  function updateEmployeeWorkerTypeFields() {
    const type = byId('empEsocialWorkerType').value;
    const categoryWrap = byId('empEsocialCategoryWrap');
    categoryWrap.hidden = type !== 'TSVE';
    const startLabel = type === 'TSVE' ? 'Início do TSVE' : 'Início do Vínculo / Admissão';
    const endLabel = type === 'TSVE' ? 'Término do TSVE' : 'Fim do Vínculo / Desligamento';
    byId('empRelationshipStartDate').title = startLabel; byId('empRelationshipEndDate').title = endLabel;
    byId('empRelationshipStartLabel').textContent = startLabel; byId('empRelationshipEndLabel').textContent = endLabel;
    if (type !== 'TSVE') byId('empEsocialCategoryCode').value = '';
  }

  function employeeValuesFromForm() {
    const rawCpf = byId('empCpf').value;
    const rawCategory = byId('empEsocialCategoryCode').value;
    const fullName = byId('empName').value.trim(), unitId = byId('empUnit').value, sectorId = byId('empSector').value, jobRoleId = byId('empRole').value, shift = byId('empShift').value;
    const workerType = byId('empEsocialWorkerType').value || null;
    const cpf = digits(rawCpf), category = digits(rawCategory);
    const birthDate = byId('empBirthDate').value || null, startDate = byId('empRelationshipStartDate').value || null, endDate = byId('empRelationshipEndDate').value || null;
    const registration = byId('empEsocialRegistration').value.trim();
    if (!fullName || !unitId || !sectorId || !jobRoleId) throw new Error('Preencha nome, unidade, setor e função do colaborador.');
    if (rawCpf && !hasAllowedCpfInput(rawCpf)) throw new Error('O CPF deve conter apenas números e formatação permitida.');
    if (cpf && !isValidCpf(cpf)) throw new Error('Informe um CPF válido.');
    if (birthDate && birthDate > new Date().toISOString().slice(0, 10)) throw new Error('A data de nascimento não pode estar no futuro.');
    if (rawCategory && !hasAllowedNumericInput(rawCategory)) throw new Error('A categoria eSocial deve conter apenas números.');
    if (category && category.length !== 3) throw new Error('O código da categoria eSocial deve possuir 3 dígitos.');
    if (registration.length > 30) throw new Error('A matrícula eSocial deve possuir no máximo 30 caracteres.');
    if (startDate && endDate && endDate < startDate) throw new Error('A data final não pode ser anterior à data inicial.');
    return { full_name: fullName, unit_id: unitId, sector_id: sectorId, job_role_id: jobRoleId, shift, active: true, cpf: cpf || null, birth_date: birthDate, esocial_worker_type: workerType, esocial_registration: registration || null, esocial_category_code: category || null, relationship_start_date: startDate, relationship_end_date: endDate };
  }

  function resetEmployeeForm() {
    byId('employeeForm').reset(); editingEmployeeId = null;
    byId('employeeSubmitButton').textContent = 'Cadastrar Colaborador'; byId('employeeCancelEdit').hidden = true;
    updateEmployeeWorkerTypeFields();
  }

  async function submitEmployee(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await window.NexusData.runLocked(editingEmployeeId ? 'update-employee' : 'create-employee', async () => {
      try {
        const values = employeeValuesFromForm();
        await validateReference('units', values.unit_id); await validateReference('sectors', values.sector_id, [{ column: 'unit_id', value: values.unit_id }]); await validateReference('job_roles', values.job_role_id);
        if (editingEmployeeId) await window.NexusData.update({ ...entities.employees, id: editingEmployeeId, values });
        else await window.NexusData.insert({ ...entities.employees, values });
        resetEmployeeForm(); await loadAll();
      } catch (cause) {
        console.error('Falha ao salvar colaborador.', cause);
        if (cause?.code === '23505' || cause?.cause?.code === '23505') return message('Esta matrícula eSocial já está vinculada a outro contrato nesta empresa.');
        message(cause.message || 'Não foi possível salvar o colaborador.');
      }
    }, form.querySelector('[type="submit"]'));
  }

  function editEmployee(id) {
    const employee = state().employees.find(item => String(item.id) === String(id));
    if (!employee) return message('Colaborador não encontrado.');
    editingEmployeeId = employee.id;
    byId('empName').value = employee.name || ''; byId('empCpf').value = employee.cpf || ''; byId('empBirthDate').value = employee.birthDate || '';
    byId('empEsocialWorkerType').value = employee.esocialWorkerType || ''; byId('empEsocialRegistration').value = employee.esocialRegistration || ''; byId('empEsocialCategoryCode').value = employee.esocialCategoryCode || '';
    byId('empRelationshipStartDate').value = employee.relationshipStartDate || ''; byId('empRelationshipEndDate').value = employee.relationshipEndDate || '';
    byId('empUnit').value = employee.unitId || ''; app().render(); byId('empSector').value = employee.sectorId || ''; byId('empRole').value = employee.jobRoleId || ''; byId('empShift').value = employee.shift || '';
    byId('empCpf').dispatchEvent(new Event('input')); updateEmployeeWorkerTypeFields();
    byId('employeeSubmitButton').textContent = 'Salvar Alterações'; byId('employeeCancelEdit').hidden = false;
    byId('employeeForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      return `<li><span><strong>${esc(item.name)}</strong><small>Tipo: ${esc(item.establishmentKind)} | Inscrição: ${esc(registration)}${location ? ` | ${esc(location)}` : ''}</small><small>${esc(profileStatus)}</small></span><span><button type="button" class="ghost" data-organizational-action="edit-unit" data-organizational-id="${esc(item.id)}">Editar</button><button type="button" class="ghost" data-organizational-action="delete-unit" data-organizational-id="${esc(item.id)}">Excluir</button></span></li>`;
    }).join('') : '<li><span style="color:var(--text-muted)">Nenhuma unidade cadastrada.</span></li>';
    if (sectorList) sectorList.innerHTML = current.sectors.length ? current.sectors.map(item => `<li><span><strong>${esc(item.name)}</strong></span><small>${esc(unitName(item.unitId))}</small><button type="button" class="ghost" data-organizational-action="delete-sector" data-organizational-id="${esc(item.id)}">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhum setor cadastrado.</span></li>';
    if (roleList) roleList.innerHTML = current.jobRoles.length ? current.jobRoles.map(item => `<li><span><strong>${esc(item.name)}</strong></span><button type="button" class="ghost" data-organizational-action="delete-role" data-organizational-id="${esc(item.id)}">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhuma função cadastrada.</span></li>';
    if (employeeList) employeeList.innerHTML = current.employees.length ? current.employees.map(item => {
      const identity = item.cpf ? formatCpf(item.cpf) : 'CPF não informado';
      const worker = item.esocialWorkerType === 'VINCULO' ? 'Vínculo' : item.esocialWorkerType === 'TSVE' ? 'TSVE' : 'Não informado';
      const reference = item.esocialRegistration ? `Matrícula: ${item.esocialRegistration}` : item.esocialCategoryCode ? `Categoria: ${item.esocialCategoryCode}` : '';
      const allocation = `${unitName(item.unitId)} / ${current.sectors.find(sector => String(sector.id) === String(item.sectorId))?.name || 'Sem setor'} / ${item.role || 'Sem função'}`;
      const profileStatus = employeeProfileComplete(item) ? 'Cadastro completo' : 'Cadastro incompleto';
      return `<li><span><strong>${esc(item.name)}</strong><small>${esc(identity)} | ${esc(worker)}${reference ? ` | ${esc(reference)}` : ''}</small><small>${esc(allocation)} | ${esc(profileStatus)}</small></span><span><button type="button" class="ghost" data-organizational-action="show-employee" data-organizational-id="${esc(item.id)}">Visualizar</button><button type="button" class="ghost" data-organizational-action="edit-employee" data-organizational-id="${esc(item.id)}">Editar</button><button type="button" class="ghost" data-organizational-action="deactivate-employee" data-organizational-id="${esc(item.id)}">Desativar</button></span></li>`;
    }).join('') : '<li><span style="color:var(--text-muted)">Nenhum colaborador cadastrado.</span></li>';
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
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('[data-organizational-action]');
      if (!button) return;
      const id = button.dataset.organizationalId;
      const actions = {
        'edit-unit': () => editUnit(id),
        'delete-unit': () => deleteEntity('units', id),
        'delete-sector': () => deleteEntity('sectors', id),
        'delete-role': () => deleteEntity('jobRoles', id),
        'show-employee': () => window.showEmployeeRequirements?.(id),
        'edit-employee': () => editEmployee(id),
        'deactivate-employee': () => deactivateEmployee(id)
      };
      actions[button.dataset.organizationalAction]?.();
    });
    byId('unitForm').onsubmit = submitUnit;
    byId('unitCancelEdit').onclick = resetUnitForm;
    installUnitMasks();
    updateConditionalUnitFields();
    byId('sectorForm').onsubmit = submitSector;
    byId('jobRoleForm').onsubmit = submitRole;
    byId('employeeForm').onsubmit = submitEmployee;
    byId('employeeCancelEdit').onclick = resetEmployeeForm;
    byId('empCpf').addEventListener('input', event => { event.target.value = formatCpf(event.target.value); });
    byId('empEsocialCategoryCode').addEventListener('input', event => { if (hasAllowedNumericInput(event.target.value)) event.target.value = digits(event.target.value); });
    byId('empEsocialWorkerType').addEventListener('change', updateEmployeeWorkerTypeFields);
    updateEmployeeWorkerTypeFields();
    window.editUnit = editUnit;
    window.deleteUnit = id => deleteEntity('units', id);
    window.deleteSector = id => deleteEntity('sectors', id);
    window.deleteJobRole = id => deleteEntity('jobRoles', id);
    window.deactivateEmployee = deactivateEmployee;
    window.editEmployee = editEmployee;
    loadAll();
  }

  window.NexusOrganizational = { loadAll, renderManagedLists, isLegalProfileComplete, employeeProfileComplete };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
