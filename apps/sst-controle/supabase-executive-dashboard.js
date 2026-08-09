(() => {
  'use strict';

  let moduleChart;
  let priorityChart;
  let monthlyChart;

  const byId = id => document.getElementById(id);
  const text = (id, value) => { const element = byId(id); if (element) element.textContent = value; };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
  const same = (left, right) => String(left ?? '') === String(right ?? '');
  const todayIso = () => {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  function state() {
    return window.NEXUS_SST_APP?.getState?.();
  }

  function filters() {
    return {
      unitId: byId('execUnit')?.value || '',
      sectorId: byId('execSector')?.value || '',
      employeeId: byId('execEmployee')?.value || '',
      period: byId('execPeriod')?.value || 'all',
      datePreset: byId('execDatePreset')?.value || 'current-month',
      dateStart: byId('execDateStart')?.value || '',
      dateEnd: byId('execDateEnd')?.value || '',
      compareMode: byId('execCompareMode')?.value || 'previous'
    };
  }

  function dateOnly(value) {
    return String(value || '').slice(0, 10);
  }

  function formatDate(value) {
    const date = dateOnly(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return value || '—';
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  }

  function parseDate(value) {
    const date = dateOnly(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
    return parsed;
  }

  function dateToIso(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addCalendarDays(value, days) {
    const date = parseDate(value);
    if (!date) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return dateToIso(date);
  }

  function shiftMonths(value, months) {
    const date = parseDate(value);
    if (!date) return '';
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + Number(months || 0));
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, lastDay));
    return dateToIso(date);
  }

  function shiftYears(value, years) {
    const date = parseDate(value);
    if (!date) return '';
    const month = date.getMonth();
    date.setFullYear(date.getFullYear() + Number(years || 0));
    if (date.getMonth() !== month) date.setDate(0);
    return dateToIso(date);
  }

  function startOfMonth(value) {
    const date = parseDate(value);
    if (!date) return '';
    date.setDate(1);
    return dateToIso(date);
  }

  function endOfMonth(value) {
    const date = parseDate(value);
    if (!date) return '';
    date.setMonth(date.getMonth() + 1, 0);
    return dateToIso(date);
  }

  function normalizeRange(start, end) {
    const validStart = dateOnly(start);
    const validEnd = dateOnly(end);
    if (!parseDate(validStart) || !parseDate(validEnd)) return null;
    return validStart <= validEnd ? { start: validStart, end: validEnd } : { start: validEnd, end: validStart };
  }

  function analysisRange(selected, availableDates = []) {
    const today = todayIso();
    const monthStart = startOfMonth(today);
    const preset = selected.datePreset;
    let range;
    if (preset === 'previous-month') {
      const start = shiftMonths(monthStart, -1);
      range = { start, end: endOfMonth(start) };
    } else if (/^last-(3|6|12)-months$/.test(preset)) {
      const months = Number(preset.match(/\d+/)[0]);
      range = { start: shiftMonths(monthStart, -(months - 1)), end: today };
    } else if (preset === 'custom') {
      range = normalizeRange(selected.dateStart, selected.dateEnd);
    } else if (preset === 'all') {
      const dates = availableDates.map(dateOnly).filter(value => parseDate(value)).sort();
      range = { start: dates[0] || monthStart, end: dates.at(-1) > today ? dates.at(-1) : today };
    } else {
      range = { start: monthStart, end: today };
    }
    return range || { start: monthStart, end: today };
  }

  function comparisonRange(range, selected) {
    if (selected.compareMode === 'previous-year') {
      return { start: shiftYears(range.start, -1), end: shiftYears(range.end, -1) };
    }
    const presetMonths = { 'current-month': 1, 'previous-month': 1, 'last-3-months': 3, 'last-6-months': 6, 'last-12-months': 12 }[selected.datePreset];
    if (presetMonths) return { start: shiftMonths(range.start, -presetMonths), end: shiftMonths(range.end, -presetMonths) };
    const startDate = parseDate(range.start);
    const endDate = parseDate(range.end);
    const days = Math.round((endDate - startDate) / 86400000) + 1;
    const end = addCalendarDays(range.start, -1);
    return { start: addCalendarDays(end, -(days - 1)), end };
  }

  function dateInRange(value, range) {
    const date = dateOnly(value);
    return Boolean(parseDate(date) && date >= range.start && date <= range.end);
  }

  function formatRange(range) {
    return `${formatDate(range.start)} a ${formatDate(range.end)}`;
  }

  function isOngoingMonth(range) {
    const today = todayIso();
    return range.start <= today && range.end >= startOfMonth(today) && today < endOfMonth(today);
  }

  function addDays(date, days) {
    if (!date || !Number.isFinite(Number(days))) return '';
    const result = new Date(`${dateOnly(date)}T12:00:00`);
    result.setDate(result.getDate() + Number(days));
    return result.toISOString().slice(0, 10);
  }

  function daysUntil(value) {
    const date = dateOnly(value);
    if (!date) return null;
    const target = new Date(`${date}T12:00:00`);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return Math.ceil((target - now) / 86400000);
  }

  function normalizedStatus(value) {
    const status = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (status.includes('CRIT')) return 'CRÍTICO';
    if (status.includes('ATEN')) return 'ATENÇÃO';
    if (status.includes('BOM')) return 'BOM';
    return 'SEM PARÂMETRO';
  }

  function dueStatus(value, attentionDays = 30) {
    const days = daysUntil(value);
    if (days === null || !Number.isFinite(days)) return 'SEM PARÂMETRO';
    if (days < 0) return 'CRÍTICO';
    if (days <= attentionDays) return 'ATENÇÃO';
    return 'BOM';
  }

  function severityLevel(record) {
    const severity = String(record?.severityCode || record?.severity || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    if (severity === 'HIGH' || severity.includes('ALTA') || severity.includes('CRIT')) return 'HIGH';
    if (severity === 'MEDIUM' || severity.includes('MEDIA')) return 'MEDIUM';
    return 'LOW';
  }

  function severityLabel(record) {
    return { HIGH: 'Alta / Crítica', MEDIUM: 'Média', LOW: 'Baixa' }[severityLevel(record)];
  }

  function badge(label, level = 'unknown') {
    const cssClass = { good: 'badge-bom', attention: 'badge-atencao', critical: 'badge-critico', unknown: 'badge-sem' }[level] || 'badge-sem';
    return `<span class="badge ${cssClass}">${escapeHtml(label)}</span>`;
  }

  function setBadge(id, label, level) {
    const element = byId(id);
    if (!element) return;
    element.className = `badge ${{ good: 'badge-bom', attention: 'badge-atencao', critical: 'badge-critico', unknown: 'badge-sem' }[level] || 'badge-sem'}`;
    element.textContent = label;
  }

  function setCardLevel(id, level) {
    const element = byId(id);
    if (element) element.dataset.level = level;
  }

  function employeeMatches(employee, selected) {
    if (!employee) return false;
    return (!selected.unitId || same(employee.unitId, selected.unitId))
      && (!selected.sectorId || same(employee.sectorId, selected.sectorId))
      && (!selected.employeeId || same(employee.id, selected.employeeId));
  }

  function recordMatches(record, employee, selected) {
    const unitId = record?.unitId || employee?.unitId;
    const sectorId = record?.sectorId || employee?.sectorId;
    return (!selected.unitId || same(unitId, selected.unitId))
      && (!selected.sectorId || same(sectorId, selected.sectorId))
      && (!selected.employeeId || same(record?.employeeId || employee?.id, selected.employeeId));
  }

  function ruleMatchesEmployee(rule, employee) {
    if (!employee || rule?.active === false) return false;
    if (rule.effective && rule.effective > todayIso()) return false;
    return (!rule.unitId || same(rule.unitId, employee.unitId))
      && (!rule.sectorId || same(rule.sectorId, employee.sectorId))
      && (!rule.jobRoleId || same(rule.jobRoleId, employee.jobRoleId));
  }

  function ruleSpecificity(rule) {
    return Number(Boolean(rule.unitId)) + (Number(Boolean(rule.sectorId)) * 2) + (Number(Boolean(rule.jobRoleId)) * 4);
  }

  function applicableRules(current, employee, type) {
    const rules = current.matrixRules
      .filter(rule => rule.type === type && ruleMatchesEmployee(rule, employee))
      .sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left) || String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    const unique = new Map();
    rules.forEach(rule => {
      const key = String(rule.itemId || rule.itemName || rule.id);
      if (!unique.has(key)) unique.set(key, rule);
    });
    return [...unique.values()];
  }

  function latestRecord(records, predicate, dateField = 'date') {
    return records.filter(predicate).sort((left, right) => String(right[dateField] || '').localeCompare(String(left[dateField] || '')))[0];
  }

  function trainingRows(current, employees) {
    const rows = [];
    employees.forEach(employee => {
      applicableRules(current, employee, 'Treinamento').forEach(rule => {
        const record = latestRecord(current.trainingRecords, item => same(item.employeeId, employee.id) && same(item.trainingTypeId, rule.itemId));
        const due = record?.due || (record?.date && rule.validity ? addDays(record.date, rule.validity) : '');
        rows.push({ employee, rule, record, due, missing: !record, status: record ? dueStatus(due, 30) : 'CRÍTICO' });
      });
    });
    return rows;
  }

  function epiRequirementRows(current, employees) {
    const rows = [];
    employees.forEach(employee => {
      applicableRules(current, employee, 'EPI').forEach(rule => {
        const delivery = latestRecord(current.epiMovements, item => item.status === 'Entregue' && item.isActive && same(item.employeeId, employee.id) && same(item.epiId, rule.itemId));
        const validity = Number(delivery?.appliedValidity || rule.validity || 0);
        const due = delivery?.dueDate || (delivery?.date && validity ? addDays(delivery.date, validity) : '');
        rows.push({ employee, rule, delivery, due, missing: !delivery, status: delivery ? dueStatus(due, 15) : 'CRÍTICO' });
      });
    });
    return rows;
  }

  function priorityPeriodMatches(due, period) {
    if (!due) return true;
    const days = daysUntil(due);
    if (period === '30') return days !== null && days >= 0 && days <= 30;
    if (period === 'expired') return days !== null && days < 0;
    return true;
  }

  function resultLabel(collection, current) {
    const exam = current.exams.find(item => same(item.id, collection.examId));
    const name = exam?.name || collection.examNameSnapshot || 'Exame';
    const result = collection.qualitativeResult || collection.value;
    const unit = collection.measurementUnitSnapshot ? ` ${collection.measurementUnitSnapshot}` : '';
    return `${name}: ${result ?? 'sem resultado'}${collection.qualitativeResult ? '' : unit}`;
  }

  function moduleLevel(hasData, critical, attention) {
    if (!hasData) return 'unknown';
    if (critical > 0) return 'critical';
    if (attention > 0) return 'attention';
    return 'good';
  }

  function moduleLabel(level, goodLabel = 'Regular') {
    return { unknown: 'Dados insuficientes', critical: 'Ação necessária', attention: 'Exige atenção', good: goodLabel }[level];
  }

  function periodMetrics(sources, range) {
    const collections = sources.collections.filter(item => dateInRange(item.date, range));
    const trainingRecords = sources.trainingRecords.filter(item => dateInRange(item.date, range));
    const movements = sources.movements.filter(item => dateInRange(item.date, range));
    const occurrences = sources.occurrences.filter(item => item.status !== 'CANCELLED' && dateInRange(item.date, range));
    const cancelledOccurrences = sources.occurrences.filter(item => item.status === 'CANCELLED' && dateInRange(item.cancelledAt || item.date, range));
    const matrixRules = sources.matrixRules.filter(item => dateInRange(item.createdAt || item.effective, range));
    return {
      collectionsTotal: collections.length,
      collectionsGood: collections.filter(item => normalizedStatus(item.status) === 'BOM').length,
      collectionsCritical: collections.filter(item => normalizedStatus(item.status) === 'CRÍTICO').length,
      trainingsCompleted: trainingRecords.length,
      epiDeliveries: movements.filter(item => item.status === 'Entregue').length,
      epiReturns: movements.filter(item => item.status === 'Devolvido').length,
      epiDisposals: movements.filter(item => item.status === 'Descartado').length,
      occurrencesTotal: occurrences.length,
      occurrencesRelevant: occurrences.filter(item => severityLevel(item) !== 'LOW').length,
      occurrencesCancelled: cancelledOccurrences.length,
      matrixRulesCreated: matrixRules.length
    };
  }

  function comparisonResult(current, previous, preference, available = true) {
    if (!available) return { result: 'unknown', variation: 'N/D', label: 'Dados insuficientes' };
    const delta = current - previous;
    if (preference === 'neutral') {
      const variation = previous === 0 ? (current === 0 ? '0%' : 'Novo') : `${delta > 0 ? '+' : ''}${Math.round(delta / previous * 100)}%`;
      return { result: 'informative', variation, label: 'Informativo' };
    }
    if (delta === 0) return { result: 'stable', variation: '0%', label: 'Estável' };
    const improved = preference === 'lower' ? delta < 0 : delta > 0;
    const variation = previous === 0 ? 'Sem base' : `${delta > 0 ? '+' : ''}${Math.round(delta / previous * 100)}%`;
    return { result: improved ? 'improved' : 'worsened', variation, label: improved ? 'Melhorou' : 'Piorou' };
  }

  function renderComparisonTrend(ids, metric) {
    text(ids.value, metric.available ? metric.current : '—');
    text(ids.previous, metric.available ? `Comparação: ${metric.previous}` : 'Sem dados para comparar');
    const element = byId(ids.trend);
    if (!element) return;
    element.dataset.result = metric.comparison.result === 'unknown' ? 'stable' : metric.comparison.result;
    element.textContent = metric.comparison.result === 'unknown'
      ? 'Sem dados'
      : `${metric.comparison.label}${metric.comparison.variation === '0%' ? '' : ` · ${metric.comparison.variation}`}`;
  }

  function monthKeys(start, end, maximum = 12) {
    const first = parseDate(start);
    const last = parseDate(end);
    if (!first || !last) return [];
    first.setDate(1);
    last.setDate(1);
    const keys = [];
    while (first <= last && keys.length < 240) {
      keys.push(dateToIso(first).slice(0, 7));
      first.setMonth(first.getMonth() + 1);
    }
    return keys.slice(-maximum);
  }

  function monthLabel(key) {
    const [year, month] = key.split('-');
    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${labels[Number(month) - 1]}/${year.slice(2)}`;
  }

  function monthCounts(records, keys, predicate = () => true, dateField = 'date') {
    return keys.map(key => records.filter(item => predicate(item) && dateOnly(item[dateField]).slice(0, 7) === key).length);
  }

  function comparisonDefinitions(currentMetrics, previousMetrics, availability) {
    return [
      { module: 'Coletas', label: 'Coletas realizadas', key: 'collectionsTotal', preference: 'neutral', available: availability.collections },
      { module: 'Coletas', label: 'Dentro do parâmetro', key: 'collectionsGood', preference: 'higher', available: availability.collections },
      { module: 'Coletas', label: 'Resultados críticos', key: 'collectionsCritical', preference: 'lower', available: availability.collections },
      { module: 'Treinamentos', label: 'Treinamentos realizados', key: 'trainingsCompleted', preference: 'higher', available: availability.trainings },
      { module: 'EPIs', label: 'Entregas realizadas', key: 'epiDeliveries', preference: 'neutral', available: availability.epis },
      { module: 'EPIs', label: 'Devoluções registradas', key: 'epiReturns', preference: 'neutral', available: availability.epis },
      { module: 'EPIs', label: 'Descartes registrados', key: 'epiDisposals', preference: 'neutral', available: availability.epis },
      { module: 'Ocorrências', label: 'Ocorrências registradas', key: 'occurrencesTotal', preference: 'lower', available: availability.occurrences },
      { module: 'Ocorrências', label: 'Ocorrências médias / altas', key: 'occurrencesRelevant', preference: 'lower', available: availability.occurrences },
      { module: 'Ocorrências', label: 'Registros cancelados', key: 'occurrencesCancelled', preference: 'neutral', available: availability.occurrences },
      { module: 'Matriz', label: 'Regras criadas', key: 'matrixRulesCreated', preference: 'neutral', available: availability.matrix }
    ].map(definition => {
      const current = currentMetrics[definition.key];
      const previous = previousMetrics[definition.key];
      return { ...definition, current, previous, comparison: comparisonResult(current, previous, definition.preference, definition.available) };
    });
  }

  function render() {
    const current = state();
    if (!current || !byId('execEmployees')) return;

    const selected = filters();
    const employeeMap = new Map(current.employees.map(employee => [String(employee.id), employee]));
    const sectorMap = new Map(current.sectors.map(sector => [String(sector.id), sector]));
    const epiMap = new Map(current.epis.map(epi => [String(epi.id), epi]));
    const trainingMap = new Map(current.trainingTypes.map(training => [String(training.id), training]));
    const employees = current.employees.filter(employee => employeeMatches(employee, selected));
    const employeeIds = new Set(employees.map(employee => String(employee.id)));
    const collections = current.collections.filter(collection => employeeIds.has(String(collection.employeeId)));
    const occurrences = current.risks.filter(occurrence => recordMatches(occurrence, employeeMap.get(String(occurrence.employeeId)), selected));
    const movements = current.epiMovements.filter(movement => recordMatches(movement, employeeMap.get(String(movement.employeeId)), selected));
    const trainingRecords = current.trainingRecords.filter(record => employeeIds.has(String(record.employeeId)));
    const trainings = trainingRows(current, employees);
    const epiRequirements = epiRequirementRows(current, employees);

    const collectionGood = collections.filter(item => normalizedStatus(item.status) === 'BOM').length;
    const collectionAttention = collections.filter(item => normalizedStatus(item.status) === 'ATENÇÃO').length;
    const collectionCritical = collections.filter(item => normalizedStatus(item.status) === 'CRÍTICO').length;
    const collectionEvaluated = collectionGood + collectionAttention + collectionCritical;

    const trainingGood = trainings.filter(item => item.status === 'BOM').length;
    const trainingAttention = trainings.filter(item => item.status === 'ATENÇÃO').length;
    const trainingCritical = trainings.filter(item => item.status === 'CRÍTICO').length;
    const visibleTrainingAlerts = trainings.filter(item => (item.status === 'CRÍTICO' || item.status === 'ATENÇÃO') && (item.missing || priorityPeriodMatches(item.due, selected.period)));

    const activeDeliveries = movements.filter(item => item.status === 'Entregue' && item.isActive);
    const returnedDeliveries = movements.filter(item => item.status === 'Devolvido');
    const discardedDeliveries = movements.filter(item => item.status === 'Descartado');
    const epiAlerts = epiRequirements.filter(item => item.status === 'CRÍTICO' || item.status === 'ATENÇÃO');
    const visibleEpiAlerts = epiAlerts.filter(item => item.missing || priorityPeriodMatches(item.due, selected.period));
    const epiCritical = epiRequirements.filter(item => item.status === 'CRÍTICO').length;
    const epiAttention = epiRequirements.filter(item => item.status === 'ATENÇÃO').length;
    const purchasedUnits = current.epiPurchases.reduce((sum, purchase) => sum + Number(purchase.quantity || 0), 0);
    const organizationActiveDeliveries = current.epiMovements.filter(item => item.status === 'Entregue' && item.isActive).length;
    const organizationDiscarded = current.epiMovements.filter(item => item.status === 'Descartado').length;
    const stockAvailable = purchasedUnits - organizationActiveDeliveries - organizationDiscarded;

    const openOccurrences = occurrences.filter(item => item.status !== 'CANCELLED');
    const cancelledOccurrences = occurrences.filter(item => item.status === 'CANCELLED');
    const mediumOccurrences = openOccurrences.filter(item => severityLevel(item) === 'MEDIUM');
    const highOccurrences = openOccurrences.filter(item => severityLevel(item) === 'HIGH');
    const relevantOccurrences = mediumOccurrences.length + highOccurrences.length;

    const matrixRules = current.matrixRules.filter(rule => {
      if (rule.active === false) return false;
      if (selected.employeeId) return employees[0] ? ruleMatchesEmployee(rule, employees[0]) : false;
      return (!selected.unitId || !rule.unitId || same(rule.unitId, selected.unitId))
        && (!selected.sectorId || !rule.sectorId || same(rule.sectorId, selected.sectorId));
    });
    const matrixExam = matrixRules.filter(rule => rule.type === 'Exame').length;
    const matrixTraining = matrixRules.filter(rule => rule.type === 'Treinamento').length;
    const matrixEpi = matrixRules.filter(rule => rule.type === 'EPI').length;
    const employeesWithRules = employees.filter(employee => current.matrixRules.some(rule => ruleMatchesEmployee(rule, employee))).length;

    const comparisonSources = { collections, occurrences, movements, trainingRecords, matrixRules };
    const availableDates = [
      ...collections.map(item => item.date),
      ...occurrences.flatMap(item => [item.date, item.cancelledAt]),
      ...movements.map(item => item.date),
      ...trainingRecords.map(item => item.date),
      ...matrixRules.map(item => item.createdAt || item.effective)
    ];
    const selectedRange = analysisRange(selected, availableDates);
    const previousRange = comparisonRange(selectedRange, selected);
    if (selected.datePreset !== 'custom') {
      if (byId('execDateStart')) byId('execDateStart').value = selectedRange.start;
      if (byId('execDateEnd')) byId('execDateEnd').value = selectedRange.end;
    }
    const currentPeriodMetrics = periodMetrics(comparisonSources, selectedRange);
    const previousPeriodMetrics = periodMetrics(comparisonSources, previousRange);
    const comparisonAvailability = {
      collections: collections.length > 0,
      trainings: trainingRecords.length > 0,
      epis: movements.length > 0,
      occurrences: occurrences.length > 0,
      matrix: matrixRules.length > 0
    };
    const comparisons = comparisonDefinitions(currentPeriodMetrics, previousPeriodMetrics, comparisonAvailability);

    const collectionLevel = moduleLevel(collections.length > 0, collectionCritical, collectionAttention);
    const trainingLevel = moduleLevel(trainings.length > 0, trainingCritical, trainingAttention);
    const epiHasData = epiRequirements.length > 0 || movements.length > 0 || current.epiPurchases.length > 0;
    const epiLevel = moduleLevel(epiHasData, epiCritical, epiAttention);
    const occurrenceLevel = moduleLevel(occurrences.length > 0, highOccurrences.length, openOccurrences.length - highOccurrences.length);
    const matrixLevel = matrixRules.length ? 'good' : 'unknown';

    const collectionCompliance = collectionEvaluated ? Math.round(collectionGood / collectionEvaluated * 100) : null;
    const trainingCompliance = trainings.length ? Math.round(trainingGood / trainings.length * 100) : null;
    const epiCompliance = epiRequirements.length ? Math.round(epiRequirements.filter(item => item.status === 'BOM').length / epiRequirements.length * 100) : null;
    const occurrenceCompliance = occurrences.length && employees.length
      ? Math.round((employees.length - new Set(openOccurrences.map(item => String(item.employeeId))).size) / employees.length * 100)
      : null;
    const matrixCoverage = matrixRules.length && employees.length ? Math.round(employeesWithRules / employees.length * 100) : null;
    const moduleScores = [collectionCompliance, trainingCompliance, epiCompliance, occurrenceCompliance, matrixCoverage].filter(Number.isFinite);
    const score = moduleScores.length ? Math.round(moduleScores.reduce((sum, value) => sum + value, 0) / moduleScores.length) : null;

    const priorities = [];
    collections.forEach(collection => {
      const status = normalizedStatus(collection.status);
      if (status !== 'CRÍTICO' && status !== 'ATENÇÃO') return;
      priorities.push({
        source: 'Coleta', employee: employeeMap.get(String(collection.employeeId)), description: resultLabel(collection, current),
        due: collection.date, status, sortDate: collection.date
      });
    });
    trainings.forEach(item => {
      if (item.status !== 'CRÍTICO' && item.status !== 'ATENÇÃO') return;
      if (!item.missing && !priorityPeriodMatches(item.due, selected.period)) return;
      priorities.push({
        source: 'Treinamento', employee: item.employee,
        description: item.missing ? `${item.rule.itemName}: não realizado` : `${item.rule.itemName}: ${item.status === 'CRÍTICO' ? 'vencido' : 'próximo do vencimento'}`,
        due: item.due || '', status: item.status, sortDate: item.due || '0000-00-00'
      });
    });
    epiRequirements.forEach(item => {
      if (item.status !== 'CRÍTICO' && item.status !== 'ATENÇÃO') return;
      if (!item.missing && !priorityPeriodMatches(item.due, selected.period)) return;
      const epiName = epiMap.get(String(item.rule.itemId))?.name || item.rule.itemName || 'EPI';
      priorities.push({
        source: 'EPI', employee: item.employee,
        description: item.missing ? `${epiName}: entrega obrigatória pendente` : `${epiName}: ${item.status === 'CRÍTICO' ? 'troca vencida' : 'troca próxima'}`,
        due: item.due || '', status: item.status, sortDate: item.due || '0000-00-00'
      });
    });
    openOccurrences.forEach(occurrence => {
      const severity = severityLevel(occurrence);
      if (severity === 'LOW') return;
      priorities.push({
        source: occurrence.code || 'Ocorrência', employee: employeeMap.get(String(occurrence.employeeId)),
        description: `${occurrence.type || 'Ocorrência'} — ${occurrence.desc || 'Sem descrição'}`,
        due: occurrence.date, status: severity === 'HIGH' ? 'CRÍTICO' : 'ATENÇÃO', sortDate: occurrence.date
      });
    });
    if (!selected.unitId && !selected.sectorId && !selected.employeeId) {
      current.epis.forEach(epi => {
        const purchased = current.epiPurchases.filter(item => same(item.epiId, epi.id)).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const active = current.epiMovements.filter(item => item.status === 'Entregue' && item.isActive && same(item.epiId, epi.id)).length;
        const discarded = current.epiMovements.filter(item => item.status === 'Descartado' && same(item.epiId, epi.id)).length;
        const stock = purchased - active - discarded;
        const required = current.matrixRules.some(rule => rule.active !== false && rule.type === 'EPI' && same(rule.itemId, epi.id));
        if (required && stock <= 0) priorities.push({ source: 'Estoque EPI', employee: null, description: `${epi.name}: sem unidade disponível`, due: '', status: stock < 0 ? 'CRÍTICO' : 'ATENÇÃO', sortDate: '0000-00-00' });
      });
    }
    priorities.sort((left, right) => (left.status === right.status ? String(right.sortDate).localeCompare(String(left.sortDate)) : left.status === 'CRÍTICO' ? -1 : 1));
    const criticalPriorities = priorities.filter(item => item.status === 'CRÍTICO').length;
    const attentionPriorities = priorities.length - criticalPriorities;

    text('execEmployees', employees.length);
    text('execEmployeesDetail', `${employees.length} de ${current.employees.length} colaborador(es) na visão atual`);
    setCardLevel('execEmployeesCard', employees.length ? 'good' : 'unknown');

    text('execOccurrencesOpen', openOccurrences.length);
    text('execOccurrencesDetail', `${occurrences.length} total · ${cancelledOccurrences.length} cancelada(s) · ${relevantOccurrences} média(s)/alta(s)`);
    setCardLevel('execOccurrencesCard', occurrenceLevel);

    text('execStockAvailable', current.epiPurchases.length || current.epis.length ? stockAvailable : '—');
    text('execStockDetail', current.epiPurchases.length || current.epis.length ? `${purchasedUnits} comprada(s) · estoque geral da empresa` : 'Nenhuma compra de EPI registrada');
    setCardLevel('execStockCard', current.epiPurchases.length || current.epis.length ? (stockAvailable <= 0 ? 'attention' : 'good') : 'unknown');

    text('execEpiActive', epiHasData ? activeDeliveries.length : '—');
    text('execEpiActiveDetail', epiHasData ? `${returnedDeliveries.length} devolução(ões) · ${discardedDeliveries.length} descarte(s)` : 'Nenhuma movimentação de EPI registrada');
    setCardLevel('execEpiActiveCard', epiLevel);

    text('execCollectionsCritical', collections.length ? collectionCritical : '—');
    text('execCollectionsDetail', collections.length ? `${collections.length} realizada(s) · ${collectionAttention} em atenção` : 'Dados insuficientes: nenhuma coleta registrada');
    setCardLevel('execCollectionsCard', collectionLevel);

    text('execTrainingExpired', trainings.length ? visibleTrainingAlerts.length : '—');
    text('execTrainingDetail', trainings.length ? `${trainingCritical} crítica(s) · ${trainingAttention} a vencer no total` : 'Dados insuficientes: sem requisitos aplicáveis');
    setCardLevel('execTrainingCard', trainingLevel);

    text('execEpiAlerts', epiRequirements.length ? visibleEpiAlerts.length : '—');
    text('execEpiAlertsDetail', epiRequirements.length ? `${epiCritical} crítica(s) · ${epiAttention} em atenção no total` : 'Dados insuficientes: sem requisitos aplicáveis');
    setCardLevel('execEpiAlertsCard', epiRequirements.length ? epiLevel : 'unknown');

    text('execCriticalActions', criticalPriorities);
    text('execCriticalDetail', `${attentionPriorities} item(ns) adicional(is) exigem atenção`);
    setCardLevel('execCriticalCard', criticalPriorities ? 'critical' : attentionPriorities ? 'attention' : (moduleScores.length ? 'good' : 'unknown'));

    text('execCollectionsTotal', collections.length); text('execCollectionsGood', collectionGood); text('execCollectionsAttention', collectionAttention); text('execCollectionsBad', collectionCritical);
    text('execTrainingsRequired', trainings.length); text('execTrainingsGood', trainingGood); text('execTrainingsAttention', trainingAttention); text('execTrainingsPending', trainingCritical);
    text('execEpisPurchased', purchasedUnits); text('execEpisInUse', activeDeliveries.length); text('execEpisReturned', returnedDeliveries.length); text('execEpisDiscarded', discardedDeliveries.length);
    text('execRisksTotal', occurrences.length); text('execRisksOpen', openOccurrences.length); text('execRisksCancelled', cancelledOccurrences.length); text('execRisksRelevant', relevantOccurrences);
    text('execMatrixTotal', matrixRules.length); text('execMatrixExams', matrixExam); text('execMatrixTrainings', matrixTraining); text('execMatrixEpis', matrixEpi);
    setBadge('execCollectionsState', moduleLabel(collectionLevel), collectionLevel);
    setBadge('execTrainingsState', moduleLabel(trainingLevel), trainingLevel);
    setBadge('execEpisState', moduleLabel(epiLevel), epiLevel);
    setBadge('execRisksState', moduleLabel(occurrenceLevel), occurrenceLevel);
    setBadge('execMatrixState', matrixRules.length ? 'Configurada' : 'Não configurada', matrixLevel);

    text('execScore', score === null ? 'N/D' : `${score}%`);
    if (score === null) {
      text('execStatusTitle', 'Dados insuficientes para calcular a conformidade.');
      text('execStatusText', 'Cadastre resultados e regras da Matriz; o painel não considera ausência de dados como 100%.');
    } else {
      text('execStatusTitle', criticalPriorities ? 'A operação requer ação imediata.' : attentionPriorities ? 'A operação possui pontos de atenção.' : score >= 90 ? 'A operação está sob controle.' : 'A operação está em acompanhamento.');
      text('execStatusText', `${criticalPriorities} prioridade(s) crítica(s), ${attentionPriorities} em atenção e ${moduleScores.length} de 5 módulo(s) com conformidade calculável.`);
    }

    text('execAnalysisPeriodLabel', `Período analisado: ${formatRange(selectedRange)}`);
    text('execComparisonPeriodLabel', `${selected.compareMode === 'previous-year' ? 'Mesmo período do ano anterior' : 'Período anterior equivalente'}: ${formatRange(previousRange)}`);
    text('execComparisonBase', formatRange(previousRange));
    const ongoingMonth = isOngoingMonth(selectedRange);
    setBadge('execPeriodProgressBadge', ongoingMonth ? 'Inclui mês em andamento' : 'Período concluído', ongoingMonth ? 'attention' : 'good');

    const comparisonByKey = key => comparisons.find(item => item.key === key);
    renderComparisonTrend({ value: 'execCompareOccurrences', previous: 'execCompareOccurrencesPrevious', trend: 'execCompareOccurrencesTrend' }, comparisonByKey('occurrencesTotal'));
    renderComparisonTrend({ value: 'execCompareCriticalCollections', previous: 'execCompareCriticalCollectionsPrevious', trend: 'execCompareCriticalCollectionsTrend' }, comparisonByKey('collectionsCritical'));
    renderComparisonTrend({ value: 'execCompareTrainings', previous: 'execCompareTrainingsPrevious', trend: 'execCompareTrainingsTrend' }, comparisonByKey('trainingsCompleted'));
    renderComparisonTrend({ value: 'execCompareGoodCollections', previous: 'execCompareGoodCollectionsPrevious', trend: 'execCompareGoodCollectionsTrend' }, comparisonByKey('collectionsGood'));

    const managedComparisons = comparisons.filter(item => item.preference !== 'neutral' && item.available);
    const improvedCount = managedComparisons.filter(item => item.comparison.result === 'improved').length;
    const worsenedCount = managedComparisons.filter(item => item.comparison.result === 'worsened').length;
    const stableCount = managedComparisons.filter(item => item.comparison.result === 'stable').length;
    text('execImprovedCount', improvedCount);
    text('execWorsenedCount', worsenedCount);
    text('execStableCount', stableCount);
    if (!managedComparisons.length) {
      text('execComparisonSummary', 'Ainda não existem registros suficientes nos períodos escolhidos para interpretar a evolução. O painel mantém os resultados como N/D, sem considerar ausência de dados como melhora.');
    } else {
      const progressWarning = ongoingMonth ? ' O período atual inclui um mês em andamento e a comparação usa a mesma parcela do período anterior.' : '';
      const conclusion = worsenedCount > improvedCount
        ? 'A operação piorou em mais indicadores do que melhorou e merece revisão das causas.'
        : improvedCount > worsenedCount
          ? 'A operação melhorou em mais indicadores do que piorou; mantenha o acompanhamento dos pontos restantes.'
          : 'A evolução está equilibrada entre avanços e pontos de atenção.';
      text('execComparisonSummary', `${conclusion}${progressWarning}`);
    }

    byId('execComparisonTable').innerHTML = comparisons.map(item => {
      const level = item.comparison.result === 'improved' ? 'good' : item.comparison.result === 'worsened' ? 'critical' : item.comparison.result === 'informative' ? 'attention' : 'unknown';
      const currentValue = item.available ? item.current : '—';
      const previousValue = item.available ? item.previous : '—';
      return `<tr><td><strong>${escapeHtml(item.module)}</strong></td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(currentValue)}</td><td>${escapeHtml(previousValue)}</td><td>${escapeHtml(item.comparison.variation)}</td><td>${badge(item.comparison.label, level)}</td></tr>`;
    }).join('');

    const selectedMonthKeys = monthKeys(selectedRange.start, selectedRange.end, 240);
    const chartStart = selectedMonthKeys.length < 2 ? shiftMonths(startOfMonth(selectedRange.end), -5) : selectedRange.start;
    const chartKeys = monthKeys(chartStart, selectedRange.end, 12);
    const monthlyDatasets = [];
    if (comparisonAvailability.occurrences) monthlyDatasets.push({
      label: 'Ocorrências', data: monthCounts(occurrences, chartKeys, item => item.status !== 'CANCELLED'), borderColor: '#dc6c67', backgroundColor: 'rgba(220,108,103,.12)', tension: .3, borderWidth: 2
    });
    if (comparisonAvailability.collections) monthlyDatasets.push({
      label: 'Coletas críticas', data: monthCounts(collections, chartKeys, item => normalizedStatus(item.status) === 'CRÍTICO'), borderColor: '#e0b84a', backgroundColor: 'rgba(224,184,74,.12)', tension: .3, borderWidth: 2
    });
    if (comparisonAvailability.trainings) monthlyDatasets.push({
      label: 'Treinamentos realizados', data: monthCounts(trainingRecords, chartKeys), borderColor: '#72a875', backgroundColor: 'rgba(114,168,117,.12)', tension: .3, borderWidth: 2
    });
    if (comparisonAvailability.epis) monthlyDatasets.push({
      label: 'Entregas de EPI', data: monthCounts(movements, chartKeys, item => item.status === 'Entregue'), borderColor: '#5c8fa8', backgroundColor: 'rgba(92,143,168,.12)', tension: .3, borderWidth: 2
    });
    text('execMonthlyChartTitle', selectedMonthKeys.length < 2 ? 'Evolução Mensal dos Registros · 6 meses de contexto' : 'Evolução Mensal dos Registros');
    if (monthlyChart) monthlyChart.destroy();
    monthlyChart = new window.Chart(byId('executiveMonthlyChart'), {
      type: 'line',
      data: { labels: chartKeys.map(monthLabel), datasets: monthlyDatasets },
      options: {
        plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12 } }, tooltip: { mode: 'index', intersect: false } },
        scales: { y: { beginAtZero: true, ticks: { color: '#9ca3af', precision: 0 }, grid: { color: 'rgba(255,255,255,.05)' } }, x: { ticks: { color: '#9ca3af' }, grid: { display: false } } },
        interaction: { mode: 'index', intersect: false }, maintainAspectRatio: false
      }
    });

    text('execPriorityCount', `${priorities.length} item(ns): ${criticalPriorities} crítico(s) e ${attentionPriorities} em atenção`);
    byId('execPriorityTable').innerHTML = priorities.length ? priorities.map(item => {
      const sector = sectorMap.get(String(item.employee?.sectorId));
      return `<tr><td><strong>${escapeHtml(item.source)}</strong></td><td><strong>${escapeHtml(item.employee?.name || 'Operação geral')}</strong><br><small>${escapeHtml(sector?.name || 'Empresa')}</small></td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.due ? formatDate(item.due) : 'Sem prazo')}</td><td>${badge(item.status, item.status === 'CRÍTICO' ? 'critical' : 'attention')}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhuma prioridade encontrada para os filtros selecionados.</td></tr>';

    const activities = [];
    collections.forEach(collection => activities.push({
      date: collection.date, createdAt: collection.createdAt || '', module: 'Coleta', record: resultLabel(collection, current),
      context: employeeMap.get(String(collection.employeeId))?.name || 'Colaborador não encontrado', status: normalizedStatus(collection.status)
    }));
    trainingRecords.forEach(record => activities.push({
      date: record.date, createdAt: record.createdAt || '', module: 'Treinamento',
      record: trainingMap.get(String(record.trainingTypeId))?.name || 'Treinamento', context: employeeMap.get(String(record.employeeId))?.name || 'Colaborador não encontrado',
      status: dueStatus(record.due, 30)
    }));
    movements.forEach(movement => activities.push({
      date: movement.date, createdAt: movement.createdAt || '', module: 'EPI',
      record: `${movement.status}: ${epiMap.get(String(movement.epiId))?.name || 'EPI'}`, context: employeeMap.get(String(movement.employeeId))?.name || 'Colaborador não encontrado',
      status: movement.status === 'Descartado' ? 'CRÍTICO' : movement.status === 'Entregue' && movement.isActive ? 'ATENÇÃO' : 'BOM'
    }));
    occurrences.forEach(occurrence => activities.push({
      date: occurrence.cancelledAt || occurrence.date, createdAt: occurrence.createdAt || '', module: 'Ocorrência',
      record: `${occurrence.code || 'Sem código'} — ${occurrence.type || 'Ocorrência'}`, context: employeeMap.get(String(occurrence.employeeId))?.name || 'Colaborador não encontrado',
      status: occurrence.status === 'CANCELLED' ? 'CANCELADA' : severityLabel(occurrence),
      level: occurrence.status === 'CANCELLED' ? 'unknown' : severityLevel(occurrence) === 'HIGH' ? 'critical' : severityLevel(occurrence) === 'MEDIUM' ? 'attention' : 'good'
    }));
    if (!selected.unitId && !selected.sectorId && !selected.employeeId) {
      current.epiPurchases.forEach(purchase => activities.push({
        date: purchase.date, createdAt: purchase.createdAt || '', module: 'Compra de EPI',
        record: `${epiMap.get(String(purchase.epiId))?.name || 'EPI'} — ${purchase.quantity} unidade(s)`, context: purchase.technicalResponsible ? `Responsável: ${purchase.technicalResponsible}` : 'Empresa', status: 'REGISTRADA'
      }));
    }
    const periodActivities = activities.filter(activity => dateInRange(activity.date, selectedRange));
    periodActivities.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')) || String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    const visibleActivities = periodActivities.slice(0, 12);
    text('execActivityCount', periodActivities.length ? `Exibindo ${visibleActivities.length} de ${periodActivities.length} movimentação(ões) no período` : 'Nenhuma movimentação encontrada no período');
    byId('execActivityTable').innerHTML = visibleActivities.length ? visibleActivities.map(activity => {
      const normalized = normalizedStatus(activity.status);
      const level = activity.level || (activity.status === 'CANCELADA' || activity.status === 'REGISTRADA' ? 'unknown' : normalized === 'CRÍTICO' ? 'critical' : normalized === 'ATENÇÃO' ? 'attention' : 'good');
      const label = (activity.level || activity.status === 'CANCELADA' || activity.status === 'REGISTRADA') ? activity.status : normalized;
      return `<tr><td>${escapeHtml(formatDate(activity.date))}</td><td><strong>${escapeHtml(activity.module)}</strong></td><td>${escapeHtml(activity.record)}</td><td>${escapeHtml(activity.context)}</td><td>${badge(label, level)}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">Nenhuma atividade registrada para os filtros selecionados.</td></tr>';

    const chartEntries = [
      ['Coletas', collectionCompliance, '#e0b84a'],
      ['Treinamentos', trainingCompliance, '#c99a37'],
      ['EPIs', epiCompliance, '#9c7a31'],
      ['Ocorrências', occurrenceCompliance, '#72a875'],
      ['Matriz', matrixCoverage, '#5c8fa8']
    ].filter(([, value]) => Number.isFinite(value));
    if (moduleChart) moduleChart.destroy();
    moduleChart = new window.Chart(byId('executiveModuleChart'), {
      type: 'bar',
      data: { labels: chartEntries.map(([label]) => label), datasets: [{ data: chartEntries.map(([, value]) => value), backgroundColor: chartEntries.map(([, , color]) => color), borderRadius: 6 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.raw}%` } } }, scales: { y: { beginAtZero: true, max: 100, ticks: { color: '#9ca3af', callback: value => `${value}%` }, grid: { color: 'rgba(255,255,255,.05)' } }, x: { ticks: { color: '#9ca3af' }, grid: { display: false } } }, maintainAspectRatio: false }
    });

    const priorityDataAvailable = moduleScores.length > 0 || occurrences.length > 0 || movements.length > 0;
    const priorityLabels = priorities.length ? ['Crítico', 'Atenção'] : [priorityDataAvailable ? 'Sem prioridades' : 'Dados insuficientes'];
    const priorityValues = priorities.length ? [criticalPriorities, attentionPriorities] : [1];
    const priorityColors = priorities.length ? ['#dc6c67', '#e0b84a'] : [priorityDataAvailable ? '#72a875' : '#59666d'];
    if (priorityChart) priorityChart.destroy();
    priorityChart = new window.Chart(byId('executivePriorityChart'), {
      type: 'doughnut',
      data: { labels: priorityLabels, datasets: [{ data: priorityValues, backgroundColor: priorityColors, borderWidth: 0 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12 } } }, maintainAspectRatio: false }
    });
  }

  function stateEventDates(current) {
    if (!current) return [];
    return [
      ...current.collections.map(item => item.date),
      ...current.risks.flatMap(item => [item.date, item.cancelledAt]),
      ...current.epiMovements.map(item => item.date),
      ...current.trainingRecords.map(item => item.date),
      ...current.matrixRules.map(item => item.createdAt || item.effective)
    ];
  }

  function syncDateInputs() {
    const preset = byId('execDatePreset');
    const start = byId('execDateStart');
    const end = byId('execDateEnd');
    if (!preset || !start || !end) return;
    const custom = preset.value === 'custom';
    start.disabled = !custom;
    end.disabled = !custom;
    if (custom) {
      if (!start.value || !end.value) {
        start.value = startOfMonth(todayIso());
        end.value = todayIso();
      }
      return;
    }
    const range = analysisRange({ ...filters(), datePreset: preset.value }, stateEventDates(state()));
    start.value = range.start;
    end.value = range.end;
  }

  function installPeriodEvents() {
    const preset = byId('execDatePreset');
    const start = byId('execDateStart');
    const end = byId('execDateEnd');
    const compare = byId('execCompareMode');
    preset?.addEventListener('change', () => { syncDateInputs(); render(); });
    start?.addEventListener('change', render);
    end?.addEventListener('change', render);
    compare?.addEventListener('change', render);
    byId('execClear')?.addEventListener('click', () => {
      if (preset) preset.value = 'current-month';
      if (compare) compare.value = 'previous';
      syncDateInputs();
      render();
    });
  }

  function install() {
    window.NexusExecutiveDashboard = { render };
    syncDateInputs();
    installPeriodEvents();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
