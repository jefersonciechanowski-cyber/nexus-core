(() => {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const escapeAttr = escapeHtml;

  function formatDate(value) {
    if (!value) return '—';
    const parts = String(value).slice(0, 10).split('-');
    return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : escapeHtml(value);
  }

  function formatRegistration(type, value) {
    const raw = String(value || '').replace(/\D/g, '');
    if (type === 'CNPJ' && raw.length === 14) return raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (type === 'CPF' && raw.length === 11) return raw.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return value || 'Não informado';
  }

  function logoMarkup(url, fallback, className) {
    if (url) return `<img class="${className}" src="${escapeAttr(url)}" alt="${escapeAttr(fallback)}">`;
    return `<div class="logo-fallback ${className}">${escapeHtml(fallback)}</div>`;
  }

  function commonStyles(landscape = false) {
    return `
      :root { color-scheme:light; --ink:#0c1920; --muted:#52616a; --gold:#caa84b; --line:#d8dee2; --soft:#f4f7f8; --ok:#166534; --warn:#a16207; --bad:#b91c1c; }
      * { box-sizing:border-box; }
      html, body { margin:0; min-height:100%; background:#e9eef0; color:var(--ink); font-family:Arial, Helvetica, sans-serif; }
      body { padding:22px; }
      .print-toolbar { position:sticky; top:10px; z-index:10; display:flex; justify-content:center; gap:10px; margin:0 auto 18px; }
      .print-toolbar button { border:0; border-radius:7px; padding:10px 16px; background:var(--ink); color:#fff; font-weight:700; cursor:pointer; }
      .print-toolbar button.secondary { background:#fff; color:var(--ink); border:1px solid #cbd5e1; }
      .document { width:${landscape ? '297mm' : '210mm'}; min-height:${landscape ? '210mm' : '297mm'}; margin:0 auto; background:#fff; box-shadow:0 18px 45px rgba(15,23,42,.16); position:relative; }
      .document-header { display:grid; grid-template-columns:1fr auto 1fr; gap:18px; align-items:center; padding:12mm 14mm 7mm; border-bottom:2px solid var(--gold); }
      .document-header .company-brand { min-width:0; }
      .document-header .nexus-brand { text-align:right; }
      .company-logo { display:block; max-width:48mm; max-height:18mm; object-fit:contain; object-position:left center; }
      .nexus-logo { display:block; width:62mm; max-width:100%; max-height:18mm; margin-left:auto; object-fit:contain; object-position:right center; }
      .logo-fallback { display:flex; align-items:center; min-height:14mm; color:var(--ink); font-weight:800; font-size:12pt; line-height:1.15; }
      .logo-fallback.nexus-logo { justify-content:flex-end; color:#9b7b28; }
      .header-divider { width:1px; height:15mm; background:var(--line); }
      .document-title { padding:8mm 14mm 5mm; }
      .document-title .eyebrow { color:#987620; font-size:7.5pt; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
      .document-title h1 { margin:2.5mm 0 1.5mm; font-size:20pt; line-height:1.15; }
      .document-title p { margin:0; color:var(--muted); font-size:9pt; line-height:1.45; }
      .document-meta { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; padding:0 14mm 6mm; }
      .meta-item { padding:3mm; border:1px solid var(--line); border-radius:2mm; background:var(--soft); }
      .meta-item span { display:block; color:var(--muted); font-size:6.5pt; text-transform:uppercase; letter-spacing:.08em; }
      .meta-item strong { display:block; margin-top:1.2mm; font-size:8.5pt; overflow-wrap:anywhere; }
      .document-body { padding:0 14mm 19mm; }
      .section { margin-top:7mm; break-inside:avoid; }
      .section.break-before { break-before:page; padding-top:12mm; }
      .section h2 { margin:0 0 3mm; padding-bottom:2mm; border-bottom:1px solid var(--gold); font-size:12pt; }
      .section-note { margin:-1mm 0 3mm; color:var(--muted); font-size:7.5pt; line-height:1.45; }
      .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:3mm; }
      .summary-card { padding:4mm; border:1px solid var(--line); border-radius:2mm; background:var(--soft); }
      .summary-card span { display:block; color:var(--muted); font-size:7pt; }
      .summary-card strong { display:block; margin-top:1.2mm; font-size:16pt; }
      table { width:100%; border-collapse:collapse; table-layout:auto; font-size:7.2pt; }
      thead { display:table-header-group; }
      tr { break-inside:avoid; }
      th { padding:2.3mm 2mm; background:#eaf0f2; color:var(--ink); border:1px solid #cfd8dc; text-align:left; font-size:6.7pt; text-transform:uppercase; letter-spacing:.035em; }
      td { padding:2.2mm 2mm; border:1px solid #dce3e6; vertical-align:top; line-height:1.35; overflow-wrap:anywhere; }
      .date-value { display:inline-block; white-space:nowrap; overflow-wrap:normal; word-break:keep-all; }
      .date-pair { display:inline-flex; align-items:center; gap:1mm; white-space:nowrap; }
      .empty { padding:6mm; text-align:center; color:var(--muted); border:1px solid var(--line); }
      .status { display:inline-block; padding:1mm 2mm; border-radius:999px; font-size:6.2pt; font-weight:800; text-transform:uppercase; }
      .status.good { background:#dcfce7; color:var(--ok); }
      .status.attention { background:#fef3c7; color:var(--warn); }
      .status.critical { background:#fee2e2; color:var(--bad); }
      .status.neutral { background:#e2e8f0; color:#475569; }
      .legal-note { margin-top:7mm; padding:4mm; border-left:2px solid var(--gold); background:#fbfaf5; color:#475569; font-size:7pt; line-height:1.55; }
      .document-footer { position:absolute; left:14mm; right:14mm; bottom:7mm; display:flex; justify-content:space-between; gap:10mm; padding-top:2mm; border-top:1px solid var(--line); color:#64748b; font-size:6.5pt; }
      @page { size:A4 ${landscape ? 'landscape' : 'portrait'}; margin:0; }
      @media print {
        html, body { background:#fff; }
        body { padding:0; }
        .print-toolbar { display:none !important; }
        .document { width:100%; min-height:${landscape ? '210mm' : '297mm'}; box-shadow:none; margin:0; }
      }
    `;
  }

  function shell({ title, landscape = false, company, nexusLogoUrl, documentCode, issuedAt, issuedBy, subtitle, content, footerText }) {
    const companyName = company?.legal_name || company?.trade_name || company?.name || 'Empresa não identificada';
    const registration = company?.registration_type
      ? `${company.registration_type} ${formatRegistration(company.registration_type, company.registration_number)}`
      : 'Inscrição não informada';
    return `<!doctype html>
      <html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${commonStyles(landscape)}</style></head>
      <body>
        <div class="print-toolbar"><button type="button" onclick="window.print()">Salvar ou imprimir PDF</button><button type="button" class="secondary" onclick="window.close()">Fechar</button></div>
        <main class="document">
          <header class="document-header">
            <div class="company-brand">${logoMarkup(company?.logoUrl, companyName, 'company-logo')}</div>
            <div class="header-divider"></div>
            <div class="nexus-brand">${logoMarkup(nexusLogoUrl, 'Nexus Core - SST Controle', 'nexus-logo')}</div>
          </header>
          <div class="document-title"><span class="eyebrow">NexusSST · Documento gerencial</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle || companyName)}</p></div>
          <div class="document-meta">
            <div class="meta-item"><span>Empresa</span><strong>${escapeHtml(companyName)}</strong></div>
            <div class="meta-item"><span>Inscrição</span><strong>${escapeHtml(registration)}</strong></div>
            <div class="meta-item"><span>Emitido por</span><strong>${escapeHtml(issuedBy || 'Usuário autenticado')}</strong></div>
            <div class="meta-item"><span>Código de geração</span><strong>${escapeHtml(documentCode)}</strong></div>
          </div>
          <div class="document-body">${content}</div>
          <footer class="document-footer"><span>${escapeHtml(footerText || 'Documento gerado pelo NexusSST')}</span><span>Gerado em ${escapeHtml(issuedAt)}</span></footer>
        </main>
      </body></html>`;
  }

  function buildTrainingCertificate(data) {
    const company = data.company || {};
    const companyName = data.record.companyNameSnapshot || company.legal_name || company.trade_name || company.name || 'Empresa não identificada';
    const registrationType = data.record.companyRegistrationTypeSnapshot || company.registration_type;
    const registrationNumber = data.record.companyRegistrationNumberSnapshot || company.registration_number;
    const registration = registrationType ? `${registrationType} ${formatRegistration(registrationType, registrationNumber)}` : 'Inscrição não informada';
    const kind = { INITIAL:'Inicial', PERIODIC:'Periódico', EVENTUAL:'Eventual' }[data.record.trainingKind] || data.record.trainingKind;
    const modality = { IN_PERSON:'Presencial', ONLINE:'Online', HYBRID:'Híbrido' }[data.record.modality] || data.record.modality;
    const program = String(data.record.programContent || '').split(/\r?\n/).filter(Boolean).map(item => `<li>${escapeHtml(item)}</li>`).join('');
    const certStyles = `
      ${commonStyles(true)}
      .certificate { width:297mm; min-height:210mm; margin:0 auto; background:#fff; position:relative; padding:8mm; box-shadow:0 18px 45px rgba(15,23,42,.16); }
      .certificate-frame { min-height:194mm; border:1.2mm solid var(--ink); padding:2mm; position:relative; }
      .certificate-inner { min-height:187.5mm; border:.45mm solid var(--gold); padding:8mm 12mm 7mm; display:flex; flex-direction:column; }
      .certificate-brands { display:grid; grid-template-columns:1fr auto 1fr; gap:10mm; align-items:center; min-height:20mm; }
      .certificate-brands .nexus-logo { width:62mm; }
      .certificate-label { margin-top:5mm; color:#987620; text-align:center; font-size:8pt; font-weight:800; letter-spacing:.23em; text-transform:uppercase; }
      .certificate h1 { margin:2mm 0 1mm; text-align:center; font-size:25pt; letter-spacing:.03em; }
      .certificate-code { text-align:center; color:var(--muted); font-size:7.5pt; }
      .certificate-declaration { max-width:245mm; margin:7mm auto 5mm; text-align:center; font-family:Georgia, 'Times New Roman', serif; font-size:13pt; line-height:1.55; }
      .certificate-declaration strong { color:#8a6c20; }
      .certificate-details { display:grid; grid-template-columns:repeat(5,1fr); gap:2.5mm; margin:0 2mm 4mm; }
      .certificate-details .meta-item { padding:2.6mm; }
      .program { margin:0 2mm 4mm; padding:3mm 4mm; border:1px solid var(--line); background:var(--soft); }
      .program strong { display:block; margin-bottom:1.5mm; font-size:7pt; text-transform:uppercase; letter-spacing:.08em; }
      .program ul { display:grid; grid-template-columns:repeat(2,1fr); gap:1mm 6mm; margin:0; padding-left:5mm; font-size:7.5pt; line-height:1.4; }
      .certificate-people { display:grid; grid-template-columns:1fr 1fr; gap:7mm; margin:0 2mm 3mm; font-size:7.5pt; line-height:1.45; }
      .certificate-people div { padding:2.7mm 3mm; border-left:1mm solid var(--gold); background:#fbfaf5; }
      .signatures { display:grid; grid-template-columns:1fr 1fr; gap:28mm; margin:8mm 12mm 0; }
      .signature { padding-top:2mm; border-top:.35mm solid var(--ink); text-align:center; font-size:7pt; line-height:1.45; }
      .signature strong { display:block; font-size:8pt; }
      .certificate-note { margin-top:auto; padding-top:3mm; border-top:1px solid var(--line); color:#64748b; text-align:center; font-size:6.3pt; line-height:1.4; }
      @media print { .certificate { width:297mm; min-height:210mm; margin:0; box-shadow:none; } }
    `;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(data.documentCode)}</title><style>${certStyles}</style></head><body>
      <div class="print-toolbar"><button type="button" onclick="window.print()">Salvar ou imprimir certificado</button><button type="button" class="secondary" onclick="window.close()">Fechar</button></div>
      <main class="certificate"><div class="certificate-frame"><div class="certificate-inner">
        <div class="certificate-brands"><div>${logoMarkup(company.logoUrl, companyName, 'company-logo')}</div><div class="header-divider"></div><div>${logoMarkup(data.nexusLogoUrl, 'Nexus Core - SST Controle', 'nexus-logo')}</div></div>
        <div class="certificate-label">Certificado de capacitação em saúde e segurança do trabalho</div>
        <h1>CERTIFICADO</h1><div class="certificate-code">${escapeHtml(data.documentCode)} · Registro ${escapeHtml(data.record.code)}</div>
        <p class="certificate-declaration">Certificamos que <strong>${escapeHtml(data.record.employeeNameSnapshot || data.employee?.name)}</strong> concluiu o treinamento <strong>${escapeHtml(data.record.trainingName)}</strong>, promovido por <strong>${escapeHtml(companyName)}</strong> (${escapeHtml(registration)}).</p>
        <div class="certificate-details">
          <div class="meta-item"><span>Natureza</span><strong>${escapeHtml(kind)}</strong></div>
          <div class="meta-item"><span>Realização</span><strong>${formatDate(data.record.date)}</strong></div>
          <div class="meta-item"><span>Carga horária</span><strong>${escapeHtml(data.record.workloadHours)} horas</strong></div>
          <div class="meta-item"><span>Modalidade</span><strong>${escapeHtml(modality)}</strong></div>
          <div class="meta-item"><span>Validade registrada</span><strong>${formatDate(data.record.due)}</strong></div>
        </div>
        <div class="program"><strong>Conteúdo programático</strong><ul>${program || '<li>Conteúdo não informado</li>'}</ul></div>
        <div class="certificate-people">
          <div><strong>Local:</strong> ${escapeHtml(data.record.location)}<br><strong>Instrutor:</strong> ${escapeHtml(data.record.instructor)}${data.record.instructorEntity ? ` · ${escapeHtml(data.record.instructorEntity)}` : ''}<br><strong>Qualificação:</strong> ${escapeHtml(data.record.instructorDocument)}</div>
          <div><strong>Responsável técnico:</strong> ${escapeHtml(data.record.technicalResponsible)}<br><strong>Qualificação / registro:</strong> ${escapeHtml(data.record.technicalResponsibleQualification)}<br><strong>Emissão:</strong> ${escapeHtml(data.issuedAt)} por ${escapeHtml(data.issuedBy || 'usuário autenticado')}</div>
        </div>
        <div class="signatures"><div class="signature"><strong>${escapeHtml(data.record.employeeNameSnapshot || data.employee?.name)}</strong>Assinatura do trabalhador</div><div class="signature"><strong>${escapeHtml(data.record.technicalResponsible)}</strong>Assinatura do responsável técnico</div></div>
        <div class="certificate-note">Certificado preparado com os campos documentais previstos no item 1.7.1.1 da NR-1. As assinaturas do trabalhador e do responsável técnico devem ser apostas antes do arquivamento e da disponibilização ao trabalhador. Uma cópia deve permanecer arquivada na organização.</div>
      </div></div></main></body></html>`;
  }

  function rowsTable(headers, rows, emptyText) {
    if (!rows?.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
    return `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell?.html ? cell.html : escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function buildInspectionDossier(data) {
    const summary = data.summary.map(item => `<div class="summary-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join('');
    const content = `
      <section class="section"><h2>1. Escopo e resumo executivo</h2><p class="section-note">A situação dos requisitos é apresentada na data de emissão. Os registros operacionais respeitam o período selecionado.</p><div class="summary-grid">${summary}</div></section>
      <section class="section"><h2>2. Pendências e requisitos atuais</h2>${rowsTable(['Colaborador', 'Unidade / setor', 'Tipo', 'Requisito', 'Situação', 'Detalhe'], data.pendingRows, 'Nenhuma pendência foi identificada no escopo selecionado.')}</section>
      <section class="section break-before"><h2>3. Treinamentos registrados no período</h2>${rowsTable(['Código', 'Colaborador', 'Treinamento', 'Realização / validade', 'Instrutor / responsável técnico', 'Situação'], data.trainingRows, 'Nenhum treinamento foi registrado no período selecionado.')}</section>
      <section class="section"><h2>4. Movimentações de EPI no período</h2>${rowsTable(['Data', 'Colaborador', 'EPI', 'Movimentação', 'Prazo / próxima troca', 'Responsável'], data.epiRows, 'Nenhuma movimentação de EPI foi registrada no período selecionado.')}</section>
      <section class="section break-before"><h2>5. Ocorrências e incidentes no período</h2>${rowsTable(['Código', 'Data', 'Colaborador', 'Tipo', 'Severidade', 'Situação / descrição'], data.occurrenceRows, 'Nenhuma ocorrência foi registrada no período selecionado.')}</section>
      <section class="section"><h2>6. Exames e coletas no período</h2>${rowsTable(['Data', 'Colaborador', 'Exame', 'Coleta', 'Resultado', 'Situação'], data.examRows, 'Nenhuma coleta foi registrada no período selecionado.')}</section>
      <section class="section break-before"><h2>7. Matriz de requisitos aplicável</h2>${rowsTable(['Unidade', 'Setor', 'Função', 'Tipo', 'Requisito', 'Validade'], data.matrixRows, 'Nenhuma regra da Matriz foi encontrada no escopo selecionado.')}</section>
      <div class="legal-note"><strong>Nota de uso:</strong> este dossiê organiza evidências registradas no NexusSST para apoio à gestão e à fiscalização. Ele não substitui PGR, PCMSO, laudos, prontuários, documentos específicos das Normas Regulamentadoras, certificados assinados ou outros registros legalmente exigidos.</div>`;
    return shell({
      title: 'Dossiê de Evidências SST',
      company: data.company,
      nexusLogoUrl: data.nexusLogoUrl,
      documentCode: data.documentCode,
      issuedAt: data.issuedAt,
      issuedBy: data.issuedBy,
      subtitle: data.scopeLabel,
      content,
      footerText: 'NexusSST · Dossiê de apoio à fiscalização'
    });
  }

  function buildReport(data) {
    const content = `<section class="section"><h2>${escapeHtml(data.title)}</h2><p class="section-note">Relatório emitido com os filtros e dados apresentados na prévia do NexusSST.</p>${data.tableHtml}</section><div class="legal-note">Documento gerencial gerado a partir dos registros da empresa no NexusSST. Verifique assinaturas e documentos complementares quando exigidos.</div>`;
    return shell({
      title: data.title,
      company: data.company,
      nexusLogoUrl: data.nexusLogoUrl,
      documentCode: data.documentCode,
      issuedAt: data.issuedAt,
      issuedBy: data.issuedBy,
      subtitle: 'Relatório personalizado de Saúde e Segurança do Trabalho',
      content,
      footerText: 'NexusSST · Relatório personalizado'
    });
  }

  window.NexusDocumentTemplates = {
    buildTrainingCertificate,
    buildInspectionDossier,
    buildReport,
    formatDate,
    formatRegistration,
    escapeHtml
  };
})();
