(() => {
  'use strict';

  const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const MAX_ROWS = 1000;
  const HEADERS = [
    'Nome Completo',
    'CPF',
    'Data de Nascimento',
    'Tipo eSocial',
    'Matrícula eSocial',
    'Categoria eSocial',
    'Início do Vínculo',
    'Fim do Vínculo',
    'Unidade',
    'Setor',
    'Função',
    'Turno'
  ];

  let parsedRows = [];
  let installed = false;

  const byId = id => document.getElementById(id);
  const app = () => window.NEXUS_SST_APP;
  const state = () => app()?.getState?.();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const digits = value => String(value ?? '').replace(/\D/g, '');
  const normalize = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  function isValidCpf(value) {
    const cpf = digits(value);
    if (!cpf) return true;
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    const digit = length => {
      const sum = cpf.slice(0, length).split('').reduce((total, item, index) => total + Number(item) * (length + 1 - index), 0);
      const result = (sum * 10) % 11;
      return result === 10 ? 0 : result;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  }

  function isoDate(parts) {
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function normalizeDate(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return isoDate({ year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() }) || '';
    }
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) return isoDate({ year: parsed.y, month: parsed.m, day: parsed.d }) || '';
    }
    const text = String(value).trim();
    if (!text) return '';
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return isoDate({ year: match[1], month: match[2], day: match[3] });
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return isoDate({ year: match[3], month: match[2], day: match[1] });
    return null;
  }

  function normalizeWorkerType(value) {
    const normalized = normalize(value).replace(/[^a-z]/g, '');
    if (!normalized) return '';
    if (normalized === 'vinculo') return 'VINCULO';
    if (normalized === 'tsve') return 'TSVE';
    return null;
  }

  function buildIndex(items, key = 'name') {
    const map = new Map();
    (items || []).forEach(item => {
      const normalized = normalize(item?.[key]);
      if (!normalized) return;
      const current = map.get(normalized) || [];
      current.push(item);
      map.set(normalized, current);
    });
    return map;
  }

  function resolveUnique(index, name) {
    const matches = index.get(normalize(name)) || [];
    if (matches.length === 1) return { item: matches[0], error: '' };
    if (!matches.length) return { item: null, error: 'não cadastrado' };
    return { item: null, error: 'nome duplicado no Nexus' };
  }

  function headerKey(value) {
    const key = normalize(value).replace(/[^a-z0-9 ]/g, '');
    const aliases = {
      'nome': 'full_name',
      'nome completo': 'full_name',
      'colaborador': 'full_name',
      'funcionario': 'full_name',
      'cpf': 'cpf',
      'data nascimento': 'birth_date',
      'data de nascimento': 'birth_date',
      'nascimento': 'birth_date',
      'tipo esocial': 'esocial_worker_type',
      'tipo trabalhador esocial': 'esocial_worker_type',
      'matricula esocial': 'esocial_registration',
      'matricula': 'esocial_registration',
      'categoria esocial': 'esocial_category_code',
      'inicio do vinculo': 'relationship_start_date',
      'inicio vinculo': 'relationship_start_date',
      'admissao': 'relationship_start_date',
      'data admissao': 'relationship_start_date',
      'fim do vinculo': 'relationship_end_date',
      'fim vinculo': 'relationship_end_date',
      'desligamento': 'relationship_end_date',
      'data desligamento': 'relationship_end_date',
      'unidade': 'unit_name',
      'estabelecimento': 'unit_name',
      'setor': 'sector_name',
      'funcao': 'job_role_name',
      'cargo': 'job_role_name',
      'turno': 'shift'
    };
    return aliases[key] || '';
  }

  function remapRawRow(row) {
    const mapped = {};
    Object.entries(row || {}).forEach(([header, value]) => {
      const key = headerKey(header);
      if (key && mapped[key] === undefined) mapped[key] = value;
    });
    return mapped;
  }

  function validateRow(raw, rowNumber, indexes, seenRegistrations) {
    const data = remapRawRow(raw);
    const errors = [];
    const fullName = String(data.full_name ?? '').trim();
    const unitName = String(data.unit_name ?? '').trim();
    const sectorName = String(data.sector_name ?? '').trim();
    const roleName = String(data.job_role_name ?? '').trim();
    const shift = String(data.shift ?? '').trim();

    if (!fullName) errors.push('Nome Completo é obrigatório.');
    if (fullName.length > 160) errors.push('Nome Completo deve ter no máximo 160 caracteres.');
    if (!unitName) errors.push('Unidade é obrigatória.');
    if (!sectorName) errors.push('Setor é obrigatório.');
    if (!roleName) errors.push('Função é obrigatória.');
    if (shift.length > 80) errors.push('Turno deve ter no máximo 80 caracteres.');

    const unitResult = unitName ? resolveUnique(indexes.units, unitName) : { item: null };
    if (unitName && !unitResult.item) errors.push(`Unidade “${unitName}” ${unitResult.error}.`);

    let sector = null;
    if (sectorName && unitResult.item) {
      const candidates = (indexes.sectors.get(normalize(sectorName)) || []).filter(item => String(item.unitId) === String(unitResult.item.id));
      if (candidates.length === 1) sector = candidates[0];
      else if (!candidates.length) errors.push(`Setor “${sectorName}” não pertence à unidade “${unitName}”.`);
      else errors.push(`Setor “${sectorName}” está duplicado na unidade “${unitName}”.`);
    }

    const roleResult = roleName ? resolveUnique(indexes.roles, roleName) : { item: null };
    if (roleName && !roleResult.item) errors.push(`Função “${roleName}” ${roleResult.error}.`);

    const cpf = digits(data.cpf);
    if (cpf && !isValidCpf(cpf)) errors.push('CPF inválido.');

    const workerType = normalizeWorkerType(data.esocial_worker_type);
    if (data.esocial_worker_type && workerType === null) errors.push('Tipo eSocial deve ser VINCULO ou TSVE.');

    const registration = String(data.esocial_registration ?? '').trim();
    if (registration.length > 30) errors.push('Matrícula eSocial deve ter no máximo 30 caracteres.');
    if (registration) {
      const key = normalize(registration);
      if (seenRegistrations.has(key)) errors.push(`Matrícula eSocial repetida no arquivo (também na linha ${seenRegistrations.get(key)}).`);
      else seenRegistrations.set(key, rowNumber);
    }

    const category = digits(data.esocial_category_code);
    if (category && category.length !== 3) errors.push('Categoria eSocial deve possuir 3 dígitos.');
    if (category && workerType !== 'TSVE') errors.push('Categoria eSocial só pode ser usada para TSVE.');

    const birthDate = normalizeDate(data.birth_date);
    const startDate = normalizeDate(data.relationship_start_date);
    const endDate = normalizeDate(data.relationship_end_date);
    if (data.birth_date && birthDate === null) errors.push('Data de Nascimento inválida.');
    if (data.relationship_start_date && startDate === null) errors.push('Início do Vínculo inválido.');
    if (data.relationship_end_date && endDate === null) errors.push('Fim do Vínculo inválido.');

    const today = new Date().toISOString().slice(0, 10);
    if (birthDate && birthDate > today) errors.push('Data de Nascimento não pode estar no futuro.');
    if (startDate && endDate && endDate < startDate) errors.push('Fim do Vínculo não pode ser anterior ao início.');

    return {
      rowNumber,
      display: {
        fullName: fullName || '—',
        cpf: cpf || '—',
        unit: unitName || '—',
        sector: sectorName || '—',
        role: roleName || '—'
      },
      errors,
      payload: errors.length ? null : {
        full_name: fullName,
        cpf: cpf || null,
        birth_date: birthDate || null,
        esocial_worker_type: workerType || null,
        esocial_registration: registration || null,
        esocial_category_code: category || null,
        relationship_start_date: startDate || null,
        relationship_end_date: endDate || null,
        unit_id: unitResult.item.id,
        sector_id: sector.id,
        job_role_id: roleResult.item.id,
        shift: shift || null
      }
    };
  }

  async function ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-nexus-xlsx]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o leitor de Excel.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = XLSX_URL;
      script.async = true;
      script.dataset.nexusXlsx = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Não foi possível carregar o leitor de Excel. Verifique sua conexão e tente novamente.'));
      document.head.appendChild(script);
    });
    if (!window.XLSX) throw new Error('Leitor de Excel indisponível.');
    return window.XLSX;
  }

  function downloadTemplate() {
    return ensureXlsx().then(XLSX => {
      const workbook = XLSX.utils.book_new();
      const instructions = [
        ['MODELO DE IMPORTAÇÃO DE COLABORADORES — NEXUS SST'],
        ['Preencha somente a aba “Colaboradores”. Não altere os nomes das colunas.'],
        ['Unidade, Setor e Função precisam estar cadastrados previamente no Nexus e devem ser escritos com o mesmo nome.'],
        ['Campos obrigatórios: Nome Completo, Unidade, Setor e Função.'],
        ['Datas aceitas: DD/MM/AAAA ou AAAA-MM-DD.'],
        ['Tipo eSocial: VINCULO ou TSVE. Categoria eSocial é usada somente para TSVE.'],
        [`Máximo de ${MAX_ROWS} colaboradores por arquivo. O limite comercial contratado também será respeitado.`],
        ['Antes de gravar, o Nexus mostrará uma pré-visualização e bloqueará a importação se houver qualquer erro.']
      ];
      const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
      instructionSheet['!cols'] = [{ wch: 110 }];
      const employeeSheet = XLSX.utils.aoa_to_sheet([HEADERS]);
      employeeSheet['!cols'] = [
        { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 18 },
        { wch: 18 }, { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 16 }
      ];
      const exampleSheet = XLSX.utils.aoa_to_sheet([
        HEADERS,
        ['João da Silva', '12345678909', '15/05/1990', 'VINCULO', 'MAT-001', '', '01/08/2026', '', 'Matriz', 'Produção', 'Operador', '1º Turno'],
        ['Maria de Souza', '', '', 'TSVE', '', '701', '01/08/2026', '', 'Matriz', 'Administrativo', 'Prestador', 'Comercial']
      ]);
      exampleSheet['!cols'] = employeeSheet['!cols'];
      XLSX.utils.book_append_sheet(workbook, instructionSheet, 'Instruções');
      XLSX.utils.book_append_sheet(workbook, employeeSheet, 'Colaboradores');
      XLSX.utils.book_append_sheet(workbook, exampleSheet, 'Exemplo');
      XLSX.writeFile(workbook, 'Modelo_Importacao_Colaboradores_Nexus_SST.xlsx');
    });
  }

  function injectStyles() {
    if (document.querySelector('style[data-nexus-employee-import]')) return;
    const style = document.createElement('style');
    style.dataset.nexusEmployeeImport = 'true';
    style.textContent = `
      .nexus-import-card{border-color:rgba(224,184,74,.28)!important;background:linear-gradient(135deg,rgba(224,184,74,.055),var(--surface))!important}
      .nexus-import-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.nexus-import-head h3{margin:0 0 6px;font-size:14px}.nexus-import-head p{margin:0;color:var(--text-muted);font-size:12px;line-height:1.55}.nexus-import-actions{display:flex;gap:8px;flex-wrap:wrap}.nexus-import-actions button{white-space:nowrap}
      .nexus-import-status{margin-top:13px;padding:11px 12px;border:1px solid var(--border);border-radius:9px;color:var(--text-muted);font-size:12px;line-height:1.5}.nexus-import-status.good{border-color:rgba(114,168,117,.35);color:#9ec5a0}.nexus-import-status.bad{border-color:rgba(220,108,103,.38);color:#ef9691}.nexus-import-status.warn{border-color:rgba(224,184,74,.35);color:#dfc879}
      .nexus-import-preview{margin-top:14px}.nexus-import-summary{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.nexus-import-pill{padding:6px 9px;border:1px solid var(--border);border-radius:999px;color:var(--text-muted);font-size:11px}.nexus-import-pill b{color:var(--text)}.nexus-import-pill.bad{border-color:rgba(220,108,103,.4);color:#ef9691}
      .nexus-import-table-wrap{max-height:360px;overflow:auto;border:1px solid var(--border);border-radius:9px}.nexus-import-table{width:100%;border-collapse:collapse;min-width:900px}.nexus-import-table th,.nexus-import-table td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;font-size:11px;vertical-align:top}.nexus-import-table th{position:sticky;top:0;background:var(--surface-subtle);z-index:1;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.nexus-import-table tr:last-child td{border-bottom:0}.nexus-import-error{color:#ef9691;line-height:1.4}.nexus-import-ok{color:#91c094;font-weight:700}.nexus-import-confirm{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.nexus-import-confirm button:disabled{opacity:.5;cursor:not-allowed}
      @media(max-width:760px){.nexus-import-head{flex-direction:column}.nexus-import-actions{width:100%}.nexus-import-actions button{flex:1}.nexus-import-confirm{flex-direction:column}.nexus-import-confirm button{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function setStatus(text, type = '') {
    const element = byId('nexusEmployeeImportStatus');
    if (!element) return;
    element.className = `nexus-import-status${type ? ` ${type}` : ''}`;
    element.textContent = text;
    element.hidden = !text;
  }

  function renderPreview() {
    const preview = byId('nexusEmployeeImportPreview');
    const tbody = byId('nexusEmployeeImportRows');
    if (!preview || !tbody) return;
    if (!parsedRows.length) {
      preview.hidden = true;
      return;
    }
    const valid = parsedRows.filter(row => !row.errors.length).length;
    const invalid = parsedRows.length - valid;
    byId('nexusEmployeeImportTotal').textContent = parsedRows.length;
    byId('nexusEmployeeImportValid').textContent = valid;
    byId('nexusEmployeeImportInvalid').textContent = invalid;
    tbody.innerHTML = parsedRows.map(row => `<tr><td>${row.rowNumber}</td><td><strong>${esc(row.display.fullName)}</strong></td><td>${esc(row.display.cpf)}</td><td>${esc(row.display.unit)}</td><td>${esc(row.display.sector)}</td><td>${esc(row.display.role)}</td><td>${row.errors.length ? `<div class="nexus-import-error">${row.errors.map(esc).join('<br>')}</div>` : '<span class="nexus-import-ok">Pronto para importar</span>'}</td></tr>`).join('');
    const confirm = byId('nexusEmployeeImportConfirm');
    confirm.disabled = invalid > 0 || valid === 0;
    preview.hidden = false;
    if (invalid) setStatus(`O arquivo possui ${invalid} linha(s) com erro. Corrija o Excel e selecione o arquivo novamente; nenhuma linha será importada enquanto houver erro.`, 'bad');
    else setStatus(`${valid} colaborador(es) validados. Revise a prévia e confirme para gravar no Nexus.`, 'good');
  }

  async function parseFile(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('O arquivo deve ter no máximo 8 MB.');
    const XLSX = await ensureXlsx();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames.find(name => normalize(name) === 'colaboradores') || workbook.SheetNames[0];
    if (!sheetName) throw new Error('O arquivo não possui nenhuma planilha.');
    const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true });
    if (!rawRows.length) throw new Error('A planilha não possui colaboradores preenchidos.');
    if (rawRows.length > MAX_ROWS) throw new Error(`O arquivo possui ${rawRows.length} linhas. O máximo por importação é ${MAX_ROWS}.`);

    const keys = new Set(Object.keys(rawRows[0]).map(headerKey).filter(Boolean));
    const missing = [
      ['full_name', 'Nome Completo'],
      ['unit_name', 'Unidade'],
      ['sector_name', 'Setor'],
      ['job_role_name', 'Função']
    ].filter(([key]) => !keys.has(key)).map(([, label]) => label);
    if (missing.length) throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}. Use o modelo fornecido pelo Nexus.`);

    const current = state();
    if (!current) throw new Error('Os cadastros do Nexus ainda não foram carregados. Aguarde alguns segundos e tente novamente.');
    const indexes = {
      units: buildIndex(current.units),
      sectors: buildIndex(current.sectors),
      roles: buildIndex(current.jobRoles)
    };
    const seenRegistrations = new Map();
    parsedRows = rawRows.map((row, index) => validateRow(row, index + 2, indexes, seenRegistrations));
    renderPreview();
  }

  async function importRows() {
    const validRows = parsedRows.filter(row => !row.errors.length && row.payload);
    if (!validRows.length || validRows.length !== parsedRows.length) return;
    const button = byId('nexusEmployeeImportConfirm');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Importando...';
    try {
      const { data, error } = await window.NexusAuth.getClient().rpc('import_employees_bulk', {
        p_rows: validRows.map(row => row.payload)
      });
      if (error) throw error;
      const imported = Number(data?.imported ?? validRows.length);
      setStatus(`${imported} colaborador(es) importados com sucesso.`, 'good');
      parsedRows = [];
      byId('nexusEmployeeImportPreview').hidden = true;
      byId('nexusEmployeeImportFile').value = '';
      await window.NexusOrganizational?.loadAll?.();
    } catch (error) {
      console.error('[Nexus importação colaboradores]', error);
      setStatus(error?.message || 'Não foi possível importar os colaboradores.', 'bad');
      button.disabled = false;
    } finally {
      button.textContent = original;
    }
  }

  function buildPanel() {
    const tab = byId('reg-colaboradores');
    if (!tab || byId('nexusEmployeeImportCard')) return;
    injectStyles();
    const panel = document.createElement('div');
    panel.id = 'nexusEmployeeImportCard';
    panel.className = 'card-box nexus-import-card';
    panel.innerHTML = `
      <div class="nexus-import-head">
        <div><h3>Importação de colaboradores por Excel</h3><p>Use o modelo do Nexus, valide todas as linhas antes de gravar e importe até ${MAX_ROWS} colaboradores por lote. Unidade, setor e função devem existir previamente nesta empresa.</p></div>
        <div class="nexus-import-actions">
          <button id="nexusEmployeeTemplate" type="button" class="ghost">Baixar modelo Excel</button>
          <button id="nexusEmployeeChooseFile" type="button">Selecionar arquivo</button>
          <input id="nexusEmployeeImportFile" type="file" accept=".xlsx,.xls,.csv" hidden>
        </div>
      </div>
      <div id="nexusEmployeeImportStatus" class="nexus-import-status" hidden></div>
      <div id="nexusEmployeeImportPreview" class="nexus-import-preview" hidden>
        <div class="nexus-import-summary">
          <span class="nexus-import-pill">Linhas <b id="nexusEmployeeImportTotal">0</b></span>
          <span class="nexus-import-pill">Válidas <b id="nexusEmployeeImportValid">0</b></span>
          <span class="nexus-import-pill bad">Com erro <b id="nexusEmployeeImportInvalid">0</b></span>
        </div>
        <div class="nexus-import-table-wrap"><table class="nexus-import-table"><thead><tr><th>Linha</th><th>Colaborador</th><th>CPF</th><th>Unidade</th><th>Setor</th><th>Função</th><th>Validação</th></tr></thead><tbody id="nexusEmployeeImportRows"></tbody></table></div>
        <div class="nexus-import-confirm"><button id="nexusEmployeeImportCancel" type="button" class="ghost">Cancelar prévia</button><button id="nexusEmployeeImportConfirm" type="button" disabled>Confirmar importação</button></div>
      </div>`;
    tab.insertBefore(panel, tab.firstElementChild);

    byId('nexusEmployeeTemplate').onclick = async () => {
      const button = byId('nexusEmployeeTemplate');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Gerando modelo...';
      try { await downloadTemplate(); setStatus('Modelo Excel gerado. Preencha a aba “Colaboradores” e depois selecione o arquivo.', 'good'); }
      catch (error) { setStatus(error.message || 'Não foi possível gerar o modelo Excel.', 'bad'); }
      finally { button.disabled = false; button.textContent = original; }
    };
    byId('nexusEmployeeChooseFile').onclick = () => byId('nexusEmployeeImportFile').click();
    byId('nexusEmployeeImportFile').onchange = async event => {
      parsedRows = [];
      byId('nexusEmployeeImportPreview').hidden = true;
      const file = event.target.files?.[0];
      if (!file) return;
      setStatus(`Lendo ${file.name}...`, 'warn');
      try { await parseFile(file); }
      catch (error) { console.error('[Nexus leitura Excel]', error); setStatus(error.message || 'Não foi possível ler o arquivo.', 'bad'); }
    };
    byId('nexusEmployeeImportCancel').onclick = () => {
      parsedRows = [];
      byId('nexusEmployeeImportPreview').hidden = true;
      byId('nexusEmployeeImportFile').value = '';
      setStatus('', '');
    };
    byId('nexusEmployeeImportConfirm').onclick = importRows;
  }

  function install() {
    if (installed) return;
    if (!byId('employeeForm') || !window.NexusAuth || !window.NexusOrganizational) {
      setTimeout(install, 80);
      return;
    }
    installed = true;
    buildPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
