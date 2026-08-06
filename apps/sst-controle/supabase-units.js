(() => {
  let isSubmitting = false;
  const deletingIds = new Set();

  function app() {
    return window.NEXUS_SST_APP;
  }

  function getClient() {
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    const rawSession = sessionStorage.getItem('nexus_demo_session');

    if (!rawSession) {
      throw new Error('Sessão autenticada não encontrada.');
    }

    let session;

    try {
      session = JSON.parse(rawSession);
    } catch {
      throw new Error('Sessão autenticada inválida.');
    }

    if (!session.organizationId) {
      throw new Error(
        'Organização não encontrada na sessão autenticada.'
      );
    }

    return session.organizationId;
  }

  function renderUnits(units) {
    app().getState().units = units;
    app().render();
  }

  async function loadUnits() {
    const client = getClient();
    const organizationId = getOrganizationId();

    const { data, error } = await client
      .from('units')
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    renderUnits(data || []);
  }

  async function createUnit(event) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const form = event.currentTarget;
    const submitButton =
      form.querySelector('button[type="submit"]');

    const nameInput =
      document.getElementById('unitName');

    const name = nameInput.value.trim();

    if (!name) {
      return;
    }

    isSubmitting = true;

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const client = getClient();
      const organizationId = getOrganizationId();

      const { error } = await client
        .from('units')
        .insert({
          name,
          organization_id: organizationId
        });

      if (error) {
        throw error;
      }

      await loadUnits();
      form.reset();
    } catch (error) {
      console.error(
        'Não foi possível cadastrar a unidade.',
        error
      );

      alert(
        'Não foi possível cadastrar a unidade. Tente novamente.'
      );
    } finally {
      isSubmitting = false;

      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  }

  async function hasLinkedRecords(
    client,
    organizationId,
    unitId
  ) {
    const [
      sectorsResult,
      employeesResult
    ] = await Promise.all([
      client
        .from('sectors')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq('unit_id', unitId)
        .eq('organization_id', organizationId),

      client
        .from('employees')
        .select('id', {
          count: 'exact',
          head: true
        })
        .eq('unit_id', unitId)
        .eq('organization_id', organizationId)
    ]);

    if (sectorsResult.error) {
      throw sectorsResult.error;
    }

    if (employeesResult.error) {
      throw employeesResult.error;
    }

    return {
      sectors: sectorsResult.count || 0,
      employees: employeesResult.count || 0
    };
  }

  async function deleteUnit(id) {
    if (deletingIds.has(id)) {
      return;
    }

    deletingIds.add(id);

    try {
      const client = getClient();
      const organizationId = getOrganizationId();

      const links = await hasLinkedRecords(
        client,
        organizationId,
        id
      );

      if (links.sectors || links.employees) {
        alert(
          `Não é possível excluir esta unidade porque ela possui ` +
          `${links.sectors} setor(es) e ` +
          `${links.employees} colaborador(es) vinculados.`
        );

        return;
      }

      const confirmed = window.confirm(
        'Excluir esta unidade? Esta ação não poderá ser desfeita.'
      );

      if (!confirmed) {
        return;
      }

      const { error } = await client
        .from('units')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) {
        throw error;
      }

      await loadUnits();
    } catch (error) {
      console.error(
        'Não foi possível excluir a unidade.',
        error
      );

      alert(
        'Não foi possível excluir a unidade. Tente novamente.'
      );
    } finally {
      deletingIds.delete(id);
    }
  }

  function install() {
    const form =
      document.getElementById('unitForm');

    if (!form || !app()) {
      return;
    }

    form.onsubmit = createUnit;
    window.deleteUnit = deleteUnit;

    loadUnits().catch(error => {
      console.error(
        'Não foi possível carregar as unidades.',
        error
      );

      alert(
        'Não foi possível carregar as unidades do Supabase.'
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      install,
      { once: true }
    );
  } else {
    install();
  }
})();