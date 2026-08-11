(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const bucket = 'sst-documents';
  let documents = [];
  let inspections = [];
  let requirements = [];
  let installed = false;
  let activeView = 'documents';

  function appState() { return window.NEXUS_SST_APP?.getState?.() || { units: [] }; }
  function organizationId() { return window.NexusData.getOrganizationId(); }
  function same(a, b) { return String(a ?? '') === String(b ?? ''); }
  function formatDate(value) { const [y, m, d] = String(value || '').slice(0, 10).split('-'); return y ? `${d}/${m}/${y}` : '—'; }
  function daysUntil(value) { const target = new Date(`${String(value || '').slice(0, 10)}T12:00:00`); const today = new Date(); today.setHours(12,0,0,0); return Number.isNaN(target.getTime()) ? null : Math.ceil((target - today) / 86400000); }
  function deadlineStatus(due) { const days = daysUntil(due); if (days === null) return 'MISSING'; if (days < 0) return 'OVERDUE'; if (days <= 7) return 'DUE_7'; if (days <= 15) return 'DUE_15'; if (days <= 30) return 'DUE_30'; return 'PLANNED'; }
  function unitName(id) { return appState().units.find(unit => same(unit.id, id))?.name || ''; }
  function statusLabel(status) {
    return ({ ACTIVE:'Ativo', REPLACED:'Substituído', ARCHIVED:'Arquivado', OPEN:'Pendente', IN_PROGRESS:'Em andamento', COMPLETED:'Concluído', PENDING:'Pendente' })[status] || status || '—';
  }
  function priorityLabel(priority) { return ({ LOW:'Baixa', MEDIUM:'Média', HIGH:'Alta', CRITICAL:'Crítica' })[priority] || priority || '—'; }
  function badgeClass(status) {
    if (['COMPLETED','ACTIVE'].includes(status)) return 'badge-bom';
    if (['ARCHIVED','REPLACED'].includes(status)) return 'badge-sem';
    if (['CRITICAL','OVERDUE'].includes(status)) return 'badge-critico';
    return 'badge-atencao';
  }
  function readableError(error, fallback = 'Não foi possível concluir a operação.') {
    return String(error?.cause?.message || error?.cause?.details || error?.message || fallback);
  }
  function safeName(file) {
    const original = String(file?.name || 'anexo').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return original.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-120) || 'anexo';
  }

  function installStyles() {
    if ($('nexusComplianceStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusComplianceStyles';
    style.textContent = `
      .compliance-header { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:22px; }
      .compliance-header h2 { margin:0 0 7px; }
      .compliance-switch { display:flex; gap:8px; flex-wrap:wrap; }
      .compliance-switch button { min-height:38px; }
      .compliance-switch button.active { background:var(--primary); color:#17130a; }
      .compliance-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin-bottom:20px; }
      .compliance-kpi { padding:17px 18px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); }
      .compliance-kpi span { display:block; color:var(--text-muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
      .compliance-kpi strong { display:block; margin-top:9px; font-size:27px; }
      .compliance-panel[hidden] { display:none !important; }
      .compliance-form-card { border:1px solid var(--border); border-radius:var(--radius); background:var(--surface); padding:18px; margin-bottom:16px; }
      .compliance-form-card h3 { margin:0 0 14px; font-size:15px; }
      .compliance-form { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
      .compliance-form label { display:flex; flex-direction:column; gap:6px; font-size:11px; color:var(--text-muted); font-weight:600; }
      .compliance-form .span-2 { grid-column:span 2; }
      .compliance-form .span-4 { grid-column:1/-1; }
      .compliance-form textarea { min-height:84px; resize:vertical; }
      .compliance-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:14px; flex-wrap:wrap; }
      .compliance-list { display:grid; gap:12px; }
      .compliance-card { border:1px solid var(--border); border-radius:12px; background:var(--surface); padding:16px 17px; }
      .compliance-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .compliance-card-head h4 { margin:0; font-size:15px; }
      .compliance-card-meta { display:flex; gap:10px 16px; flex-wrap:wrap; margin-top:10px; color:var(--text-muted); font-size:11px; line-height:1.5; }
      .compliance-card p { margin:10px 0 0; color:var(--text-muted); font-size:12px; line-height:1.55; }
      .compliance-card-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:13px; }
      .compliance-requirements { margin-top:14px; padding-top:14px; border-top:1px solid var(--border); display:grid; gap:9px; }
      .compliance-requirement { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:12px; align-items:center; padding:11px 12px; background:var(--surface-subtle); border-radius:9px; }
      .compliance-requirement strong { display:block; font-size:12px; }
      .compliance-requirement small { display:block; color:var(--text-muted); margin-top:4px; line-height:1.45; }
      .compliance-empty { padding:22px; text-align:center; color:var(--text-muted); border:1px dashed var(--border); border-radius:10px; }
      .compliance-status { min-height:18px; margin-top:9px; color:var(--text-muted); font-size:11px; }
      @media (max-width:1100px) { .compliance-form { grid-template-columns:repeat(2,minmax(0,1fr)); } .compliance-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .compliance-form .span-4 { grid-column:1/-1; } }
      @media (max-width:720px) { .compliance-header { flex-direction:column; } .compliance-form, .compliance-kpis { grid-template-columns:1fr; } .compliance-form .span-2,.compliance-form .span-4 { grid-column:auto; } .compliance-card-head,.compliance-requirement { grid-template-columns:1fr; display:grid; } }
    `;
    document.head.appendChild(style);
  }

  function injectNavigation() {
    if (document.querySelector('[data-tab="documentacao"]')) return;
    const agendaButton = document.querySelector('.sidebar nav [data-tab="agenda"]');
    if (!agendaButton) return;
    const button = document.createElement('button');
    button.className = 'tab';
    button.dataset.tab = 'documentacao';
    button.type = 'button';
    button.textContent = 'Documentação e Fiscalizações';
    agendaButton.after(button);
    button.onclick = event => {
      event.preventDefault();
      document.querySelectorAll('.sidebar nav button.tab').forEach(item => item.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      $('documentacao')?.classList.add('active');
      if ($('currentPageTitle')) $('currentPageTitle').textContent = 'Documentação e Fiscalizações';
      document.querySelector('.sidebar')?.classList.remove('open');
      $('sidebarOverlay')?.classList.remove('open');
      refresh();
    };
  }

  function injectSection() {
    if ($('documentacao')) return;
    const agenda = $('agenda');
    if (!agenda) return;
    const section = document.createElement('section');
    section.id = 'documentacao';
    section.className = 'tab-content';
    section.innerHTML = `
      <div class="compliance-header">
        <div><h2>Documentação e Fiscalizações</h2><p class="subtitle">Controle documentos da empresa, prazos oficiais, fiscalizações e exigências sem perder o histórico.</p></div>
        <div class="compliance-switch"><button id="complianceShowDocuments" class="ghost active" type="button">Documentos da empresa</button><button id="complianceShowInspections" class="ghost" type="button">Fiscalizações e exigências</button></div>
      </div>
      <div class="compliance-kpis">
        <div class="compliance-kpi"><span>Documentos ativos</span><strong id="complianceKpiDocuments">0</strong></div>
        <div class="compliance-kpi"><span>Vencem em 30 dias</span><strong id="complianceKpiDue">0</strong></div>
        <div class="compliance-kpi"><span>Fiscalizações abertas</span><strong id="complianceKpiInspections">0</strong></div>
        <div class="compliance-kpi"><span>Exigências pendentes</span><strong id="complianceKpiRequirements">0</strong></div>
      </div>

      <div id="complianceDocumentsPanel" class="compliance-panel">
        <div class="compliance-form-card">
          <h3>Registrar documento da empresa</h3>
          <form id="companyDocumentForm">
            <div class="compliance-form">
              <label>Documento<input id="companyDocumentType" maxlength="180" required placeholder="Ex.: Licença, cadastro federal, certificado"></label>
              <label>Órgão / entidade<input id="companyDocumentAuthority" maxlength="180" placeholder="Ex.: Prefeitura, Corpo de Bombeiros"></label>
              <label>Número / protocolo<input id="companyDocumentNumber" maxlength="120" placeholder="Número do documento"></label>
              <label>Unidade<select id="companyDocumentUnit"><option value="">Empresa inteira</option></select></label>
              <label>Emissão<input id="companyDocumentIssued" type="date"></label>
              <label>Vencimento<input id="companyDocumentExpires" type="date"></label>
              <label>Responsável interno<input id="companyDocumentResponsible" maxlength="180" placeholder="Quem acompanha este documento"></label>
              <label>Anexo<input id="companyDocumentFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"></label>
              <label class="span-4">Observações<textarea id="companyDocumentNotes" maxlength="1500" placeholder="Informações importantes, renovação, protocolo ou orientação do órgão"></textarea></label>
            </div>
            <div class="compliance-actions"><button type="submit">Salvar documento</button></div>
            <div id="companyDocumentStatus" class="compliance-status"></div>
          </form>
        </div>
        <div id="companyDocumentList" class="compliance-list"></div>
      </div>

      <div id="complianceInspectionsPanel" class="compliance-panel" hidden>
        <div class="compliance-form-card">
          <h3>Registrar fiscalização</h3>
          <form id="regulatoryInspectionForm">
            <div class="compliance-form">
              <label>Órgão fiscalizador<input id="inspectionAuthority" maxlength="180" required placeholder="Órgão ou entidade"></label>
              <label>Data da fiscalização<input id="inspectionDate" type="date" required></label>
              <label>Auto / protocolo<input id="inspectionNoticeNumber" maxlength="120" placeholder="Número do auto ou notificação"></label>
              <label>Unidade<select id="inspectionUnit"><option value="">Empresa inteira</option></select></label>
              <label class="span-2">Assunto<input id="inspectionSubject" maxlength="240" required placeholder="Motivo ou tema da fiscalização"></label>
              <label>Prioridade<select id="inspectionPriority"><option value="MEDIUM">Média</option><option value="LOW">Baixa</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
              <label>Responsável interno<input id="inspectionResponsible" maxlength="180" placeholder="Responsável pelo acompanhamento"></label>
              <label>Anexo da notificação<input id="inspectionFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"></label>
              <label class="span-4">Descrição<textarea id="inspectionDescription" maxlength="1800" placeholder="Contexto da fiscalização, observações e orientações recebidas"></textarea></label>
            </div>
            <div class="compliance-actions"><button type="submit">Salvar fiscalização</button></div>
            <div id="inspectionFormStatus" class="compliance-status"></div>
          </form>
        </div>

        <div class="compliance-form-card">
          <h3>Registrar exigência da fiscalização</h3>
          <form id="regulatoryRequirementForm">
            <div class="compliance-form">
              <label class="span-2">Fiscalização<select id="requirementInspection" required><option value="">Selecione a fiscalização</option></select></label>
              <label>Prazo<input id="requirementDue" type="date" required></label>
              <label>Prioridade<select id="requirementPriority"><option value="MEDIUM">Média</option><option value="LOW">Baixa</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></label>
              <label class="span-2">Exigência<input id="requirementDescription" maxlength="600" required placeholder="O que precisa ser apresentado ou regularizado"></label>
              <label>Responsável<input id="requirementResponsible" maxlength="180" placeholder="Quem ficará responsável"></label>
              <label>Evidência inicial<input id="requirementFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"></label>
            </div>
            <div class="compliance-actions"><button type="submit">Salvar exigência</button></div>
            <div id="requirementFormStatus" class="compliance-status"></div>
          </form>
        </div>
        <div id="inspectionList" class="compliance-list"></div>
      </div>`;
    agenda.after(section);
  }

  function switchView(view) {
    activeView = view;
    $('complianceDocumentsPanel').hidden = view !== 'documents';
    $('complianceInspectionsPanel').hidden = view !== 'inspections';
    $('complianceShowDocuments').classList.toggle('active', view === 'documents');
    $('complianceShowInspections').classList.toggle('active', view === 'inspections');
  }

  function renderUnitOptions() {
    ['companyDocumentUnit','inspectionUnit'].forEach(id => {
      const select = $(id); if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">Empresa inteira</option>' + appState().units.map(unit => `<option value="${esc(unit.id)}">${esc(unit.name)}</option>`).join('');
      if ([...select.options].some(option => option.value === current)) select.value = current;
    });
  }

  async function upload(file, path) {
    if (!file) return null;
    const client = window.NexusData.getClient();
    const { error } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw new Error(`Não foi possível enviar o anexo: ${error.message}`);
    return path;
  }

  async function removeUploaded(path) {
    if (!path) return;
    try { await window.NexusData.getClient().storage.from(bucket).remove([path]); } catch {}
  }

  async function openAttachment(path) {
    if (!path) return;
    const { data, error } = await window.NexusData.getClient().storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw new Error('Não foi possível abrir o anexo privado.');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function load() {
    const [documentRows, inspectionRows, requirementRows] = await Promise.all([
      window.NexusData.list({ table:'company_documents', select:'id,organization_id,unit_id,document_type,authority_name,document_number,issued_at,expires_at,responsible_name,status,notes,attachment_path,created_at,updated_at', order:{column:'created_at',ascending:false}, label:'documentos da empresa' }),
      window.NexusData.list({ table:'regulatory_inspections', select:'id,organization_id,unit_id,authority_name,inspection_date,notice_number,subject,description,priority,status,responsible_name,notice_path,completed_at,created_at,updated_at', order:{column:'inspection_date',ascending:false}, label:'fiscalizações' }),
      window.NexusData.list({ table:'regulatory_requirements', select:'id,organization_id,inspection_id,description,due_at,responsible_name,priority,status,completion_notes,evidence_path,completed_at,created_at,updated_at', order:{column:'due_at',ascending:true}, label:'exigências de fiscalização' })
    ]);
    documents = documentRows;
    inspections = inspectionRows;
    requirements = requirementRows;
  }

  function renderKpis() {
    $('complianceKpiDocuments').textContent = documents.filter(item => item.status === 'ACTIVE').length;
    $('complianceKpiDue').textContent = documents.filter(item => item.status === 'ACTIVE' && item.expires_at && ['OVERDUE','DUE_7','DUE_15','DUE_30'].includes(deadlineStatus(item.expires_at))).length;
    $('complianceKpiInspections').textContent = inspections.filter(item => item.status !== 'COMPLETED').length;
    $('complianceKpiRequirements').textContent = requirements.filter(item => item.status !== 'COMPLETED').length;
  }

  function renderDocuments() {
    const rows = documents.slice().sort((a,b) => String(a.expires_at || '9999-12-31').localeCompare(String(b.expires_at || '9999-12-31')));
    $('companyDocumentList').innerHTML = rows.length ? rows.map(item => {
      const expiry = item.expires_at ? deadlineStatus(item.expires_at) : null;
      const dynamicStatus = item.status === 'ACTIVE' && expiry === 'OVERDUE' ? 'OVERDUE' : item.status;
      return `<article class="compliance-card" data-document-id="${esc(item.id)}">
        <div class="compliance-card-head"><div><h4>${esc(item.document_type)}</h4><div class="compliance-card-meta"><span>${esc(item.authority_name || 'Órgão não informado')}</span>${item.document_number ? `<span>Protocolo: ${esc(item.document_number)}</span>` : ''}<span>${item.unit_id ? esc(unitName(item.unit_id) || 'Unidade') : 'Empresa inteira'}</span></div></div><span class="badge ${badgeClass(dynamicStatus)}">${dynamicStatus === 'OVERDUE' ? 'Vencido' : statusLabel(item.status)}</span></div>
        <div class="compliance-card-meta"><span>Emissão: ${formatDate(item.issued_at)}</span><span>Vencimento: ${formatDate(item.expires_at)}${item.expires_at ? ` · ${daysUntil(item.expires_at)} dia(s)` : ''}</span><span>Responsável: ${esc(item.responsible_name || 'Não definido')}</span></div>
        ${item.notes ? `<p>${esc(item.notes)}</p>` : ''}
        <div class="compliance-card-actions">${item.attachment_path ? `<button class="ghost compliance-open-file" data-path="${esc(item.attachment_path)}" type="button">Abrir anexo</button>` : ''}${item.status === 'ACTIVE' ? `<button class="ghost compliance-document-replaced" type="button">Marcar como substituído</button><button class="ghost compliance-document-archive" type="button">Arquivar</button>` : ''}</div>
      </article>`;
    }).join('') : '<div class="compliance-empty">Nenhum documento da empresa registrado.</div>';

    $('companyDocumentList').querySelectorAll('.compliance-open-file').forEach(button => button.onclick = () => openAttachment(button.dataset.path).catch(error => alert(readableError(error))));
    $('companyDocumentList').querySelectorAll('[data-document-id]').forEach(card => {
      const id = card.dataset.documentId;
      card.querySelector('.compliance-document-replaced')?.addEventListener('click', () => updateDocumentStatus(id, 'REPLACED'));
      card.querySelector('.compliance-document-archive')?.addEventListener('click', () => updateDocumentStatus(id, 'ARCHIVED'));
    });
  }

  function renderRequirementSelect() {
    const select = $('requirementInspection');
    const current = select.value;
    const open = inspections.filter(item => item.status !== 'COMPLETED');
    select.innerHTML = '<option value="">Selecione a fiscalização</option>' + open.map(item => `<option value="${esc(item.id)}">${esc(item.authority_name)} · ${esc(item.subject)} · ${formatDate(item.inspection_date)}</option>`).join('');
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  function renderInspections() {
    const rows = inspections.slice().sort((a,b) => String(b.inspection_date).localeCompare(String(a.inspection_date)));
    $('inspectionList').innerHTML = rows.length ? rows.map(item => {
      const linked = requirements.filter(req => same(req.inspection_id, item.id));
      const pending = linked.filter(req => req.status !== 'COMPLETED').length;
      return `<article class="compliance-card" data-inspection-id="${esc(item.id)}">
        <div class="compliance-card-head"><div><h4>${esc(item.authority_name)} · ${esc(item.subject)}</h4><div class="compliance-card-meta"><span>${formatDate(item.inspection_date)}</span>${item.notice_number ? `<span>Auto / protocolo: ${esc(item.notice_number)}</span>` : ''}<span>${item.unit_id ? esc(unitName(item.unit_id) || 'Unidade') : 'Empresa inteira'}</span><span>Prioridade: ${esc(priorityLabel(item.priority))}</span></div></div><span class="badge ${badgeClass(item.status)}">${statusLabel(item.status)}</span></div>
        ${item.description ? `<p>${esc(item.description)}</p>` : ''}
        <div class="compliance-card-meta"><span>Responsável: ${esc(item.responsible_name || 'Não definido')}</span><span>${pending} exigência(s) pendente(s)</span></div>
        <div class="compliance-card-actions">${item.notice_path ? `<button class="ghost compliance-open-file" data-path="${esc(item.notice_path)}" type="button">Abrir notificação</button>` : ''}${item.status === 'OPEN' ? '<button class="ghost inspection-progress" type="button">Iniciar acompanhamento</button>' : ''}${item.status !== 'COMPLETED' ? '<button class="ghost inspection-complete" type="button">Concluir fiscalização</button>' : ''}</div>
        <div class="compliance-requirements">${linked.length ? linked.map(req => `<div class="compliance-requirement" data-requirement-id="${esc(req.id)}"><div><strong>${esc(req.description)}</strong><small>Prazo: ${formatDate(req.due_at)} · ${daysUntil(req.due_at)} dia(s) · Responsável: ${esc(req.responsible_name || 'Não definido')} · Prioridade: ${esc(priorityLabel(req.priority))}</small></div><div><span class="badge ${badgeClass(req.status === 'PENDING' ? 'OPEN' : req.status)}">${statusLabel(req.status)}</span><div class="compliance-card-actions">${req.evidence_path ? `<button class="ghost compliance-open-file" data-path="${esc(req.evidence_path)}" type="button">Abrir evidência</button>` : ''}${req.status === 'PENDING' ? '<button class="ghost requirement-progress" type="button">Em andamento</button>' : ''}${req.status !== 'COMPLETED' ? '<button class="ghost requirement-complete" type="button">Concluir</button>' : ''}</div></div></div>`).join('') : '<div class="compliance-empty">Nenhuma exigência registrada para esta fiscalização.</div>'}</div>
      </article>`;
    }).join('') : '<div class="compliance-empty">Nenhuma fiscalização registrada.</div>';

    $('inspectionList').querySelectorAll('.compliance-open-file').forEach(button => button.onclick = () => openAttachment(button.dataset.path).catch(error => alert(readableError(error))));
    $('inspectionList').querySelectorAll('[data-inspection-id]').forEach(card => {
      const id = card.dataset.inspectionId;
      card.querySelector('.inspection-progress')?.addEventListener('click', () => updateInspectionStatus(id, 'IN_PROGRESS'));
      card.querySelector('.inspection-complete')?.addEventListener('click', () => completeInspection(id));
      card.querySelectorAll('[data-requirement-id]').forEach(requirementCard => {
        const requirementId = requirementCard.dataset.requirementId;
        requirementCard.querySelector('.requirement-progress')?.addEventListener('click', () => updateRequirementStatus(requirementId, 'IN_PROGRESS'));
        requirementCard.querySelector('.requirement-complete')?.addEventListener('click', () => completeRequirement(requirementId));
      });
    });
  }

  function render() {
    renderUnitOptions();
    renderKpis();
    renderDocuments();
    renderRequirementSelect();
    renderInspections();
    switchView(activeView);
  }

  async function refresh() {
    try { await load(); render(); window.NexusPreventiveAgenda?.render?.(); }
    catch (error) { console.error('Falha ao carregar documentação e fiscalizações.', error); }
  }

  async function submitDocument(event) {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    await window.NexusData.runLocked('company-document-create', async () => {
      const id = crypto.randomUUID();
      const file = $('companyDocumentFile').files[0];
      const path = file ? `${organizationId()}/compliance/documents/${id}/${safeName(file)}` : null;
      $('companyDocumentStatus').textContent = 'Salvando documento...';
      try {
        if (file) await upload(file, path);
        await window.NexusData.insert({ table:'company_documents', values:{ id, unit_id:$('companyDocumentUnit').value || null, document_type:$('companyDocumentType').value, authority_name:$('companyDocumentAuthority').value || null, document_number:$('companyDocumentNumber').value || null, issued_at:$('companyDocumentIssued').value || null, expires_at:$('companyDocumentExpires').value || null, responsible_name:$('companyDocumentResponsible').value || null, status:'ACTIVE', notes:$('companyDocumentNotes').value || null, attachment_path:path }, label:'documento da empresa' });
        event.currentTarget.reset();
        $('companyDocumentStatus').textContent = 'Documento salvo.';
        await refresh();
      } catch (error) {
        if (path) await removeUploaded(path);
        $('companyDocumentStatus').textContent = readableError(error);
      }
    }, button);
  }

  async function submitInspection(event) {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    await window.NexusData.runLocked('inspection-create', async () => {
      const id = crypto.randomUUID();
      const file = $('inspectionFile').files[0];
      const path = file ? `${organizationId()}/compliance/inspections/${id}/${safeName(file)}` : null;
      $('inspectionFormStatus').textContent = 'Salvando fiscalização...';
      try {
        if (file) await upload(file, path);
        await window.NexusData.insert({ table:'regulatory_inspections', values:{ id, unit_id:$('inspectionUnit').value || null, authority_name:$('inspectionAuthority').value, inspection_date:$('inspectionDate').value, notice_number:$('inspectionNoticeNumber').value || null, subject:$('inspectionSubject').value, description:$('inspectionDescription').value || null, priority:$('inspectionPriority').value, status:'OPEN', responsible_name:$('inspectionResponsible').value || null, notice_path:path }, label:'fiscalização' });
        event.currentTarget.reset();
        $('inspectionFormStatus').textContent = 'Fiscalização salva.';
        await refresh();
      } catch (error) {
        if (path) await removeUploaded(path);
        $('inspectionFormStatus').textContent = readableError(error);
      }
    }, button);
  }

  async function submitRequirement(event) {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    await window.NexusData.runLocked('requirement-create', async () => {
      const id = crypto.randomUUID();
      const file = $('requirementFile').files[0];
      const path = file ? `${organizationId()}/compliance/requirements/${id}/${safeName(file)}` : null;
      $('requirementFormStatus').textContent = 'Salvando exigência...';
      try {
        if (file) await upload(file, path);
        await window.NexusData.insert({ table:'regulatory_requirements', values:{ id, inspection_id:$('requirementInspection').value, description:$('requirementDescription').value, due_at:$('requirementDue').value, responsible_name:$('requirementResponsible').value || null, priority:$('requirementPriority').value, status:'PENDING', completion_notes:null, evidence_path:path }, label:'exigência da fiscalização' });
        event.currentTarget.reset();
        $('requirementFormStatus').textContent = 'Exigência salva e enviada para a Agenda Preventiva.';
        await refresh();
      } catch (error) {
        if (path) await removeUploaded(path);
        $('requirementFormStatus').textContent = readableError(error);
      }
    }, button);
  }

  async function updateDocumentStatus(id, status) {
    await window.NexusData.update({ table:'company_documents', id, values:{ status, updated_at:new Date().toISOString() }, label:'documento da empresa' });
    await refresh();
  }
  async function updateInspectionStatus(id, status) {
    await window.NexusData.update({ table:'regulatory_inspections', id, values:{ status, updated_at:new Date().toISOString() }, label:'fiscalização' });
    await refresh();
  }
  async function completeInspection(id) {
    const open = requirements.filter(item => same(item.inspection_id, id) && item.status !== 'COMPLETED');
    if (open.length) { alert(`Conclua primeiro ${open.length} exigência(s) pendente(s) desta fiscalização.`); return; }
    await updateInspectionStatus(id, 'COMPLETED');
  }
  async function updateRequirementStatus(id, status, completionNotes = null) {
    const values = { status, updated_at:new Date().toISOString() };
    if (completionNotes !== null) values.completion_notes = completionNotes;
    await window.NexusData.update({ table:'regulatory_requirements', id, values, label:'exigência da fiscalização' });
    await refresh();
  }
  async function completeRequirement(id) {
    const note = prompt('Informe uma observação de conclusão ou o que foi entregue:');
    if (note === null) return;
    if (!note.trim()) { alert('Informe uma observação de conclusão para preservar a evidência do atendimento.'); return; }
    await updateRequirementStatus(id, 'COMPLETED', note.trim());
  }

  function getDeadlines() {
    const companyName = (() => { try { return JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}').organizationName || 'Empresa'; } catch { return 'Empresa'; } })();
    const documentDeadlines = documents
      .filter(item => item.status === 'ACTIVE' && item.expires_at)
      .map(item => ({ id:`Documento:${item.id}`, type:'Documento', item:item.document_type, due:item.expires_at, status:deadlineStatus(item.expires_at), source:'document', subjectName:item.unit_id ? unitName(item.unit_id) : companyName, employeeId:null, unitId:item.unit_id || null, sectorId:null }));
    const inspectionDeadlines = requirements
      .filter(item => item.status !== 'COMPLETED' && item.due_at)
      .map(item => {
        const inspection = inspections.find(candidate => same(candidate.id, item.inspection_id));
        return { id:`Fiscalização:${item.id}`, type:'Fiscalização', item:item.description, due:item.due_at, status:deadlineStatus(item.due_at), source:'inspection', subjectName:inspection?.authority_name ? `${inspection.authority_name} · ${inspection.subject}` : 'Fiscalização', employeeId:null, unitId:inspection?.unit_id || null, sectorId:null };
      });
    return [...documentDeadlines, ...inspectionDeadlines];
  }

  function openModule(type) {
    document.querySelector('[data-tab="documentacao"]')?.click();
    switchView(type === 'Documento' ? 'documents' : 'inspections');
  }

  function install() {
    if (installed || !window.NexusData || !window.NEXUS_SST_APP) return;
    installed = true;
    installStyles();
    injectNavigation();
    injectSection();
    $('complianceShowDocuments').onclick = () => switchView('documents');
    $('complianceShowInspections').onclick = () => switchView('inspections');
    $('companyDocumentForm').onsubmit = submitDocument;
    $('regulatoryInspectionForm').onsubmit = submitInspection;
    $('regulatoryRequirementForm').onsubmit = submitRequirement;
    window.NexusCompanyCompliance = { refresh, render, getDeadlines, openModule, getData:() => ({ documents, inspections, requirements }) };
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true }); else install();
})();
