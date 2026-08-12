(() => {
  'use strict';

  if (window.__NEXUS_EPI_XLSX_COMPAT_V3__) return;
  window.__NEXUS_EPI_XLSX_COMPAT_V3__ = true;

  const normalize = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  function classifySheet(xlsx, sheetName, sheet) {
    const normalizedName = normalize(sheetName);
    if (normalizedName === 'catalogo') return 'Catálogo';
    if (normalizedName === 'compras' || normalizedName === 'compra') return 'Compras';
    if (normalizedName === 'entregas' || normalizedName === 'entrega') return 'Entregas';

    try {
      const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, range: 0 });
      const headers = (matrix?.[0] || []).map(normalize).filter(Boolean);
      const has = (...aliases) => aliases.some(alias => headers.includes(normalize(alias)));

      if (has('nome do epi', 'nome') && has('codigo / ca', 'código / ca', 'ca')) return 'Catálogo';
      if (has('codigo / ca', 'código / ca', 'ca') && has('data da compra') && has('quantidade', 'qtd')) return 'Compras';
      if (has('cpf', 'cpf colaborador') && has('codigo / ca', 'código / ca', 'ca') && has('data da entrega')) return 'Entregas';
    } catch (error) {
      console.warn('[Nexus EPI] Não foi possível identificar a aba pelos cabeçalhos.', error);
    }
    return null;
  }

  function normalizeWorkbook(xlsx, workbook) {
    if (!workbook?.Sheets) return workbook;
    const detected = {};
    const names = workbook.SheetNames || Object.keys(workbook.Sheets);

    for (const sheetName of names) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const canonical = classifySheet(xlsx, sheetName, sheet);
      if (canonical && !detected[canonical]) {
        workbook.Sheets[canonical] = sheet;
        detected[canonical] = sheetName;
      }
    }

    workbook.__nexusEpiDetectedSheets = detected;
    return workbook;
  }

  function wrapXlsx(base) {
    if (!base || typeof base.read !== 'function') return base;
    if (base.__nexusEpiCompatWrappedV3) return base;

    const originalRead = base.read.bind(base);
    const wrapped = Object.create(base);

    wrapped.read = function nexusReadWithFlexibleEpiSheets(...args) {
      const workbook = originalRead(...args);
      return normalizeWorkbook(base, workbook);
    };

    Object.defineProperty(wrapped, '__nexusEpiCompatWrappedV3', { value: true });
    return wrapped;
  }

  function patchNow() {
    if (!window.XLSX || typeof window.XLSX.read !== 'function') return false;
    try {
      window.XLSX = wrapXlsx(window.XLSX);
      return Boolean(window.XLSX?.__nexusEpiCompatWrappedV3);
    } catch (error) {
      console.warn('[Nexus EPI] Não foi possível ativar compatibilidade do leitor.', error);
      return false;
    }
  }

  if (patchNow()) return;

  // O SheetJS só é carregado quando o usuário seleciona um arquivo.
  // Observe esse carregamento sem timeout para não depender do tempo entre abrir a tela e escolher o arquivo.
  const observer = new MutationObserver(() => {
    const script = document.querySelector('script[data-nexus-xlsx]');
    if (!script || script.dataset.nexusEpiCompatWatching === 'true') return;
    script.dataset.nexusEpiCompatWatching = 'true';

    script.addEventListener('load', () => {
      if (patchNow()) observer.disconnect();
    }, { once: true });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Também cobre o caso em que o script apareceu entre a execução acima e o início do observer.
  const existingScript = document.querySelector('script[data-nexus-xlsx]');
  if (existingScript) {
    if (patchNow()) observer.disconnect();
    else if (existingScript.dataset.nexusEpiCompatWatching !== 'true') {
      existingScript.dataset.nexusEpiCompatWatching = 'true';
      existingScript.addEventListener('load', () => {
        if (patchNow()) observer.disconnect();
      }, { once: true });
    }
  }
})();
