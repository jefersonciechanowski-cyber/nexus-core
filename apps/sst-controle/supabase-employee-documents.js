(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const bucket = 'sst-documents';
  const mimeTypes = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp'
  };
  const documentLabels = {
    ASO: 'ASO', CERTIFICADO: 'Certificado / NR', FICHA_EPI: 'Ficha de EPI',
    OUTRO: 'Outro documento'
  };
  let documents = [];
  let selectedEmployeeId = null;
  let loaded = false;
  let installed = false;

  function appState() { return window.NEXUS_SST_APP?.getState?.(); }
  function employee(id) { return appState()?.employees?.find(item => String(item.id) === String(id)); }
  function organizationId() { return window.NexusData.getOrganizationId(); }
  function formatDate(iso) {
    const [year, month, day] = String(iso || '').slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '—';
  }
  function dateIso(value) {
    const d = value || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function daysUntil(value) {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    const now = new Date(`${dateIso()}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : Math.ceil((date - now) / 86400000);
  }
  function deadlineStatus(value) {
    const days = daysUntil(value);
    if (days === null) return 'MISSING';
    if (days < 0) return 'OVERDUE';
    if (days <= 7) return 'DUE_7';
    if (days <= 15) return 'DUE_15';
    if (days <= 30) return 'DUE_30';
    return 'PLANNED';
  }
  function safeFileName(file) {
    return String(file.name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'arquivo';
  }
  const trustedDriveDomains = new Set([
    'drive.google.com', 'docs.google.com', 'onedrive.live.com', '1drv.ms'
  ]);

  function normalizeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let url;
    try { url = new URL(raw); } catch {
      throw new Error('Informe um link válido do Google Drive ou OneDrive.');
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(trustedDriveDomains.has(hostname) || /^(?:[a-z0-9-]+[.])+sharepoint[.]com$/i.test(hostname)) ||
        url.href.length > 2048) {
      throw new Error('Utilize um link HTTPS do Google Drive ou OneDrive.');
    }
    return url.href;
  }

  function readableError(error) {
    const message = error?.cause?.message || error?.message || 'Não foi possível concluir a operação.';
    if (/schema cache|pgrst205/i.test(message)) {
      return 'A pasta documental ainda não foi habilitada no banco de dados.';
    }
    return message;
  }

  function installStyles() {
    if ($('employeeDocumentsStyles')) return;
    const style = document.createElement('style');
    style.id = 'employeeDocumentsStyles';
    style.textContent = `
      .employee-doc-overlay[hidden] { display:none !important; }
      .employee-doc-overlay { position:fixed; inset:0; z-index:2500; background:rgba(0,0,0,.65); display:grid; place-items:center; padding:16px; }
      .employee-doc-dialog { background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; width:min(780px,100%); max-height:min(90vh,900px); overflow:auto; padding:20px; box-shadow:0 18px 55px rgba(0,0,0,.2); }
      .employee-doc-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; }
      .employee-doc-heading h2 { font-size:17px; margin:0 0 5px; }
      .employee-doc-heading small { color:var(--text-muted); }
      .employee-doc-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .employee-doc-form label { display:grid; gap:5px; font-size:12px; color:var(--text-muted); }
      .employee-doc-form label small { line-height:1.5; font-size:11px; color:var(--text-muted); }
      .employee-doc-form .full { grid-column:1/-1; }
      .employee-doc-form button[type=submit] { justify-self:start; }
      .employee-doc-list { display:grid; gap:10px; margin-top:14px; }
      .employee-doc-card { border:1px solid var(--border); border-radius:10px; padding:13px; display:grid; gap:8px; }
      .employee-doc-card-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .employee-doc-card strong { font-size:13px; }
      .employee-doc-card small { color:var(--text-muted); font-size:11px; line-height:1.5; }
      .employee-doc-actions { display:flex; gap:8px; flex-wrap:wrap; }
      .employee-doc-status { min-height:16px; font-size:12px; margin-top:10px; color:var(--text-muted); }
      @media(max-width:650px) { .employee-doc-form { grid-template-columns:1fr; } .employee-doc-form .full { grid-column:auto; } .employee-doc-dialog { padding:15px; } }
    `;
    document.head.appendChild(style);
  }

  function installDialog() {
    if ($('employeeDocumentsOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'employeeDocumentsOverlay';
    overlay.className = 'employee-doc-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="employee-doc-dialog" role="dialog" aria-modal="true" aria-labelledby="employeeDocumentsTitle">
        <header class="employee-doc-heading">
          <div><h2 id="employeeDocumentsTitle">Documentos do colaborador</h2>
            <small>Histórico individual, anexos privados e validade</small></div>
          <button type="button" class="ghost" id="employeeDocumentsClose">Fechar</button>
        </header>
        <form id="employeeDocumentForm" class="employee-doc-form">
          <label>Tipo de documento
            <select id="employeeDocumentType" required>
              <option value="ASO">ASO</option>
              <option value="CERTIFICADO">Certificado / NR</option>
              <option value="FICHA_EPI">Ficha de EPI</option>
              <option value="OUTRO">Outro documento</option>
            </select>
          </label>
          <label>Identificação do documento
            <input id="employeeDocumentTitle" maxlength="180" required placeholder="Ex.: NR-35, ASO periódico">
          </label>
          <label>Data de emissão / realização
            <input id="employeeDocumentIssued" type="date">
          </label>
          <label>Data de vencimento (se houver)
            <input id="employeeDocumentExpires" type="date">
          </label>
          <label class="full">Anexar arquivo PDF ou imagem (até 10 MB) — opcional
            <input id="employeeDocumentFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp">
          </label>
          <label class="full">Link do Google Drive ou OneDrive — opcional
            <input id="employeeDocumentExternalUrl" type="url" inputmode="url" maxlength="2048"
              autocomplete="off" placeholder="https://drive.google.com/..." >
            <small>Informe um arquivo, um link ou ambos. O acesso ao link depende das permissões do Drive.</small>
          </label>
          <label class="full">Observações
            <textarea id="employeeDocumentNotes" maxlength="1500" rows="2" placeholder="Informações complementares (opcional)"></textarea>
          </label>
          <button type="submit">Salvar documento</button>
        </form>
        <div class="employee-doc-status" id="employeeDocumentStatus" role="status" aria-live="polite"></div>
        <h3 style="font-size:14px;margin:20px 0 8px">Documentos cadastrados</h3>
        <div class="employee-doc-list" id="employeeDocumentList"></div>
      </section>`;
    document.body.appendChild(overlay);
    $('employeeDocumentsClose').onclick = close;
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    $('employeeDocumentForm').addEventListener('submit', saveDocument);
  }

  function statusLabel(doc) {
    if (doc.status === 'ARCHIVED') return 'Arquivado';
    if (!doc.expires_at) return 'Sem vencimento';
    const labels = {
      OVERDUE: 'Vencido', DUE_7: 'Vence em até 7 dias',
      DUE_15: 'Vence em até 15 dias', DUE_30: 'Vence em até 30 dias',
      PLANNED: 'Em dia'
    };
    return labels[deadlineStatus(doc.expires_at)] || 'Sem vencimento';
  }

  function renderList() {
    const list = $('employeeDocumentList');
    if (!list) return;
    const rows = documents.filter(item => item.employee_id === selectedEmployeeId)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    list.innerHTML = rows.length ? rows.map(item => `
      <article class="employee-doc-card">
        <div class="employee-doc-card-header"><div>
          <strong>${escapeHtml(item.title)}</strong>
          <small style="display:block">${escapeHtml(documentLabels[item.document_type] || 'Documento')} · ${escapeHtml(statusLabel(item))}</small>
        </div></div>
        <small>Emissão: ${formatDate(item.issued_at)} · Vencimento: ${formatDate(item.expires_at)}</small>
        ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}
        <div class="employee-doc-actions">
          ${item.attachment_path ? `<button type="button" class="ghost" data-document-open="${escapeHtml(item.id)}">Abrir arquivo</button>` : ''}
          ${item.external_url ? `<button type="button" class="ghost" data-document-link="${escapeHtml(item.id)}">Abrir link do Drive</button>` : ''}
          ${item.status === 'ACTIVE' && window.NEXUS_DEMO_USER?.role !== 'hr' ? `<button type="button" class="ghost" data-document-archive="${escapeHtml(item.id)}">Arquivar</button>` : ''}
        </div>
      </article>`).join('') : '<div class="requirements-empty">Nenhum documento anexado a este colaborador.</div>';
    list.querySelectorAll('[data-document-open]').forEach(button => {
      button.onclick = () => openFile(button.dataset.documentOpen);
    });
    list.querySelectorAll('[data-document-link]').forEach(button => {
      button.onclick = () => openExternalLink(button.dataset.documentLink);
    });
    list.querySelectorAll('[data-document-archive]').forEach(button => {
      button.onclick = () => archiveDocument(button.dataset.documentArchive);
    });
  }

  async function refresh() {
    const rows = await window.NexusData.list({
      table: 'employee_documents',
      select: 'id,organization_id,employee_id,document_type,title,issued_at,expires_at,notes,attachment_path,external_url,status,created_at',
      order: { column: 'created_at', ascending: false }, label: 'documentos de colaboradores'
    });
    documents = rows;
    loaded = true;
    renderList();
    window.NexusPreventiveAgenda?.render?.();
    window.NexusAlertCenter?.render?.();
  }

  async function open(id) {
    const person = employee(id);
    if (!person) return;
    selectedEmployeeId = String(id);
    $('employeeDocumentForm').hidden = window.NEXUS_DEMO_USER?.role === 'hr';
    $('employeeDocumentsTitle').textContent = `Documentos — ${person.name}`;
    $('employeeDocumentStatus').textContent = '';
    $('employeeDocumentForm').reset();
    $('employeeDocumentsOverlay').hidden = false;
    if (!loaded) {
      $('employeeDocumentList').textContent = 'Carregando documentos...';
      try { await refresh(); } catch (error) {
        $('employeeDocumentStatus').textContent = readableError(error);
      }
    } else renderList();
    $('employeeDocumentsClose').focus();
  }

  function close() { $('employeeDocumentsOverlay').hidden = true; selectedEmployeeId = null; }

  async function saveDocument(event) {
    event.preventDefault();
    if (!selectedEmployeeId || !employee(selectedEmployeeId)) return;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const file = $('employeeDocumentFile').files[0];
    const extension = String(file?.name || '').split('.').pop().toLowerCase();
    const contentType = mimeTypes[extension];
    let externalUrl;
    try { externalUrl = normalizeExternalUrl($('employeeDocumentExternalUrl').value); }
    catch (error) {
      $('employeeDocumentStatus').textContent = error.message;
      return;
    }
    if (!file && !externalUrl) {
      $('employeeDocumentStatus').textContent = 'Anexe um arquivo ou informe um link do Drive.';
      return;
    }
    if (file && (!contentType || (file.type && file.type !== contentType) || !file.size || file.size > 10485760)) {
      $('employeeDocumentStatus').textContent = 'Envie um PDF ou imagem válida com até 10 MB.';
      return;
    }
    const issued = $('employeeDocumentIssued').value || null;
    const expires = $('employeeDocumentExpires').value || null;
    if (issued && expires && expires < issued) {
      $('employeeDocumentStatus').textContent = 'O vencimento não pode ser anterior à emissão.';
      return;
    }
    const employeeId = selectedEmployeeId;
    const values = {
      employee_id: employeeId,
      document_type: $('employeeDocumentType').value,
      title: $('employeeDocumentTitle').value.trim(),
      issued_at: issued, expires_at: expires,
      notes: $('employeeDocumentNotes').value.trim() || null,
      external_url: externalUrl
    };
    await window.NexusData.runLocked('employee-document-save', async () => {
      const id = crypto.randomUUID();
      const path = file ? `${organizationId()}/employees/${employeeId}/${id}/${safeFileName(file)}` : null;
      let uploaded = false;
      let committed = false;
      $('employeeDocumentStatus').textContent = 'Salvando documento...';
      try {
        if (file) {
          const { error } = await window.NexusData.getClient().storage
            .from(bucket).upload(path, file, { contentType, upsert: false });
          if (error) throw error;
          uploaded = true;
        }
        const rows = await window.NexusData.insert({
          table: 'employee_documents',
          values: { ...values, id, attachment_path: path },
          select: 'id',
          label: 'documento do colaborador'
        });
        if (!rows[0]) throw new Error('O documento não pôde ser confirmado.');
        committed = true;
        if (selectedEmployeeId === employeeId) form.reset();
        $('employeeDocumentStatus').textContent = 'Documento salvo com sucesso.';
        try { await refresh(); } catch (refreshError) {
          console.error('Documento salvo, mas a listagem não pôde ser atualizada.', refreshError);
          $('employeeDocumentStatus').textContent = 'Documento salvo. Atualize a página para conferir a listagem.';
        }
      } catch (error) {
        if (uploaded && !committed) {
          const cleanup = await window.NexusData.getClient().storage.from(bucket).remove([path]);
          if (cleanup.error) console.error('Anexo não vinculado exige limpeza administrativa.', cleanup.error);
        }
        $('employeeDocumentStatus').textContent = readableError(error);
      }
    }, button);
  }

  async function archiveDocument(id) {
    const doc = documents.find(item => item.id === id && item.employee_id === selectedEmployeeId);
    if (!doc || !window.confirm('Arquivar este documento? O arquivo e o histórico serão preservados.')) return;
    await window.NexusData.runLocked(`employee-document-archive-${id}`, async () => {
      try {
        const rows = await window.NexusData.update({
          table: 'employee_documents', id, values: { status: 'ARCHIVED' },
          select: 'id', label: 'documento do colaborador'
        });
        if (!rows[0]) throw new Error('O arquivamento não foi confirmado.');
        $('employeeDocumentStatus').textContent = 'Documento arquivado.';
        try { await refresh(); } catch (refreshError) {
          console.error('Arquivamento salvo, mas a listagem não foi atualizada.', refreshError);
          $('employeeDocumentStatus').textContent = 'Documento arquivado. Atualize a página para conferir a listagem.';
        }
      } catch (error) { $('employeeDocumentStatus').textContent = readableError(error); }
    });
  }

  async function openFile(id) {
    const doc = documents.find(item => item.id === id && item.employee_id === selectedEmployeeId);
    if (!doc?.attachment_path) return;
    const { data, error } = await window.NexusData.getClient().storage
      .from(bucket).createSignedUrl(doc.attachment_path, 600);
    if (error || !data?.signedUrl) {
      $('employeeDocumentStatus').textContent = readableError(error);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  function openExternalLink(id) {
    const doc = documents.find(item => item.id === id && item.employee_id === selectedEmployeeId);
    if (!doc?.external_url) return;
    try {
      const url = normalizeExternalUrl(doc.external_url);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      $('employeeDocumentStatus').textContent = error.message;
    }
  }

  function getDeadlines() {
    const people = appState()?.employees || [];
    return documents.filter(doc => doc.status === 'ACTIVE' && doc.expires_at).map(doc => {
      const person = people.find(item => String(item.id) === String(doc.employee_id));
      return person ? {
        id: `Documento:${doc.id}`, type: 'Documento', source: 'employee-document',
        item: doc.title, due: doc.expires_at, status: deadlineStatus(doc.expires_at),
        employeeId: doc.employee_id, subjectName: person.name,
        unitId: person.unitId || null, sectorId: person.sectorId || null
      } : null;
    }).filter(Boolean);
  }

  function install() {
    if (installed || !window.NexusData || !appState()) return;
    installed = true;
    if (!['nexus_admin','org_admin','sst_manager','sst_technician','hr'].includes(window.NEXUS_DEMO_USER?.role)) return;
    installStyles();
    installDialog();
    refresh().catch(error => console.error('Pasta documental indisponível:', readableError(error)));
  }

  window.NexusEmployeeDocuments = { open, refresh, getDeadlines };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else install();
})();
