(() => {
  'use strict';

  let installed = false;

  const byId = id => document.getElementById(id);

  function getClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Cliente autenticado do Supabase não está disponível.');
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem('nexus_demo_session') || '{}'); } catch { throw new Error('Sessão autenticada inválida.'); }
    const organizationId = String(session?.organizationId || '').trim();
    if (!organizationId) throw new Error('Organização autenticada não foi identificada.');
    return organizationId;
  }

  function getState() {
    const state = window.NEXUS_SST_APP?.getState?.();
    if (!state) throw new Error('Estado do SST Controle não está disponível.');
    return state;
  }

  function render() {
    window.NEXUS_SST_APP?.render?.();
  }

  function catalogFromRow(row) {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      active: row.active
    };
  }

  function purchaseFromRow(row) {
    return {
      id: row.id,
      epiId: row.epi_id,
      date: row.purchased_at,
      quantity: row.quantity,
      supplier: row.supplier || '',
      invoice: row.invoice_number || '',
      technicalResponsible: row.technical_responsible,
      createdAt: row.created_at
    };
  }

  function showError(message) {
    window.alert(message);
  }

  async function listEpis() {
    try {
      const organizationId = getOrganizationId();
      const [catalogResult, purchasesResult] = await Promise.all([
        getClient()
          .from('epi_catalog')
          .select('id,name,code,active')
          .eq('organization_id', organizationId)
          .eq('active', true)
          .order('name'),
        getClient()
          .from('epi_purchases')
          .select('id,epi_id,purchased_at,quantity,supplier,invoice_number,technical_responsible,created_at')
          .eq('organization_id', organizationId)
          .order('purchased_at', { ascending: false })
          .order('created_at', { ascending: false })
      ]);
      if (catalogResult.error) throw catalogResult.error;
      if (purchasesResult.error) throw purchasesResult.error;

      const state = getState();
      state.epis = (catalogResult.data || []).map(catalogFromRow);
      state.epiPurchases = (purchasesResult.data || []).map(purchaseFromRow);
      render();
    } catch (error) {
      console.error('Falha ao carregar catálogo e compras de EPIs.', error);
      showError('Não foi possível carregar o catálogo e as compras de EPIs.');
    }
  }

  async function submitCatalog(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const name = byId('epiName').value.trim();
    const code = byId('epiCode').value.trim();
    if (!name || !code) return showError('Informe o nome e o código/CA do EPI.');

    button.disabled = true;
    try {
      const { data, error } = await getClient()
        .from('epi_catalog')
        .insert({ organization_id: getOrganizationId(), name, code, active: true })
        .select('id,name,code,active')
        .single();
      if (error) throw error;

      getState().epis.push(catalogFromRow(data));
      getState().epis.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
      form.reset();
      render();
    } catch (error) {
      console.error('Falha ao cadastrar EPI.', error);
      if (error?.code === '23505') showError('Já existe um EPI com este código/CA nesta organização.');
      else showError(error.message || 'Não foi possível cadastrar o EPI.');
    } finally {
      button.disabled = false;
    }
  }

  async function submitPurchase(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const epiId = byId('epiPurchaseItem').value;
    const purchasedAt = byId('epiPurchaseDate').value;
    const quantity = Number(byId('epiQuantity').value);
    const supplier = byId('epiSupplier').value.trim();
    const invoiceNumber = byId('epiInvoice').value.trim();
    const technicalResponsible = byId('epiTechnicalResponsible').value.trim();
    if (!epiId || !purchasedAt || !Number.isInteger(quantity) || quantity <= 0 || !technicalResponsible) {
      return showError('Informe EPI, data, quantidade inteira positiva e responsável técnico.');
    }

    button.disabled = true;
    try {
      const { data, error } = await getClient()
        .from('epi_purchases')
        .insert({
          organization_id: getOrganizationId(),
          epi_id: epiId,
          purchased_at: purchasedAt,
          quantity,
          supplier: supplier || null,
          invoice_number: invoiceNumber || null,
          technical_responsible: technicalResponsible
        })
        .select('id,epi_id,purchased_at,quantity,supplier,invoice_number,technical_responsible,created_at')
        .single();
      if (error) throw error;

      getState().epiPurchases.unshift(purchaseFromRow(data));
      form.reset();
      render();
    } catch (error) {
      console.error('Falha ao registrar compra de EPI.', error);
      showError(error.message || 'Não foi possível registrar a compra de EPI.');
    } finally {
      button.disabled = false;
    }
  }

  function install() {
    if (installed || !byId('epiCatalogForm') || !byId('epiPurchaseForm') || !window.NEXUS_SST_APP?.getState) return;
    installed = true;
    byId('epiCatalogForm').onsubmit = submitCatalog;
    byId('epiPurchaseForm').onsubmit = submitPurchase;
    window.NexusEpis = { listEpis };
    listEpis();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
