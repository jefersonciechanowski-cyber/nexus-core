(() => {
  'use strict';

  const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const MAX_ROWS = 1000;
  const HEADERS = ['CPF', 'Exame', 'Nº Coleta', 'Data da Coleta', 'Resultado Numérico', 'Resultado Qualitativo'];
  let parsedRows = [];
  let installed = false;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[ch]));
  const digits = value => String(value ?? '').replace(/\D/g, '');
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

  function getClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Cliente autenticado do Supabase não está disponível.');
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); } catch { throw new Error('Sessão autenticada inválida.'); }
    const id = String(session?.organizationId || '').trim();
    if (!id) throw new Error('Organização autenticada não foi identificada.');
    return id;
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

  function isoDate(parts) {
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function normalizeDate(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate({year:value.getFullYear(),month:value.getMonth()+1,day:value.getDate()});
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) return isoDate({year:parsed.y,month:parsed.m,day:parsed.d});
    }
    const text = String(value).trim();
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return isoDate({year:match[1],month:match[2],day:match[3]});
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return isoDate({year:match[3],month:match[2],day:match[1]});
    return null;
  }

  function numericValue(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const text = String(value).trim().replace(/\s/g,'').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : NaN;
  }

  function headerKey(value) {
    const key = normalize(value).replace(/[^a-z0-9 ]/g, '');
    const aliases = {
      'cpf':'cpf',
      'cpf colaborador':'cpf',
      'exame':'exam_name',
      'nome do exame':'exam_name',
      'n coleta':'collection_number',
      'numero coleta':'collection_number',
      'numero da coleta':'collection_number',
      'coleta':'collection_number',
      'data da coleta':'collected_at',
      'data coleta':'collected_at',
      'data':'collected_at',
      'resultado numerico':'numeric_value',
      'valor':'numeric_value',
      'resultado':'numeric_value',
      'resultado qualitativo':'qualitative_result',
      'qualitativo':'qualitative_result'
    };
    return aliases[key] || '';
  }

  function remapRawRow(row) {
    const mapped = {};
    Object.entries(row || {}).forEach(([header,value]) => {
      const key = headerKey(header);
      if (key && mapped[key] === undefined) mapped[key] = value;
    });
    return mapped;
  }

  async function ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve,reject) => {
      const existing = document.querySelector('script[data-nexus-xlsx]');
      if (existing) {
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(new Error('Não foi possível carregar o leitor de Excel.')),{once:true});
        return;
      }
      const script = document.createElement('script');
      script.src = XLSX_URL;
      script.async = true;
      script.dataset.nexusXlsx = 'true';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Não foi possível carregar o leitor de Excel. Verifique sua conexão.'));
      document.head.appendChild(script);
    });
    if (!window.XLSX) throw new Error('Leitor de Excel indisponível.');
    return window.XLSX;
  }

  async function fetchAll(table, select, filters = []) {
    const client = getClient();
    const rows = [];
    let from = 0;
    const size = 1000;
    while (true) {
      let query = client.from(table).select(select).range(from, from + size - 1);
      filters.forEach(filter => { query = query.eq(filter.column, filter.value); });
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < size) break;
      from += size;
    }
    return rows;
  }

  function normalizeExam(row) {
    const rule = Array.isArray(row.exam_evaluation_rules) ? row.exam_evaluation_rules[0] : row.exam_evaluation_rules;
    return {
      id: row.id,
      name: row.name,
      resultType: row.result_type,
      qualitativeOptions: Array.isArray(row.qualitative_options) ? row.qualitative_options : [],
      evaluation: {
        mode: rule?.evaluation_mode || 'NONE',
        goodMin: rule?.good_min,
        goodMax: rule?.good_max,
        attentionMin: rule?.attention_min,
        attentionMax: rule?.attention_max
      }
    };
  }

  function classifyNumeric(exam, value) {
    const rule = exam?.evaluation;
    if (!rule || rule.mode === 'NONE' || !Number.isFinite(value)) return 'SEM PARÂMETRO';
    if (rule.mode === 'LOWER_IS_BETTER') {
      if (rule.goodMax == null || rule.attentionMax == null) return 'SEM PARÂMETRO';
      return value <= rule.goodMax ? 'BOM' : value <= rule.attentionMax ? 'ATENÇÃO' : 'CRÍTICO';
    }
    if (rule.mode === 'HIGHER_IS_BETTER') {
      if (rule.goodMin == null || rule.attentionMin == null) return 'SEM PARÂMETRO';
      return value >= rule.goodMin ? 'BOM' : value >= rule.attentionMin ? 'ATENÇÃO' : 'CRÍTICO';
    }
    if ([rule.goodMin,rule.goodMax,rule.attentionMin,rule.attentionMax].some(value => value == null)) return 'SEM PARÂMETRO';
    return value >= rule.goodMin && value <= rule.goodMax ? 'BOM' : value >= rule.attentionMin && value <= rule.attentionMax ? 'ATENÇÃO' : 'CRÍTICO';
  }

  async function loadReferences() {
    const organizationId = getOrganizationId();
    const [employees, examsRaw, requirements] = await Promise.all([
      fetchAll('employees','id,full_name,cpf,sector_id,active',[{column:'organization_id',value:organizationId}]),
      fetchAll('exam_catalog','id,name,result_type,qualitative_options,active,exam_evaluation_rules(evaluation_mode,good_min,good_max,attention_min,attention_max)',[{column:'organization_id',value:organizationId},{column:'active',value:true}]),
      fetchAll('sector_exam_requirements','sector_id,exam_id,active',[{column:'organization_id',value:organizationId},{column:'active',value:true}])
    ]);
    const employeeByCpf = new Map();
    employees.forEach(employee => {
      if (!employee.cpf) return;
      const cpf = digits(employee.cpf);
      const current = employeeByCpf.get(cpf) || [];
      current.push(employee);
      employeeByCpf.set(cpf,current);
    });
    const examByName = new Map();
    examsRaw.map(normalizeExam).forEach(exam => {
      const key = normalize(exam.name);
      const current = examByName.get(key) || [];
      current.push(exam);
      examByName.set(key,current);
    });
    const requirementSet = new Set(requirements.map(item => `${item.sector_id}|${item.exam_id}`));
    return { employeeByCpf, examByName, requirementSet };
  }

  function validateRows(rawRows, refs) {
    const today = new Date().toISOString().slice(0,10);
    const seenKeys = new Map();
    return rawRows.map((raw,index) => {
      const rowNumber = index + 2;
      const data = remapRawRow(raw);
      const errors = [];
      const cpf = digits(data.cpf);
      const examName = String(data.exam_name ?? '').trim();
      const collectionNumber = Number(String(data.collection_number ?? '').trim());
      const collectedAt = normalizeDate(data.collected_at);
      const numeric = numericValue(data.numeric_value);
      const qualitativeRaw = String(data.qualitative_result ?? '').trim();
      let employee = null;
      let exam = null;
      let qualitativeResult = qualitativeRaw;
      let previewStatus = '';
      let needsRegistration = false;

      if (!cpf || !isValidCpf(cpf)) errors.push('CPF obrigatório e válido.');
      else {
        const matches = refs.employeeByCpf.get(cpf) || [];
        if (!matches.length) {
          needsRegistration = true;
          errors.push('CPF não cadastrado. Cadastre o colaborador no SST Controle antes de importar.');
        } else if (matches.length > 1) errors.push('CPF duplicado na empresa. Corrija os cadastros antes de importar.');
        else employee = matches[0];
      }

      if (!examName) errors.push('Exame é obrigatório.');
      else {
        const matches = refs.examByName.get(normalize(examName)) || [];
        if (!matches.length) errors.push(`Exame “${examName}” não cadastrado ou inativo.`);
        else if (matches.length > 1) errors.push(`Exame “${examName}” duplicado no catálogo.`);
        else exam = matches[0];
      }

      if (!Number.isInteger(collectionNumber) || collectionNumber < 1) errors.push('Nº Coleta deve ser inteiro maior ou igual a 1.');
      if (data.collected_at === undefined || data.collected_at === null || data.collected_at === '') errors.push('Data da Coleta é obrigatória.');
      else if (!collectedAt) errors.push('Data da Coleta inválida.');
      else if (collectedAt > today) errors.push('Data da Coleta não pode estar no futuro.');

      if (employee && !employee.sector_id) errors.push('Colaborador sem setor. Atualize o cadastro antes de importar.');
      if (employee?.sector_id && exam && !refs.requirementSet.has(`${employee.sector_id}|${exam.id}`)) errors.push('Exame não está vinculado ao setor atual do colaborador.');

      if (exam?.resultType === 'NUMERIC') {
        if (qualitativeRaw) errors.push('Exame numérico não aceita Resultado Qualitativo.');
        if (numeric === null) errors.push('Resultado Numérico é obrigatório para este exame.');
        else if (!Number.isFinite(numeric)) errors.push('Resultado Numérico inválido.');
        else previewStatus = classifyNumeric(exam,numeric);
      } else if (exam?.resultType === 'QUALITATIVE') {
        if (numeric !== null) errors.push('Exame qualitativo não aceita Resultado Numérico.');
        if (!qualitativeRaw) errors.push('Resultado Qualitativo é obrigatório para este exame.');
        else {
          const options = (exam.qualitativeOptions || []).filter(option => normalize(option?.label) === normalize(qualitativeRaw));
          if (options.length !== 1) errors.push(`Resultado qualitativo inválido. Use uma opção configurada para “${exam.name}”.`);
          else {
            qualitativeResult = String(options[0].label);
            previewStatus = String(options[0].status || 'SEM PARÂMETRO');
          }
        }
      }

      if (employee && exam && collectedAt && Number.isInteger(collectionNumber) && collectionNumber > 0) {
        const key = `${employee.id}|${exam.id}|${collectedAt.slice(0,4)}|${collectionNumber}`;
        if (seenKeys.has(key)) errors.push(`Coleta duplicada no arquivo (também na linha ${seenKeys.get(key)}).`);
        else seenKeys.set(key,rowNumber);
      }

      return {
        rowNumber,
        cpf,
        employeeName: employee?.full_name || 'Não cadastrado',
        examName: exam?.name || examName || '—',
        collectionNumber: Number.isInteger(collectionNumber) ? collectionNumber : '—',
        collectedAt: collectedAt || '—',
        result: exam?.resultType === 'QUALITATIVE' ? (qualitativeResult || '—') : (Number.isFinite(numeric) ? String(numeric) : '—'),
        previewStatus,
        needsRegistration,
        errors,
        payload: errors.length ? null : {
          cpf,
          exam_name: exam.name,
          collection_number: String(collectionNumber),
          collected_at: collectedAt,
          numeric_value: exam.resultType === 'NUMERIC' ? String(numeric) : null,
          qualitative_result: exam.resultType === 'QUALITATIVE' ? qualitativeResult : null
        }
      };
    });
  }

  function downloadTemplate() {
    return ensureXlsx().then(XLSX => {
      const workbook = XLSX.utils.book_new();
      const instructions = [
        ['MODELO DE IMPORTAÇÃO DE COLETAS — NEXUS SST'],
        ['Preencha somente a aba “Coletas”. Não altere os nomes das colunas.'],
        ['O CPF é obrigatório e deve pertencer a um colaborador já cadastrado na empresa selecionada.'],
        ['Se o CPF não existir, o Nexus mostrará a pendência para cadastrar o colaborador e bloqueará o lote.'],
        ['O nome do exame deve existir no catálogo e estar vinculado ao setor atual do colaborador.'],
        ['Para exame NUMÉRICO, preencha somente Resultado Numérico.'],
        ['Para exame QUALITATIVO, preencha somente Resultado Qualitativo usando exatamente uma opção configurada no Nexus.'],
        ['Datas aceitas: DD/MM/AAAA ou AAAA-MM-DD.'],
        [`Máximo de ${MAX_ROWS} coletas por arquivo.`],
        ['Antes de gravar, o Nexus valida todas as linhas. Havendo qualquer erro, nenhuma coleta é importada.']
      ];
      const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
      instructionSheet['!cols'] = [{wch:115}];
      const collectionSheet = XLSX.utils.aoa_to_sheet([HEADERS]);
      collectionSheet['!cols'] = [{wch:16},{wch:28},{wch:13},{wch:18},{wch:20},{wch:24}];
      const exampleSheet = XLSX.utils.aoa_to_sheet([
        HEADERS,
        ['12345678909','Audiometria',1,'12/08/2026','85',''],
        ['12345678909','Avaliação Qualitativa',1,'12/08/2026','','Normal']
      ]);
      exampleSheet['!cols'] = collectionSheet['!cols'];
      XLSX.utils.book_append_sheet(workbook,instructionSheet,'Instruções');
      XLSX.utils.book_append_sheet(workbook,collectionSheet,'Coletas');
      XLSX.utils.book_append_sheet(workbook,exampleSheet,'Exemplo');
      XLSX.writeFile(workbook,'Modelo_Importacao_Coletas_Nexus_SST.xlsx');
    });
  }

  function injectStyles() {
    if (document.querySelector('style[data-nexus-collection-import]')) return;
    const style = document.createElement('style');
    style.dataset.nexusCollectionImport = 'true';
    style.textContent = `
      .nexus-collection-import{border-color:rgba(224,184,74,.28)!important;background:linear-gradient(135deg,rgba(224,184,74,.055),var(--surface))!important;margin-bottom:18px}
      .nexus-ci-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.nexus-ci-head h3{margin:0 0 6px;font-size:14px}.nexus-ci-head p{margin:0;color:var(--text-muted);font-size:12px;line-height:1.55}.nexus-ci-actions{display:flex;gap:8px;flex-wrap:wrap}.nexus-ci-actions button{white-space:nowrap}
      .nexus-ci-status{margin-top:13px;padding:11px 12px;border:1px solid var(--border);border-radius:8px;color:var(--text-muted);font-size:12px}.nexus-ci-status.good{border-color:rgba(114,168,117,.45);color:#8fd394}.nexus-ci-status.bad{border-color:rgba(220,108,103,.5);color:#ff817a}
      .nexus-ci-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.nexus-ci-pill{padding:5px 9px;border:1px solid var(--border);border-radius:99px;font-size:11px}.nexus-ci-pill.bad{border-color:rgba(220,108,103,.45);color:#ff817a}.nexus-ci-pill.good{border-color:rgba(114,168,117,.45);color:#8fd394}
      .nexus-ci-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:9px}.nexus-ci-table{width:100%;border-collapse:collapse;min-width:980px;font-size:11px}.nexus-ci-table th,.nexus-ci-table td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.nexus-ci-table th{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.nexus-ci-error{color:#ff817a}.nexus-ci-ready{color:#8fd394}.nexus-ci-register{padding:5px 8px!important;font-size:10px!important;margin-top:5px}
      .nexus-ci-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
      @media(max-width:760px){.nexus-ci-head{flex-direction:column}.nexus-ci-actions{width:100%}.nexus-ci-actions button{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function setStatus(text,type='') {
    const status = byId('nexusCollectionImportStatus');
    if (!status) return;
    status.textContent = text;
    status.className = `nexus-ci-status ${type}`.trim();
  }

  function renderPreview() {
    const wrap = byId('nexusCollectionImportPreview');
    if (!wrap) return;
    if (!parsedRows.length) { wrap.innerHTML=''; return; }
    const valid = parsedRows.filter(row => !row.errors.length).length;
    const invalid = parsedRows.length - valid;
    const pending = parsedRows.filter(row => row.needsRegistration).length;
    const rows = parsedRows.map(row => `<tr><td>${row.rowNumber}</td><td>${esc(row.cpf || '—')}<br><small>${esc(row.employeeName)}</small>${row.needsRegistration ? `<br><button type="button" class="ghost nexus-ci-register" data-register-cpf="${esc(row.cpf)}">Cadastrar colaborador</button>` : ''}</td><td>${esc(row.examName)}</td><td>${esc(row.collectionNumber)}</td><td>${esc(row.collectedAt)}</td><td>${esc(row.result)}${row.previewStatus ? `<br><small>${esc(row.previewStatus)}</small>` : ''}</td><td>${row.errors.length ? `<span class="nexus-ci-error">${row.errors.map(esc).join('<br>')}</span>` : '<span class="nexus-ci-ready">Pronto para importar</span>'}</td></tr>`).join('');
    wrap.innerHTML = `<div class="nexus-ci-summary"><span class="nexus-ci-pill">Linhas <b>${parsedRows.length}</b></span><span class="nexus-ci-pill good">Válidas <b>${valid}</b></span><span class="nexus-ci-pill bad">Com erro <b>${invalid}</b></span>${pending ? `<span class="nexus-ci-pill bad">Cadastros pendentes <b>${pending}</b></span>` : ''}</div><div class="nexus-ci-table-wrap"><table class="nexus-ci-table"><thead><tr><th>Linha</th><th>CPF / Colaborador</th><th>Exame</th><th>Coleta</th><th>Data</th><th>Resultado</th><th>Validação</th></tr></thead><tbody>${rows}</tbody></table></div><div class="nexus-ci-footer"><button type="button" class="ghost" id="nexusCollectionCancelPreview">Cancelar prévia</button><button type="button" id="nexusCollectionConfirm" ${invalid ? 'disabled' : ''}>Confirmar importação</button></div>`;
    wrap.querySelectorAll('[data-register-cpf]').forEach(button => button.onclick = () => openEmployeeRegistration(button.dataset.registerCpf));
    byId('nexusCollectionCancelPreview').onclick = clearPreview;
    byId('nexusCollectionConfirm').onclick = confirmImport;
  }

  function openEmployeeRegistration(cpf) {
    const cadastros = [...document.querySelectorAll('button.tab')].find(button => normalize(button.textContent) === 'cadastros');
    cadastros?.click();
    const colaboradores = document.querySelector('[data-subtab="reg-colaboradores"]');
    colaboradores?.click();
    const input = byId('empCpf');
    if (input) {
      input.value = cpf;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(()=>input.focus(),250);
    }
  }

  function clearPreview() {
    parsedRows = [];
    renderPreview();
    const input = byId('nexusCollectionFile');
    if (input) input.value = '';
    setStatus('Use o modelo do Nexus para validar as coletas antes de gravar.');
  }

  async function parseFile(file) {
    try {
      setStatus('Lendo arquivo e validando CPFs, exames e vínculos…');
      const XLSX = await ensureXlsx();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data,{type:'array',cellDates:true});
      const sheet = workbook.Sheets['Coletas'] || workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('O arquivo não possui uma planilha válida.');
      const rows = XLSX.utils.sheet_to_json(sheet,{defval:''}).filter(row => Object.values(row).some(value => String(value).trim() !== ''));
      if (!rows.length) throw new Error('Nenhuma coleta foi encontrada no arquivo.');
      if (rows.length > MAX_ROWS) throw new Error(`O arquivo possui ${rows.length} linhas. O limite é ${MAX_ROWS} coletas por lote.`);
      const refs = await loadReferences();
      parsedRows = validateRows(rows,refs);
      const invalid = parsedRows.filter(row => row.errors.length).length;
      renderPreview();
      if (invalid) setStatus(`O arquivo possui ${invalid} linha(s) com erro. Corrija o Excel ou cadastre os CPFs pendentes; nenhuma coleta será importada enquanto houver erro.`,'bad');
      else setStatus(`${parsedRows.length} coleta(s) validadas. Revise a prévia e confirme para gravar no Nexus.`,'good');
    } catch (error) {
      console.error('[Nexus importação de coletas]',error);
      parsedRows = [];
      renderPreview();
      setStatus(error.message || 'Não foi possível validar o arquivo.','bad');
    }
  }

  async function confirmImport() {
    if (!parsedRows.length || parsedRows.some(row => row.errors.length)) return;
    const button = byId('nexusCollectionConfirm');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Importando…';
    try {
      const payload = parsedRows.map(row => row.payload);
      const { data, error } = await getClient().rpc('import_exam_records_bulk',{p_rows:payload});
      if (error) throw error;
      const count = Number(data?.imported ?? payload.length);
      parsedRows = [];
      renderPreview();
      const input = byId('nexusCollectionFile');
      if (input) input.value='';
      setStatus(`${count} coleta(s) importadas com sucesso.`,'good');
      await window.NexusCollections?.listCollections?.();
    } catch (error) {
      console.error('[Nexus importação de coletas]',error);
      setStatus(error.message || 'Não foi possível importar as coletas. Nenhuma linha foi gravada.','bad');
      button.disabled = false;
      button.textContent = original;
    }
  }

  function buildUi() {
    if (byId('nexusCollectionImportCard')) return true;
    const section = byId('coletas');
    if (!section) return false;
    injectStyles();
    const card = document.createElement('div');
    card.id = 'nexusCollectionImportCard';
    card.className = 'card-box nexus-collection-import';
    card.innerHTML = `<div class="nexus-ci-head"><div><h3>Importação de coletas por Excel</h3><p>Associe resultados pelo CPF do colaborador. CPF novo vira pendência de cadastro e bloqueia o lote. Exames e vínculos da Matriz continuam sendo validados pelo Nexus.</p></div><div class="nexus-ci-actions"><button type="button" class="ghost" id="nexusCollectionTemplate">Baixar modelo Excel</button><button type="button" id="nexusCollectionSelect">Selecionar arquivo</button><input type="file" id="nexusCollectionFile" accept=".xlsx,.xls,.csv" hidden></div></div><div id="nexusCollectionImportStatus" class="nexus-ci-status">Use o modelo do Nexus para validar as coletas antes de gravar.</div><div id="nexusCollectionImportPreview"></div>`;
    const header = section.firstElementChild;
    if (header?.nextSibling) section.insertBefore(card,header.nextSibling); else section.appendChild(card);
    byId('nexusCollectionTemplate').onclick = async () => {
      try { await downloadTemplate(); setStatus('Modelo Excel gerado. Preencha a aba “Coletas” e depois selecione o arquivo.','good'); }
      catch (error) { setStatus(error.message || 'Não foi possível gerar o modelo.','bad'); }
    };
    byId('nexusCollectionSelect').onclick = () => byId('nexusCollectionFile').click();
    byId('nexusCollectionFile').onchange = event => { const file = event.target.files?.[0]; if (file) parseFile(file); };
    return true;
  }

  function install() {
    if (installed) return;
    if (!buildUi()) {
      const observer = new MutationObserver(() => { if (buildUi()) { observer.disconnect(); installed = true; } });
      observer.observe(document.body,{childList:true,subtree:true});
      return;
    }
    installed = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
