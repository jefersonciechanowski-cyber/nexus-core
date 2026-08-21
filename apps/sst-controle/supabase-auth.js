(() => {
  'use strict';

  const ROLE_LABELS = {
    nexus_admin: 'Administrador Nexus',
    org_admin: 'Administrador da Empresa',
    sst_manager: 'Gestor de SST',
    sst_technician: 'Técnico de SST',
    hr: 'Recursos Humanos',
    director: 'Diretor',
    viewer: 'Visualizador'
  };
  const ADMIN_MFA_MAX_AGE_SECONDS = 7200;

  let client = null;

  function getRecoveryRedirectTarget() {
    const hash = window.location.hash || '';
    if (!hash) return null;
    const params = new URLSearchParams(hash.slice(1));
    const isRecovery = params.get('type') === 'recovery';
    const isRecoveryError = params.get('error_code') === 'otp_expired';
    if (!isRecovery && !isRecoveryError) return null;
    if (window.location.pathname.includes('/apps/portal-cliente/')) return `redefinir-senha.html${hash}`;
    if (window.location.pathname.includes('/apps/sst-controle/')) return `../portal-cliente/redefinir-senha.html${hash}`;
    return null;
  }

  function getClient() {
    const config = window.NEXUS_SUPABASE_CONFIG;
    if (!config?.url || !config?.publishableKey) throw new Error('Configuração do Supabase não encontrada.');
    if (!window.supabase?.createClient) throw new Error('Biblioteca do Supabase não foi carregada.');
    if (!client) {
      client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return client;
  }

  function isCentralNexusAdminPage() {
    return window.location.pathname.includes('/apps/nexus-admin/')
      && !/\/apps\/nexus-admin\/login(?:\.html)?\/?$/.test(window.location.pathname);
  }

  function hasRecentTotp(methods) {
    const cutoff = Math.floor(Date.now() / 1000) - ADMIN_MFA_MAX_AGE_SECONDS;
    return (methods || []).some(item => item?.method === 'totp' && Number(item.timestamp) >= cutoff);
  }

  async function enforceAdminMfaSession(session) {
    if (!isCentralNexusAdminPage() || session?.role !== 'nexus_admin') return session;
    const supabaseClient = getClient();
    let marker = null;
    try { marker = JSON.parse(sessionStorage.getItem('nexus_admin_mfa_session') || 'null'); } catch {}
    const { data, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
    const markerFresh = marker?.userId === session.userId
      && Date.now() - Number(marker.verifiedAt || 0) <= ADMIN_MFA_MAX_AGE_SECONDS * 1000;
    const valid = !error
      && data?.currentLevel === 'aal2'
      && hasRecentTotp(data.currentAuthenticationMethods)
      && markerFresh;
    if (valid) return session;

    sessionStorage.removeItem('nexus_admin_mfa_session');
    sessionStorage.removeItem('nexus_demo_session');
    await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.location.replace('login.html?reason=mfa');
    throw new Error('Verificação administrativa em duas etapas obrigatória.');
  }

  async function ensureSstEntitlement(profile) {
    if (!window.location.pathname.includes('/apps/sst-controle/')) return;
    if (profile?.role === 'nexus_admin') return;
    if (!profile?.organization_id) throw new Error('Empresa de acesso não encontrada.');

    const { data: access, error } = await getClient()
      .from('organization_product_access')
      .select('access_status,subscription_status,renews_at,billing_mode,product:nexus_products!inner(code,status)')
      .eq('organization_id', profile.organization_id)
      .eq('product.code', 'sst')
      .maybeSingle();

    if (error) throw new Error('Não foi possível validar a liberação do Nexus SST.');
    const product = Array.isArray(access?.product) ? access.product[0] : access?.product;
    const hasTimedExpiry = access?.subscription_status === 'trial' || access?.billing_mode === 'prepaid';
    const expired = Boolean(hasTimedExpiry && access?.renews_at && new Date(`${access.renews_at}T23:59:59`) < new Date());
    const blocked = !access
      || product?.status !== 'active'
      || access.access_status !== 'active'
      || ['past_due', 'cancelled'].includes(access.subscription_status)
      || expired;

    if (blocked) {
      sessionStorage.removeItem('nexus_demo_session');
      throw new Error(expired
        ? 'Seu período de acesso ao Nexus SST foi encerrado. Consulte a Minha Central Nexus para continuar.'
        : 'O Nexus SST não está liberado para esta empresa. Consulte a Minha Central Nexus.');
    }
  }

  async function loadProfile(user) {
    const supabaseClient = getClient();
    const { data, error } = await supabaseClient
      .from('profiles')
      .select(`id,organization_id,full_name,role,active,organizations(name,slug,status)`)
      .eq('id', user.id)
      .single();

    if (error || !data) throw new Error('Perfil de acesso não encontrado.');
    if (!data.active) throw new Error('Este usuário está inativo.');

    const organization = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
    if (organization?.status && organization.status !== 'active') throw new Error('Esta empresa está com o acesso suspenso.');
    await ensureSstEntitlement(data);

    const sessionData = {
      userId: user.id,
      email: user.email,
      name: data.full_name,
      role: data.role,
      roleLabel: ROLE_LABELS[data.role] || data.role,
      organizationId: data.organization_id,
      organizationName: organization?.name || 'Nexus Core',
      organizationSlug: organization?.slug || '',
      provider: 'supabase'
    };
    sessionStorage.setItem('nexus_demo_session', JSON.stringify(sessionData));
    window.NEXUS_DEMO_USER = sessionData;
    return sessionData;
  }

  async function login(email, password) {
    const supabaseClient = getClient();
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password
    });
    if (error || !data.user) throw new Error('E-mail ou senha inválidos.');
    try {
      return await loadProfile(data.user);
    } catch (profileError) {
      await supabaseClient.auth.signOut({ scope: 'local' });
      throw profileError;
    }
  }

  async function restoreSession() {
    const recoveryRedirectTarget = getRecoveryRedirectTarget();
    if (recoveryRedirectTarget) {
      window.location.replace(recoveryRedirectTarget);
      return null;
    }
    const supabaseClient = getClient();
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data.user) {
      sessionStorage.removeItem('nexus_demo_session');
      return null;
    }
    const session = await loadProfile(data.user);
    return enforceAdminMfaSession(session);
  }

  async function logout() {
    const supabaseClient = getClient();
    sessionStorage.removeItem('nexus_demo_session');
    sessionStorage.removeItem('nexus_admin_mfa_session');
    await supabaseClient.auth.signOut({ scope: 'local' });
  }

  async function listOrganizations() {
    const { data, error } = await getClient().rpc('get_my_organizations');
    if (error) throw new Error(error.message || 'Não foi possível carregar as empresas da conta.');
    return (data || []).map(row => ({
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      status: row.organization_status,
      role: row.membership_role,
      isCurrent: row.is_current,
      relationshipType: row.relationship_type
    }));
  }

  async function getAccountSummary() {
    const { data, error } = await getClient().rpc('get_my_nexus_account_summary');
    if (error) throw new Error(error.message || 'Não foi possível carregar a conta Nexus.');
    return data || null;
  }

  async function switchOrganization(organizationId) {
    const id = String(organizationId || '').trim();
    if (!id) throw new Error('Empresa inválida.');
    const { error } = await getClient().rpc('switch_organization', { p_organization_id: id });
    if (error) throw new Error(error.message || 'Não foi possível trocar de empresa.');
    const { data: { user }, error: userError } = await getClient().auth.getUser();
    if (userError || !user) throw new Error('Sessão inválida após trocar de empresa.');
    return loadProfile(user);
  }

  async function createManagedOrganization({ name, registrationType = null, registrationNumber = null }) {
    const companyName = String(name || '').trim();
    if (!companyName) throw new Error('Informe o nome da empresa.');
    const { data, error } = await getClient().rpc('create_managed_organization', {
      p_name: companyName,
      p_registration_type: registrationType || null,
      p_registration_number: registrationNumber || null
    });
    if (error) throw new Error(error.message || 'Não foi possível criar a empresa.');
    return data;
  }

  function injectMultiCompanyStyles() {
    if (document.getElementById('nexusMultiCompanyStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusMultiCompanyStyles';
    style.textContent = `
      .nexus-account-panel{margin:0 0 26px;padding:20px;border:1px solid var(--line,#2f393f);border-radius:13px;background:var(--surface,#111a1f)}
      .nexus-account-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.nexus-account-head h2{margin:0;font-size:18px}.nexus-account-head p{margin:5px 0 0;color:var(--muted,#98a2a7);font-size:12px;line-height:1.5}
      .nexus-account-metrics{display:flex;gap:8px;flex-wrap:wrap}.nexus-account-pill{padding:7px 9px;border:1px solid var(--line,#2f393f);border-radius:999px;color:var(--muted,#98a2a7);font-size:11px;white-space:nowrap}.nexus-account-pill b{color:var(--text,#f5eee0)}
      .nexus-company-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.nexus-company-card{padding:14px;border:1px solid var(--line,#2f393f);border-radius:10px;background:#0d171c;display:flex;justify-content:space-between;gap:12px;align-items:center}.nexus-company-card.current{border-color:rgba(224,184,74,.5);box-shadow:inset 3px 0 0 #e0b84a}.nexus-company-card strong{display:block;font-size:13px}.nexus-company-card small{display:block;margin-top:4px;color:var(--muted,#98a2a7);font-size:10px}.nexus-company-card button,.nexus-new-company{border:1px solid var(--line,#2f393f);background:#111a1f;color:var(--text,#f5eee0);padding:8px 10px;border-radius:8px;cursor:pointer}.nexus-company-card button:hover,.nexus-new-company:hover{border-color:#e0b84a}.nexus-new-company{margin-top:12px;color:#e0b84a}
      .nexus-company-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.68);display:grid;place-items:center;padding:20px}.nexus-company-modal[hidden]{display:none}.nexus-company-dialog{width:min(620px,100%);padding:20px;border:1px solid var(--line,#2f393f);border-radius:13px;background:var(--surface,#111a1f);color:var(--text,#f5eee0);box-shadow:0 20px 70px rgba(0,0,0,.45)}.nexus-company-dialog h2{margin:0}.nexus-company-dialog p{margin:6px 0 16px;color:var(--muted,#98a2a7);font-size:12px;line-height:1.5}.nexus-company-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.nexus-company-form label{display:grid;gap:6px;color:var(--muted,#98a2a7);font-size:11px}.nexus-company-form label:first-child{grid-column:1/-1}.nexus-company-form input,.nexus-company-form select{width:100%;padding:10px 11px;border:1px solid var(--line,#2f393f);border-radius:8px;background:#0b1419;color:var(--text,#f5eee0)}.nexus-company-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;margin-top:6px}.nexus-company-actions button{padding:9px 13px;border-radius:8px;border:1px solid var(--line,#2f393f);background:#0d171c;color:var(--text,#f5eee0);cursor:pointer}.nexus-company-actions .primary{background:linear-gradient(180deg,#e0b84a,#c7962f);border-color:#e0b84a;color:#17130a;font-weight:800}
      @media(max-width:820px){.nexus-account-head{flex-direction:column}.nexus-company-grid{grid-template-columns:1fr}.nexus-company-form{grid-template-columns:1fr}.nexus-company-form label:first-child,.nexus-company-actions{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  async function setupGlobalCompanySelector(session) {
    const select = document.getElementById('globalCompany');
    if (!select) return;
    try {
      const organizations = await listOrganizations();
      const options = organizations.map(org => {
        const option = document.createElement('option');
        option.value = org.id;
        option.textContent = org.name;
        return option;
      });
      select.replaceChildren(...options);
      select.value = session.organizationId;
      select.disabled = organizations.length <= 1;
      select.title = organizations.length > 1 ? 'Trocar empresa da conta' : 'Empresa da conta';
      select.onchange = async () => {
        const target = select.value;
        if (!target || target === session.organizationId) return;
        select.disabled = true;
        try {
          await switchOrganization(target);
          location.reload();
        } catch (error) {
          alert(error.message || 'Não foi possível trocar de empresa.');
          select.value = session.organizationId;
          select.disabled = organizations.length <= 1;
        }
      };
    } catch (error) {
      const option = document.createElement('option');
      option.textContent = session.organizationName || 'Empresa';
      select.replaceChildren(option);
      select.disabled = true;
      console.error('[Nexus multiempresa]', error);
    }
  }

  function buildCompanyModal() {
    let modal = document.getElementById('nexusCompanyModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'nexusCompanyModal';
    modal.className = 'nexus-company-modal';
    modal.hidden = true;
    modal.innerHTML = `<div class="nexus-company-dialog" role="dialog" aria-modal="true" aria-labelledby="nexusCompanyTitle"><h2 id="nexusCompanyTitle">Nova empresa cliente</h2><p>Crie a empresa dentro da conta da consultoria. Os dados completos poderão ser preenchidos depois no módulo Empresa do Nexus SST.</p><form id="nexusCompanyForm" class="nexus-company-form"><label>Nome da empresa<input id="nexusCompanyName" maxlength="160" required placeholder="Ex.: Indústria Cliente Ltda."></label><label>Documento<select id="nexusCompanyDocumentType"><option value="">Não informar agora</option><option value="CNPJ">CNPJ</option><option value="CPF">CPF</option></select></label><label>Número<input id="nexusCompanyDocument" maxlength="20" placeholder="Opcional"></label><div class="nexus-company-actions"><button type="button" data-close-company>Cancelar</button><button class="primary" id="nexusCreateCompany" type="submit">Criar empresa</button></div></form></div>`;
    document.body.appendChild(modal);
    const close = () => { modal.hidden = true; document.body.style.overflow = ''; };
    modal.querySelector('[data-close-company]').onclick = close;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
    return modal;
  }

  async function setupPortalMultiCompany(session) {
    if (!location.pathname.includes('/apps/portal-cliente/') || !document.querySelector('.summary') || document.getElementById('nexusAccountPanel')) return;
    try {
      const [summary, organizations] = await Promise.all([getAccountSummary(), listOrganizations()]);
      if (!summary || summary.accountType !== 'consultancy') return;
      injectMultiCompanyStyles();
      const panel = document.createElement('section');
      panel.id = 'nexusAccountPanel';
      panel.className = 'nexus-account-panel';
      const employeeUsage = summary.employeeLimitTotal ? `${summary.activeEmployeeCount} / ${summary.employeeLimitTotal}` : `${summary.activeEmployeeCount} / sob consulta`;
      const accountHead = document.createElement('div');
      accountHead.className = 'nexus-account-head';
      const accountCopy = document.createElement('div');
      const accountTitle = document.createElement('h2');
      accountTitle.textContent = summary.accountName || 'Conta multiempresa';
      const accountDescription = document.createElement('p');
      accountDescription.textContent = 'Selecione a empresa que deseja administrar. Cada empresa mantém dados, documentos, colaboradores e indicadores isolados.';
      accountCopy.append(accountTitle, accountDescription);

      const accountMetrics = document.createElement('div');
      accountMetrics.className = 'nexus-account-metrics';
      const companyMetric = document.createElement('span');
      companyMetric.className = 'nexus-account-pill';
      companyMetric.append('Empresas ');
      const companyMetricValue = document.createElement('b');
      companyMetricValue.textContent = `${summary.organizationCount} / ${summary.organizationLimit}`;
      companyMetric.appendChild(companyMetricValue);
      const employeeMetric = document.createElement('span');
      employeeMetric.className = 'nexus-account-pill';
      employeeMetric.append('Colaboradores ativos ');
      const employeeMetricValue = document.createElement('b');
      employeeMetricValue.textContent = employeeUsage;
      employeeMetric.appendChild(employeeMetricValue);
      accountMetrics.append(companyMetric, employeeMetric);
      accountHead.append(accountCopy, accountMetrics);

      const companyGrid = document.createElement('div');
      companyGrid.className = 'nexus-company-grid';
      organizations.forEach(org => {
        const card = document.createElement('article');
        card.className = `nexus-company-card${org.isCurrent ? ' current' : ''}`;
        const cardCopy = document.createElement('div');
        const companyName = document.createElement('strong');
        companyName.textContent = org.name;
        const companyState = document.createElement('small');
        companyState.textContent = org.isCurrent ? 'Empresa selecionada' : 'Empresa da conta';
        cardCopy.append(companyName, companyState);
        if (org.isCurrent) {
          const current = document.createElement('span');
          current.className = 'nexus-account-pill';
          current.textContent = 'Atual';
          card.append(cardCopy, current);
        } else {
          const switchButton = document.createElement('button');
          switchButton.type = 'button';
          switchButton.dataset.switchCompany = org.id;
          switchButton.textContent = 'Selecionar';
          card.append(cardCopy, switchButton);
        }
        companyGrid.appendChild(card);
      });

      panel.append(accountHead, companyGrid);
      if (['owner','manager'].includes(summary.accountRole) && summary.organizationCount < summary.organizationLimit) {
        const newCompanyButton = document.createElement('button');
        newCompanyButton.className = 'nexus-new-company';
        newCompanyButton.id = 'nexusNewCompany';
        newCompanyButton.type = 'button';
        newCompanyButton.textContent = '+ Nova empresa';
        panel.appendChild(newCompanyButton);
      }
      const summaryElement = document.querySelector('.summary');
      summaryElement.insertAdjacentElement('afterend', panel);

      panel.querySelectorAll('[data-switch-company]').forEach(button => {
        button.onclick = async () => {
          button.disabled = true;
          button.textContent = 'Abrindo...';
          try { await switchOrganization(button.dataset.switchCompany); location.reload(); }
          catch (error) { alert(error.message || 'Não foi possível trocar de empresa.'); button.disabled = false; button.textContent = 'Selecionar'; }
        };
      });

      const newButton = document.getElementById('nexusNewCompany');
      if (newButton) {
        const modal = buildCompanyModal();
        newButton.onclick = () => { modal.hidden = false; document.body.style.overflow = 'hidden'; setTimeout(() => document.getElementById('nexusCompanyName')?.focus(), 0); };
        document.getElementById('nexusCompanyForm').onsubmit = async event => {
          event.preventDefault();
          const submit = document.getElementById('nexusCreateCompany');
          submit.disabled = true;
          const original = submit.textContent;
          submit.textContent = 'Criando...';
          try {
            const newOrganizationId = await createManagedOrganization({
              name: document.getElementById('nexusCompanyName').value,
              registrationType: document.getElementById('nexusCompanyDocumentType').value || null,
              registrationNumber: document.getElementById('nexusCompanyDocument').value || null
            });
            await switchOrganization(newOrganizationId);
            location.reload();
          } catch (error) {
            alert(error.message || 'Não foi possível criar a empresa.');
            submit.disabled = false;
            submit.textContent = original;
          }
        };
      }
    } catch (error) {
      console.error('[Nexus conta multiempresa]', error);
    }
  }

  async function initMultiCompanyUi() {
    const needsGlobalSelector = !!document.getElementById('globalCompany');
    const needsPortalPanel = location.pathname.includes('/apps/portal-cliente/') && !!document.querySelector('.summary');
    if (!needsGlobalSelector && !needsPortalPanel) return;
    try {
      const session = await restoreSession();
      if (!session) return;
      if (needsGlobalSelector) await setupGlobalCompanySelector(session);
      if (needsPortalPanel) await setupPortalMultiCompany(session);
    } catch (error) {
      console.error('[Nexus multiempresa init]', error);
      if (needsGlobalSelector && location.pathname.includes('/apps/sst-controle/')) {
        await getClient().auth.signOut({ scope: 'local' }).catch(() => undefined);
        sessionStorage.removeItem('nexus_demo_session');
        alert(error.message || 'Seu acesso ao Nexus SST não está disponível.');
        location.replace('../portal-cliente/');
      }
    }
  }

  function loadAdminPilotModule() {
    if (!location.pathname.includes('/apps/nexus-admin/')) return;
    if (/\/apps\/nexus-admin\/login(?:\.html)?\/?$/.test(location.pathname)) return;
    if (document.querySelector('script[data-nexus-pilot-admin]')) return;
    const script = document.createElement('script');
    script.src = 'pilot.js';
    script.async = true;
    script.dataset.nexusPilotAdmin = 'true';
    document.head.appendChild(script);
  }

  window.NexusAuth = {
    login,
    logout,
    restoreSession,
    getClient,
    enforceAdminMfaSession,
    listOrganizations,
    getAccountSummary,
    switchOrganization,
    createManagedOrganization
  };

  loadAdminPilotModule();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMultiCompanyUi, { once: true });
  else setTimeout(initMultiCompanyUi, 0);
})();
