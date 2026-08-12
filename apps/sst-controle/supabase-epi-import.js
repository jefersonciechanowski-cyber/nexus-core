(() => {
  'use strict';

  const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  const MAX_ROWS = 1000;
  let parsed = { catalog: [], purchases: [], deliveries: [] };
  let lastWorkbookRows = null;
  let installed = false;

  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[ch]));
  const digits = value => String(value ?? '').replace(/\D/g, '');
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g,' ').toLowerCase();
  const codeKey = value => normalize(value);

  function getClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Cliente autenticado do Supabase não está disponível.');
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); }
    catch { throw new Error('Sessão autenticada inválida.'); }
    const id = String(session?.organizationId || '').trim();
    if (!id) throw new Error('Organização autenticada não foi identificada.');
    return id;
  }

  function isValidCpf(value) {
    const cpf = digits(value);
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    const digit = length => {
      const sum = cpf.slice(0,length).split('').reduce((total,item,index)=>total + Number(item) * (length + 1 - index),0);
      const result = (sum * 10) % 11;
      return result === 10 ? 0 : result;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  }

  function isoDate(parts) {
    const year=Number(parts.year), month=Number(parts.month), day=Number(parts.day);
    if (!year || !month || !day || month<1 || month>12 || day<1 || day>31) return null;
    const date = new Date(Date.UTC(year,month-1,day));
    if (date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) return null;
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function normalizeDate(value) {
    if (value === null || value === undefined || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return isoDate({year:value.getFullYear(),month:value.getMonth()+1,day:value.getDate()});
    }
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const parsedDate = window.XLSX.SSF.parse_date_code(value);
      if (parsedDate) return isoDate({year:parsedDate.y,month:parsedDate.m,day:parsedDate.d});
    }
    const text = String(value).trim();
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return isoDate({year:match[1],month:match[2],day:match[3]});
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (match) return isoDate({year:match[3],month:match[2],day:match[1]});
    return null;
  }

  async function ensureXlsx() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-nexus-xlsx]');
      if (existing) {
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(new Error('Não foi possível carregar o leitor de Excel.')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=XLSX_URL; script.async=true; script.dataset.nexusXlsx='true';
      script.onload=resolve; script.onerror=()=>reject(new Error('Não foi possível carregar o leitor de Excel. Verifique sua conexão.'));
      document.head.appendChild(script);
    });
    if (!window.XLSX) throw new Error('Leitor de Excel indisponível.');
    return window.XLSX;
  }

  async function fetchAll(table, select) {
    const organizationId=getOrganizationId();
    const result=[]; let from=0; const size=1000;
    while (true) {
      const {data,error}=await getClient().from(table).select(select).eq('organization_id',organizationId).range(from,from+size-1);
      if (error) throw error;
      result.push(...(data||[]));
      if (!data || data.length<size) break;
      from += size;
    }
    return result;
  }

  async function loadReferences() {
    const [employees, catalog, matrix, purchases, deliveries] = await Promise.all([
      fetchAll('employees','id,full_name,cpf,active,unit_id,sector_id,job_role_id'),
      fetchAll('epi_catalog','id,name,code,active'),
      fetchAll('control_matrix_rules','id,requirement_type,epi_id,unit_id,sector_id,job_role_id,validity_days,active,effective_from'),
      fetchAll('epi_purchases','id,epi_id,purchased_at,quantity'),
      fetchAll('epi_deliveries','id,employee_id,epi_id,delivered_at,returned_at,final_disposition')
    ]);
    const employeeByCpf=new Map();
    employees.forEach(employee=>{
      if (!employee.cpf) return;
      const key=digits(employee.cpf); const list=employeeByCpf.get(key)||[]; list.push(employee); employeeByCpf.set(key,list);
    });
    const epiByCode=new Map();
    catalog.forEach(epi=>{
      const key=codeKey(epi.code); const list=epiByCode.get(key)||[]; list.push(epi); epiByCode.set(key,list);
    });
    return {employees,catalog,matrix,purchases,deliveries,employeeByCpf,epiByCode};
  }

  function sheetRows(workbook, name) {
    const sheet=workbook.Sheets[name];
    if (!sheet) return [];
    return window.XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true}).filter(row=>Object.values(row).some(value=>String(value??'').trim()!==''));
  }

  function valueOf(row, aliases) {
    const entries=Object.entries(row||{});
    for (const alias of aliases) {
      const found=entries.find(([key])=>normalize(key)===normalize(alias));
      if (found) return found[1];
    }
    return '';
  }

  function validateCatalog(rows, refs) {
    const seen=new Map();
    return rows.map((raw,index)=>{
      const rowNumber=index+2;
      const name=String(valueOf(raw,['Nome do EPI','Nome','EPI'])??'').trim();
      const code=String(valueOf(raw,['Código / CA','Codigo / CA','Código','Codigo','CA'])??'').trim();
      const errors=[]; let existing=null; let reused=false;
      if (!name) errors.push('Nome do EPI é obrigatório.');
      if (!code) errors.push('Código/CA é obrigatório.');
      if (code) {
        const key=codeKey(code);
        if (seen.has(key)) errors.push(`Código/CA duplicado no arquivo (também na linha ${seen.get(key)}).`);
        else seen.set(key,rowNumber);
        const matches=refs.epiByCode.get(key)||[];
        if (matches.length>1) errors.push('Código/CA duplicado no catálogo atual.');
        else if (matches.length===1) {
          existing=matches[0];
          if (!existing.active) errors.push('Este EPI já existe, mas está inativo.');
          else if (name && normalize(existing.name)!==normalize(name)) errors.push(`Código/CA já cadastrado como “${existing.name}”.`);
          else reused=true;
        }
      }
      return {rowNumber,name,code,errors,reused,existing,payload:errors.length?null:{name,code}};
    });
  }

  function buildVirtualCatalog(catalogRows, refs) {
    const map=new Map();
    refs.catalog.filter(epi=>epi.active).forEach(epi=>map.set(codeKey(epi.code),{kind:'existing',epi}));
    catalogRows.filter(row=>!row.errors.length && !row.reused).forEach(row=>map.set(codeKey(row.code),{kind:'new',row}));
    return map;
  }

  function validatePurchases(rows, virtualCatalog) {
    const today=new Date().toISOString().slice(0,10);
    return rows.map((raw,index)=>{
      const rowNumber=index+2;
      const code=String(valueOf(raw,['Código / CA','Codigo / CA','Código','Codigo','CA'])??'').trim();
      const purchasedAt=normalizeDate(valueOf(raw,['Data da Compra','Data Compra','Data']));
      const quantity=Number(String(valueOf(raw,['Quantidade','Qtd'])??'').trim());
      const supplier=String(valueOf(raw,['Fornecedor'])??'').trim();
      const invoiceNumber=String(valueOf(raw,['Nota Fiscal','NF','Documento'])??'').trim();
      const technicalResponsible=String(valueOf(raw,['Responsável Técnico','Responsavel Tecnico','Responsável','Responsavel'])??'').trim();
      const errors=[];
      if (!code) errors.push('Código/CA é obrigatório.');
      else if (!virtualCatalog.has(codeKey(code))) errors.push(`Código/CA “${code}” não está no catálogo atual nem na aba Catálogo.`);
      if (!purchasedAt) errors.push('Data da Compra é obrigatória e deve estar em DD/MM/AAAA ou AAAA-MM-DD.');
      else if (purchasedAt>today) errors.push('Data da Compra não pode estar no futuro.');
      if (!Number.isInteger(quantity)||quantity<=0) errors.push('Quantidade deve ser um inteiro maior que zero.');
      if (!technicalResponsible) errors.push('Responsável Técnico é obrigatório.');
      return {rowNumber,code,purchasedAt,quantity,supplier,invoiceNumber,technicalResponsible,errors,payload:errors.length?null:{code,purchased_at:purchasedAt,quantity:String(quantity),supplier:supplier||null,invoice_number:invoiceNumber||null,technical_responsible:technicalResponsible}};
    });
  }

  function normalizeDisposition(value) {
    const key=normalize(value);
    if (!key) return '';
    if (['devolvido','devolvido ao estoque','retornou ao estoque','returned_to_stock'].includes(key)) return 'RETURNED_TO_STOCK';
    if (['descartado','descarte','discarded'].includes(key)) return 'DISCARDED';
    return null;
  }

  function matrixRuleFor(refs, employee, epi, deliveredAt) {
    return refs.matrix.filter(rule=>rule.active && rule.requirement_type==='EPI' && String(rule.epi_id)===String(epi.id)
      && String(rule.unit_id)===String(employee.unit_id) && String(rule.sector_id)===String(employee.sector_id)
      && String(rule.job_role_id)===String(employee.job_role_id)
      && (!rule.effective_from || rule.effective_from<=deliveredAt))
      .sort((a,b)=>String(b.effective_from||'').localeCompare(String(a.effective_from||'')))[0] || null;
  }

  function validateDeliveries(rows, refs, virtualCatalog, purchaseRows) {
    const today=new Date().toISOString().slice(0,10);
    const mapped=rows.map((raw,index)=>{
      const rowNumber=index+2;
      const cpf=digits(valueOf(raw,['CPF','CPF Colaborador']));
      const code=String(valueOf(raw,['Código / CA','Codigo / CA','Código','Codigo','CA'])??'').trim();
      const deliveredAt=normalizeDate(valueOf(raw,['Data da Entrega','Data Entrega','Data']));
      const returnedAt=normalizeDate(valueOf(raw,['Data de Encerramento','Data Encerramento','Data de Devolução','Data de Devolucao']));
      const dispositionRaw=String(valueOf(raw,['Destino Final','Destino','Situação Final','Situacao Final'])??'').trim();
      const returnReason=String(valueOf(raw,['Motivo','Motivo do Descarte','Observação','Observacao'])??'').trim();
      const errors=[]; let employee=null; let epi=null; let rule=null; let needsRegistration=false; let needsMatrix=false;
      if (!cpf || !isValidCpf(cpf)) errors.push('CPF obrigatório e válido.');
      else {
        const matches=refs.employeeByCpf.get(cpf)||[];
        if (!matches.length) { needsRegistration=true; errors.push('CPF não cadastrado. Cadastre o colaborador antes de importar a entrega.'); }
        else if (matches.length>1) errors.push('CPF duplicado na empresa.');
        else {
          employee=matches[0];
          if (!employee.active) errors.push('Colaborador está inativo.');
          if (!employee.unit_id||!employee.sector_id||!employee.job_role_id) errors.push('Colaborador precisa possuir unidade, setor e função cadastrados.');
        }
      }
      if (!code) errors.push('Código/CA é obrigatório.');
      else {
        const virtual=virtualCatalog.get(codeKey(code));
        if (!virtual) errors.push(`Código/CA “${code}” não está cadastrado.`);
        else if (virtual.kind==='new') errors.push('EPI novo: importe Catálogo/Compras primeiro, configure-o na Matriz e depois importe as entregas.');
        else epi=virtual.epi;
      }
      if (!deliveredAt) errors.push('Data da Entrega é obrigatória e deve estar em DD/MM/AAAA ou AAAA-MM-DD.');
      else if (deliveredAt>today) errors.push('Data da Entrega não pode estar no futuro.');

      let disposition='';
      if (returnedAt) {
        if (returnedAt>today) errors.push('Data de Encerramento não pode estar no futuro.');
        if (deliveredAt && returnedAt<deliveredAt) errors.push('Data de Encerramento não pode ser anterior à entrega.');
        disposition=normalizeDisposition(dispositionRaw);
        if (!disposition) errors.push('Destino Final deve ser “DEVOLVIDO AO ESTOQUE” ou “DESCARTADO”.');
        if (disposition==='DISCARDED' && !returnReason) errors.push('Descarte exige motivo.');
      } else if (dispositionRaw || returnReason) errors.push('Destino Final e Motivo exigem Data de Encerramento.');

      if (employee && epi && deliveredAt && employee.unit_id && employee.sector_id && employee.job_role_id) {
        rule=matrixRuleFor(refs,employee,epi,deliveredAt);
        if (!rule || Number(rule.validity_days)<=0) { needsMatrix=true; errors.push('Não existe regra ativa da Matriz para este EPI, setor e função na data da entrega.'); }
        if (refs.deliveries.some(item=>String(item.employee_id)===String(employee.id)&&String(item.epi_id)===String(epi.id)&&!item.returned_at)) {
          errors.push('Este colaborador já possui este EPI em uso. Finalize a entrega atual antes de importar outra.');
        }
      }
      return {rowNumber,cpf,employee,code,epi,deliveredAt,returnedAt:returnedAt||'',disposition,returnReason,rule,needsRegistration,needsMatrix,errors,payload:null};
    });

    const importedPurchases=purchaseRows.filter(row=>!row.errors.length);
    const validForStock=mapped.slice().sort((a,b)=>String(a.deliveredAt||'9999').localeCompare(String(b.deliveredAt||'9999'))||a.rowNumber-b.rowNumber);
    const prior=[];
    validForStock.forEach(row=>{
      if (row.errors.length || !row.epi || !row.deliveredAt) return;
      const existingPurchased=refs.purchases.filter(p=>String(p.epi_id)===String(row.epi.id)&&p.purchased_at<=row.deliveredAt).reduce((sum,p)=>sum+Number(p.quantity||0),0);
      const importedPurchased=importedPurchases.filter(p=>codeKey(p.code)===codeKey(row.code)&&p.purchasedAt<=row.deliveredAt).reduce((sum,p)=>sum+Number(p.quantity||0),0);
      const unavailableExisting=refs.deliveries.filter(d=>String(d.epi_id)===String(row.epi.id)&&d.delivered_at<=row.deliveredAt&&(d.final_disposition==='DISCARDED'||!d.returned_at||d.returned_at>row.deliveredAt)).length;
      const unavailableImported=prior.filter(d=>codeKey(d.code)===codeKey(row.code)&&d.deliveredAt<=row.deliveredAt&&(d.disposition==='DISCARDED'||!d.returnedAt||d.returnedAt>row.deliveredAt)).length;
      if (existingPurchased+importedPurchased<=unavailableExisting+unavailableImported) row.errors.push('Estoque insuficiente para este EPI na data da entrega.');
      if (!row.errors.length) prior.push(row);
    });

    mapped.forEach(row=>{
      if (!row.errors.length) row.payload={cpf:row.cpf,code:row.code,delivered_at:row.deliveredAt,returned_at:row.returnedAt||null,final_disposition:row.disposition||null,return_reason:row.returnReason||null};
    });
    return mapped;
  }

  async function validateWorkbookRows(rows) {
    const refs=await loadReferences();
    const catalog=validateCatalog(rows.catalog,refs);
    const virtualCatalog=buildVirtualCatalog(catalog,refs);
    const purchases=validatePurchases(rows.purchases,virtualCatalog);
    const deliveries=validateDeliveries(rows.deliveries,refs,virtualCatalog,purchases);
    parsed={catalog,purchases,deliveries};
    renderPreview();
  }

  function rowStatus(row) {
    if (row.errors.length) return `<span class="nexus-ei-error">${row.errors.map(esc).join('<br>')}</span>`;
    if (row.reused) return '<span class="nexus-ei-warn">Já existe — será reutilizado</span>';
    return '<span class="nexus-ei-ready">Pronto para importar</span>';
  }

  function summary() {
    const all=[...parsed.catalog,...parsed.purchases,...parsed.deliveries];
    return {total:all.length,valid:all.filter(row=>!row.errors.length).length,invalid:all.filter(row=>row.errors.length).length,pendingCpf:parsed.deliveries.filter(row=>row.needsRegistration).length,pendingMatrix:parsed.deliveries.filter(row=>row.needsMatrix).length};
  }

  function tableCatalog() {
    if (!parsed.catalog.length) return '';
    return `<h4>Catálogo</h4><div class="nexus-ei-table-wrap"><table class="nexus-ei-table"><thead><tr><th>Linha</th><th>Nome</th><th>Código/CA</th><th>Validação</th></tr></thead><tbody>${parsed.catalog.map(row=>`<tr><td>${row.rowNumber}</td><td>${esc(row.name||'—')}</td><td>${esc(row.code||'—')}</td><td>${rowStatus(row)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function tablePurchases() {
    if (!parsed.purchases.length) return '';
    return `<h4>Compras / Entradas de Estoque</h4><div class="nexus-ei-table-wrap"><table class="nexus-ei-table"><thead><tr><th>Linha</th><th>Código/CA</th><th>Data</th><th>Qtd.</th><th>Fornecedor</th><th>Responsável Técnico</th><th>Validação</th></tr></thead><tbody>${parsed.purchases.map(row=>`<tr><td>${row.rowNumber}</td><td>${esc(row.code||'—')}</td><td>${esc(row.purchasedAt||'—')}</td><td>${esc(Number.isInteger(row.quantity)?row.quantity:'—')}</td><td>${esc(row.supplier||'—')}</td><td>${esc(row.technicalResponsible||'—')}</td><td>${rowStatus(row)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function tableDeliveries() {
    if (!parsed.deliveries.length) return '';
    return `<h4>Entregas / Histórico</h4><div class="nexus-ei-table-wrap"><table class="nexus-ei-table"><thead><tr><th>Linha</th><th>CPF / Colaborador</th><th>Código/CA</th><th>Entrega</th><th>Encerramento</th><th>Validação</th></tr></thead><tbody>${parsed.deliveries.map(row=>`<tr><td>${row.rowNumber}</td><td>${esc(row.cpf||'—')}<br><small>${esc(row.employee?.full_name||'Não cadastrado')}</small>${row.needsRegistration?`<br><button type="button" class="ghost nexus-ei-mini" data-register-cpf="${esc(row.cpf)}">Cadastrar colaborador</button>`:''}</td><td>${esc(row.code||'—')}</td><td>${esc(row.deliveredAt||'—')}</td><td>${esc(row.returnedAt||'Em uso')}${row.disposition?`<br><small>${esc(row.disposition==='DISCARDED'?'Descartado':'Devolvido ao estoque')}</small>`:''}</td><td>${rowStatus(row)}${row.needsMatrix?'<br><button type="button" class="ghost nexus-ei-mini" data-open-matrix>Ir para Matriz</button>':''}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderPreview() {
    const wrap=byId('nexusEpiImportPreview'); if (!wrap) return;
    const s=summary();
    if (!s.total) { wrap.innerHTML=''; return; }
    wrap.innerHTML=`<div class="nexus-ei-summary"><span class="nexus-ei-pill">Linhas <b>${s.total}</b></span><span class="nexus-ei-pill good">Válidas <b>${s.valid}</b></span><span class="nexus-ei-pill bad">Com erro <b>${s.invalid}</b></span>${s.pendingCpf?`<span class="nexus-ei-pill bad">CPFs pendentes <b>${s.pendingCpf}</b></span>`:''}${s.pendingMatrix?`<span class="nexus-ei-pill bad">Matriz pendente <b>${s.pendingMatrix}</b></span>`:''}</div>${tableCatalog()}${tablePurchases()}${tableDeliveries()}<div class="nexus-ei-footer">${(s.pendingCpf||s.pendingMatrix)?'<button type="button" class="ghost" id="nexusEpiRevalidate">Revalidar cadastros/Matriz</button>':''}<button type="button" class="ghost" id="nexusEpiCancel">Cancelar prévia</button><button type="button" id="nexusEpiConfirm" ${s.invalid?'disabled':''}>Confirmar importação</button></div>`;
    wrap.querySelectorAll('[data-register-cpf]').forEach(button=>button.onclick=()=>openEmployeeRegistration(button.dataset.registerCpf));
    wrap.querySelectorAll('[data-open-matrix]').forEach(button=>button.onclick=openMatrix);
    byId('nexusEpiRevalidate')?.addEventListener('click',revalidate);
    byId('nexusEpiCancel').onclick=clearPreview;
    byId('nexusEpiConfirm').onclick=confirmImport;
    if (s.invalid) setStatus(`O arquivo possui ${s.invalid} linha(s) com erro. Nenhum dado será importado enquanto houver erro.`,'bad');
    else setStatus(`${s.total} linha(s) validadas. Revise Catálogo, Compras e Entregas antes de confirmar.`,'good');
  }

  function openEmployeeRegistration(cpf) {
    const cadastros=[...document.querySelectorAll('button.tab')].find(button=>normalize(button.textContent)==='cadastros'); cadastros?.click();
    const colaboradores=document.querySelector('[data-subtab="reg-colaboradores"]'); colaboradores?.click();
    const input=byId('empCpf');
    if (input) { input.value=cpf; input.dispatchEvent(new Event('input',{bubbles:true})); input.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>input.focus(),250); }
  }

  function openMatrix() {
    const matrix=[...document.querySelectorAll('button.tab')].find(button=>normalize(button.textContent)==='matriz de controle');
    matrix?.click();
  }

  async function revalidate() {
    if (!lastWorkbookRows) return;
    try { setStatus('Revalidando CPFs, catálogo, Matriz e estoque…'); await validateWorkbookRows(lastWorkbookRows); }
    catch (error) { console.error('[Nexus importação EPI]',error); setStatus(error.message||'Não foi possível revalidar o arquivo.','bad'); }
  }

  function clearPreview() {
    parsed={catalog:[],purchases:[],deliveries:[]}; lastWorkbookRows=null; renderPreview();
    const input=byId('nexusEpiFile'); if (input) input.value='';
    setStatus('Use o modelo Nexus para migrar Catálogo, Compras e Entregas de EPI.');
  }

  async function parseFile(file) {
    try {
      setStatus('Lendo arquivo e validando EPIs, estoque, CPFs e Matriz…');
      const XLSX=await ensureXlsx(); const data=await file.arrayBuffer(); const workbook=XLSX.read(data,{type:'array',cellDates:true});
      const rows={catalog:sheetRows(workbook,'Catálogo'),purchases:sheetRows(workbook,'Compras'),deliveries:sheetRows(workbook,'Entregas')};
      if (!rows.catalog.length&&!rows.purchases.length&&!rows.deliveries.length) throw new Error('Nenhum dado foi encontrado nas abas Catálogo, Compras ou Entregas.');
      if (rows.catalog.length>MAX_ROWS||rows.purchases.length>MAX_ROWS||rows.deliveries.length>MAX_ROWS) throw new Error(`Cada aba aceita no máximo ${MAX_ROWS} linhas por lote.`);
      lastWorkbookRows=rows; await validateWorkbookRows(rows);
    } catch (error) {
      console.error('[Nexus importação EPI]',error); parsed={catalog:[],purchases:[],deliveries:[]}; renderPreview(); setStatus(error.message||'Não foi possível validar o arquivo.','bad');
    }
  }

  async function confirmImport() {
    const s=summary(); if (!s.total||s.invalid) return;
    const button=byId('nexusEpiConfirm'); const original=button.textContent; button.disabled=true; button.textContent='Importando…';
    try {
      const p_catalog=parsed.catalog.filter(row=>!row.errors.length).map(row=>row.payload);
      const p_purchases=parsed.purchases.filter(row=>!row.errors.length).map(row=>row.payload);
      const p_deliveries=parsed.deliveries.filter(row=>!row.errors.length).sort((a,b)=>a.deliveredAt.localeCompare(b.deliveredAt)||a.rowNumber-b.rowNumber).map(row=>row.payload);
      const {data,error}=await getClient().rpc('import_epis_bulk',{p_catalog,p_purchases,p_deliveries});
      if (error) throw error;
      const created=Number(data?.catalogCreated||0), reused=Number(data?.catalogReused||0), purchases=Number(data?.purchases||0), deliveries=Number(data?.deliveries||0), closed=Number(data?.closedDeliveries||0);
      parsed={catalog:[],purchases:[],deliveries:[]}; lastWorkbookRows=null; renderPreview(); const input=byId('nexusEpiFile'); if (input) input.value='';
      setStatus(`Importação concluída: ${created} EPI(s) novo(s), ${reused} reutilizado(s), ${purchases} compra(s), ${deliveries} entrega(s)${closed?` e ${closed} encerramento(s)`:''}.`,'good');
      await window.NexusEpis?.listEpis?.(); await window.NexusEpiDeliveries?.loadDeliveries?.();
    } catch (error) {
      console.error('[Nexus importação EPI]',error); setStatus(error.message||'Não foi possível importar os EPIs. Nenhuma linha foi gravada.','bad'); button.disabled=false; button.textContent=original;
    }
  }

  function formatTextColumns(sheet, columns, rows=300) {
    columns.forEach(column=>{
      for (let r=1;r<=rows;r++) {
        const address=window.XLSX.utils.encode_cell({c:column,r});
        if (!sheet[address]) sheet[address]={t:'s',v:''};
        sheet[address].z='@';
      }
    });
    const range=window.XLSX.utils.decode_range(sheet['!ref']||'A1:A1'); range.e.r=Math.max(range.e.r,rows); sheet['!ref']=window.XLSX.utils.encode_range(range);
  }

  async function downloadTemplate() {
    const XLSX=await ensureXlsx(); const workbook=XLSX.utils.book_new();
    const instructions=XLSX.utils.aoa_to_sheet([
      ['MODELO DE IMPORTAÇÃO DE EPIs — NEXUS SST'],
      ['Preencha somente as abas necessárias: Catálogo, Compras e/ou Entregas. Não altere os títulos das colunas.'],
      ['Catálogo: cria EPIs novos. Se o Código/CA já existir com o mesmo nome, o Nexus reutiliza o cadastro.'],
      ['Compras: registram entrada em estoque. O responsável técnico é obrigatório e será herdado pelas entregas.'],
      ['Entregas: o CPF deve existir no SST Controle e o EPI precisa possuir regra ativa na Matriz para o setor/função do colaborador.'],
      ['EPI totalmente novo: importe Catálogo/Compras, configure-o na Matriz e depois importe as Entregas.'],
      ['Data de Encerramento é opcional. Se preenchida, use Destino Final = DEVOLVIDO AO ESTOQUE ou DESCARTADO. Descarte exige motivo.'],
      ['Datas aceitas: DD/MM/AAAA ou AAAA-MM-DD. CPF e datas são tratados como texto para evitar alterações automáticas do Excel.'],
      [`Máximo de ${MAX_ROWS} linhas por aba. Havendo qualquer erro na prévia, nenhum dado é gravado.`]
    ]); instructions['!cols']=[{wch:125}];
    const catalog=XLSX.utils.aoa_to_sheet([['Nome do EPI','Código / CA']]); catalog['!cols']=[{wch:34},{wch:22}]; formatTextColumns(catalog,[1]);
    const purchases=XLSX.utils.aoa_to_sheet([['Código / CA','Data da Compra','Quantidade','Fornecedor','Nota Fiscal','Responsável Técnico']]); purchases['!cols']=[{wch:22},{wch:18},{wch:12},{wch:28},{wch:20},{wch:30}]; formatTextColumns(purchases,[0,1,4]);
    const deliveries=XLSX.utils.aoa_to_sheet([['CPF','Código / CA','Data da Entrega','Data de Encerramento','Destino Final','Motivo']]); deliveries['!cols']=[{wch:18},{wch:22},{wch:18},{wch:22},{wch:24},{wch:36}]; formatTextColumns(deliveries,[0,1,2,3]);
    const example=XLSX.utils.aoa_to_sheet([
      ['ABA','EXEMPLO'],
      ['Catálogo','Luva de Proteção | CA-12345'],
      ['Compras','CA-12345 | 01/08/2026 | 10 | Fornecedor ABC | NF-001 | Técnico Responsável'],
      ['Entregas','12345678909 | CA-12345 | 05/08/2026 | (vazio se em uso) | (vazio) | (vazio)']
    ]); example['!cols']=[{wch:18},{wch:105}];
    XLSX.utils.book_append_sheet(workbook,instructions,'Instruções'); XLSX.utils.book_append_sheet(workbook,catalog,'Catálogo'); XLSX.utils.book_append_sheet(workbook,purchases,'Compras'); XLSX.utils.book_append_sheet(workbook,deliveries,'Entregas'); XLSX.utils.book_append_sheet(workbook,example,'Exemplo');
    XLSX.writeFile(workbook,'Modelo_Importacao_EPIs_Nexus_SST.xlsx');
  }

  function injectStyles() {
    if (document.querySelector('style[data-nexus-epi-import]')) return;
    const style=document.createElement('style'); style.dataset.nexusEpiImport='true'; style.textContent=`
      .nexus-epi-import{border-color:rgba(224,184,74,.28)!important;background:linear-gradient(135deg,rgba(224,184,74,.055),var(--surface))!important;margin-bottom:18px}
      .nexus-ei-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.nexus-ei-head h3{margin:0 0 6px;font-size:14px}.nexus-ei-head p{margin:0;color:var(--text-muted);font-size:12px;line-height:1.55;max-width:760px}.nexus-ei-actions{display:flex;gap:8px;flex-wrap:wrap}.nexus-ei-actions button{white-space:nowrap}
      .nexus-ei-status{margin-top:13px;padding:11px 12px;border:1px solid var(--border);border-radius:8px;color:var(--text-muted);font-size:12px}.nexus-ei-status.good{border-color:rgba(114,168,117,.45);color:#8fd394}.nexus-ei-status.bad{border-color:rgba(220,108,103,.5);color:#ff817a}
      .nexus-ei-summary{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.nexus-ei-pill{padding:5px 9px;border:1px solid var(--border);border-radius:99px;font-size:11px}.nexus-ei-pill.good{border-color:rgba(114,168,117,.45);color:#8fd394}.nexus-ei-pill.bad{border-color:rgba(220,108,103,.45);color:#ff817a}
      #nexusEpiImportPreview h4{margin:16px 0 7px;font-size:12px}.nexus-ei-table-wrap{overflow:auto;border:1px solid var(--border);border-radius:9px}.nexus-ei-table{width:100%;border-collapse:collapse;min-width:850px;font-size:11px}.nexus-ei-table th,.nexus-ei-table td{padding:9px 10px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.nexus-ei-table th{color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em}.nexus-ei-error{color:#ff817a}.nexus-ei-ready{color:#8fd394}.nexus-ei-warn{color:#e0b84a}.nexus-ei-mini{padding:5px 8px!important;font-size:10px!important;margin-top:5px}.nexus-ei-footer{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:13px}
      @media(max-width:760px){.nexus-ei-head{flex-direction:column}.nexus-ei-actions{width:100%}.nexus-ei-actions button{flex:1}}
    `; document.head.appendChild(style);
  }

  function setStatus(text,type='') { const status=byId('nexusEpiImportStatus'); if (!status) return; status.textContent=text; status.className=`nexus-ei-status ${type}`.trim(); }

  function buildUi() {
    if (byId('nexusEpiImportCard')) return true;
    const movementForm=byId('epiMovementForm'); if (!movementForm) return false;
    const movementCard=movementForm.closest('.card-box'); if (!movementCard?.parentElement) return false;
    injectStyles(); const card=document.createElement('div'); card.id='nexusEpiImportCard'; card.className='card-box nexus-epi-import';
    card.innerHTML=`<div class="nexus-ei-head"><div><h3>Importação de EPIs por Excel</h3><p>Migre Catálogo, Compras e Entregas em lote. O Nexus mantém estoque, responsável técnico, Matriz, validade por setor/função e histórico de devolução/descarte.</p></div><div class="nexus-ei-actions"><button type="button" class="ghost" id="nexusEpiTemplate">Baixar modelo Excel</button><button type="button" id="nexusEpiSelect">Selecionar arquivo</button><input id="nexusEpiFile" type="file" accept=".xlsx,.xls,.csv" hidden></div></div><div id="nexusEpiImportStatus" class="nexus-ei-status">Use o modelo Nexus para migrar Catálogo, Compras e Entregas de EPI.</div><div id="nexusEpiImportPreview"></div>`;
    movementCard.parentElement.insertBefore(card,movementCard);
    byId('nexusEpiTemplate').onclick=async()=>{ try { await downloadTemplate(); setStatus('Modelo Excel gerado. Preencha as abas necessárias e selecione o arquivo.','good'); } catch(error){ setStatus(error.message||'Não foi possível gerar o modelo.','bad'); } };
    byId('nexusEpiSelect').onclick=()=>byId('nexusEpiFile').click();
    byId('nexusEpiFile').onchange=event=>{ const file=event.target.files?.[0]; if(file) parseFile(file); };
    return true;
  }

  function install() {
    if (installed) return;
    if (!buildUi()) { const observer=new MutationObserver(()=>{ if(buildUi()){observer.disconnect();installed=true;} }); observer.observe(document.body,{childList:true,subtree:true}); return; }
    installed=true;
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
})();
