(() => {
  'use strict';

  if (window.__NEXUS_EPI_XLSX_COMPAT_V2__) return;
  window.__NEXUS_EPI_XLSX_COMPAT_V2__ = true;

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
    for (const sheetName of workbook.SheetNames || Object.keys(workbook.Sheets)) {
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
    if (!base || base.__nexusEpiCompatWrapped || typeof base.read !== 'function') return base;

    const wrapped = Object.create(base);
    Object.keys(base).forEach(key => {
      if (!(key in wrapped)) wrapped[key] = base[key];
    });

    wrapped.read = function nexusReadWithFlexibleEpiSheets(...args) {
      const workbook = base.read(...args);
      return normalizeWorkbook(base, workbook);
    };

    Object.defineProperty(wrapped, '__nexusEpiCompatWrapped', { value: true, configurable: true });
    return wrapped;
  }

  if (window.XLSX) {
    window.XLSX = wrapXlsx(window.XLSX);
    return;
  }

  let assignedValue;
  try {
    Object.defineProperty(window, 'XLSX', {
      configurable: true,
      enumerable: true,
      get() { return assignedValue; },
      set(value) {
        assignedValue = wrapXlsx(value);
        try {
          Object.defineProperty(window, 'XLSX', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: assignedValue
          });
        } catch {}
      }
    });
  } catch {
    const timer = setInterval(() => {
      if (!window.XLSX) return;
      clearInterval(timer);
      try { window.XLSX = wrapXlsx(window.XLSX); } catch {}
    }, 25);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();
