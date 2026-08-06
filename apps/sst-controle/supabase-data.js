(() => {
  'use strict';

  const locks = new Map();

  function error(message, cause) {
    const failure = new Error(message);
    failure.cause = cause;
    return failure;
  }

  function getClient() {
    if (!window.NexusAuth?.getClient) {
      throw error('Cliente autenticado do Supabase não está disponível.');
    }
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    const raw = sessionStorage.getItem('nexus_demo_session');
    if (!raw) throw error('Sessão autenticada não encontrada.');
    let session;
    try { session = JSON.parse(raw); } catch (cause) {
      throw error('Sessão autenticada inválida.', cause);
    }
    const organizationId = String(session?.organizationId || '').trim();
    if (!organizationId) throw error('Organização autenticada não foi identificada.');
    return organizationId;
  }

  function requireConfig(config) {
    if (!config?.table) throw error('Tabela não informada para a operação.');
    return config;
  }

  function applyFilters(query, filters = []) {
    return filters.reduce((current, filter) => {
      if (!filter || !filter.column) return current;
      if (filter.operator && filter.operator !== 'eq') {
        return current[filter.operator](filter.column, filter.value);
      }
      return current.eq(filter.column, filter.value);
    }, query);
  }

  async function list(config) {
    config = requireConfig(config);
    const organizationId = getOrganizationId();
    let query = getClient().from(config.table)
      .select(config.select || '*')
      .eq('organization_id', organizationId);
    query = applyFilters(query, config.filters);
    if (config.order?.column) query = query.order(config.order.column, { ascending: config.order.ascending !== false });
    const { data, error: queryError } = await query;
    if (queryError) throw error(`Não foi possível listar ${config.label || config.table}.`, queryError);
    return data || [];
  }

  async function insert(config) {
    config = requireConfig(config);
    const organizationId = getOrganizationId();
    const payload = { ...(config.values || {}), organization_id: organizationId };
    let query = getClient().from(config.table).insert(payload);
    if (config.select) query = query.select(config.select);
    const { data, error: queryError } = await query;
    if (queryError) throw error(`Não foi possível cadastrar ${config.label || config.table}.`, queryError);
    return data || [];
  }

  async function update(config) {
    config = requireConfig(config);
    if (!config.id) throw error('Registro não informado para atualização.');
    const organizationId = getOrganizationId();
    let query = getClient().from(config.table).update(config.values || {})
      .eq('id', config.id)
      .eq('organization_id', organizationId);
    if (config.select) query = query.select(config.select);
    const { data, error: queryError } = await query;
    if (queryError) throw error(`Não foi possível atualizar ${config.label || config.table}.`, queryError);
    return data || [];
  }

  async function remove(config) {
    config = requireConfig(config);
    if (!config.id) throw error('Registro não informado para exclusão.');
    const organizationId = getOrganizationId();
    let query = getClient().from(config.table).delete()
      .eq('id', config.id)
      .eq('organization_id', organizationId);
    query = applyFilters(query, config.filters);
    const { error: queryError } = await query;
    if (queryError) throw error(`Não foi possível excluir ${config.label || config.table}.`, queryError);
  }

  async function count(config) {
    config = requireConfig(config);
    const organizationId = getOrganizationId();
    let query = getClient().from(config.table)
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    query = applyFilters(query, config.filters);
    const { count: total, error: queryError } = await query;
    if (queryError) throw error(`Não foi possível verificar vínculos de ${config.label || config.table}.`, queryError);
    return total || 0;
  }

  async function exists(config) { return (await count(config)) > 0; }

  async function runLocked(key, callback, button) {
    if (locks.has(key)) return locks.get(key);
    const task = (async () => {
      if (button) button.disabled = true;
      try { return await callback(); } finally {
        if (button) button.disabled = false;
        locks.delete(key);
      }
    })();
    locks.set(key, task);
    return task;
  }

  window.NexusData = { getClient, getOrganizationId, list, insert, update, remove, count, exists, runLocked };
})();
