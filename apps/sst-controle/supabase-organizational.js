(() => {
  'use strict';

  const entities = {
    units: { table: 'units', select: 'id, name', label: 'a unidade', order: { column: 'name' } },
    sectors: { table: 'sectors', select: 'id, unit_id, name', label: 'o setor', order: { column: 'name' } },
    jobRoles: { table: 'job_roles', select: 'id, name', label: 'a função', order: { column: 'name' } },
    employees: { table: 'employees', select: 'id, unit_id, sector_id, job_role_id, full_name, shift, active, job_roles ( name )', label: 'o colaborador', order: { column: 'full_name' } }
  };
  let installed = false;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const message = text => window.alert(text);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app().getState();

  function mapUnit(row) { return { id: row.id, name: row.name }; }
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
      const [units, sectors, jobRoles, employees] = await Promise.all([
        window.NexusData.list(entities.units),
        window.NexusData.list(entities.sectors),
        window.NexusData.list(entities.jobRoles),
        window.NexusData.list({ ...entities.employees, filters: [{ column: 'active', value: true }] })
      ]);
      Object.assign(state(), { units: units.map(mapUnit), sectors: sectors.map(mapSector), jobRoles: jobRoles.map(mapRole), employees: employees.map(mapEmployee) });
      app().render();
    } catch (cause) {
      console.error('Falha ao carregar a estrutura organizacional.', cause);
      message('Não foi possível carregar a estrutura organizacional do Supabase.');
    }
  }

  async function validateReference(table, id, extraFilters = []) {
    if (!id || !await window.NexusData.exists({ table, filters: [{ column: 'id', value: id }, ...extraFilters] })) {
      throw new Error('O registro selecionado não pertence à organização autenticada.');
    }
  }

  async function submitUnit(event) {
    event.preventDefault();
    const form = event.currentTarget, name = byId('unitName').value.trim();
    if (!name) return message('Informe o nome da unidade.');
    await window.NexusData.runLocked('create-unit', async () => {
      try { await window.NexusData.insert({ ...entities.units, values: { name } }); form.reset(); await loadAll(); }
      catch (cause) { console.error('Falha ao cadastrar unidade.', cause); message('Não foi possível cadastrar a unidade.'); }
    }, form.querySelector('[type="submit"]'));
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

  async function linkCounts(configs) {
    const totals = await Promise.all(configs.map(config => window.NexusData.count(config)));
    return totals;
  }

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
    if (unitList) unitList.innerHTML = current.units.length ? current.units.map(item => `<li><span><strong>${esc(item.name)}</strong></span><button type="button" class="ghost" onclick="deleteUnit('${esc(item.id)}')">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhuma unidade cadastrada.</span></li>';
    if (sectorList) sectorList.innerHTML = current.sectors.length ? current.sectors.map(item => `<li><span><strong>${esc(item.name)}</strong></span><small>${esc(unitName(item.unitId))}</small><button type="button" class="ghost" onclick="deleteSector('${esc(item.id)}')">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhum setor cadastrado.</span></li>';
    if (roleList) roleList.innerHTML = current.jobRoles.length ? current.jobRoles.map(item => `<li><span><strong>${esc(item.name)}</strong></span><button type="button" class="ghost" onclick="deleteJobRole('${esc(item.id)}')">Excluir</button></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhuma função cadastrada.</span></li>';
    if (employeeList) employeeList.innerHTML = current.employees.length ? current.employees.map(item => `<li><span><strong>${esc(item.name)}</strong> — ${esc(item.role)} (${esc(item.shift || 'Turno não informado')})<small style="display:block;margin-top:4px">${esc(unitName(item.unitId))}</small></span><span><button type="button" class="ghost" onclick="showEmployeeRequirements('${esc(item.id)}')">Ver requisitos</button><button type="button" class="ghost" onclick="deactivateEmployee('${esc(item.id)}')">Desativar</button></span></li>`).join('') : '<li><span style="color:var(--text-muted)">Nenhum colaborador ativo cadastrado.</span></li>';
  }

  function wrapRender() {
    const original = app().render;
    app().render = () => { original(); renderManagedLists(); };
  }

  function install() {
    if (installed || !app()?.getState || !app()?.render || !window.NexusData) return;
    installed = true;
    wrapRender();
    byId('unitForm').onsubmit = submitUnit;
    byId('sectorForm').onsubmit = submitSector;
    byId('jobRoleForm').onsubmit = submitRole;
    byId('employeeForm').onsubmit = submitEmployee;
    window.deleteUnit = id => deleteEntity('units', id);
    window.deleteSector = id => deleteEntity('sectors', id);
    window.deleteJobRole = id => deleteEntity('jobRoles', id);
    window.deactivateEmployee = deactivateEmployee;
    loadAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
