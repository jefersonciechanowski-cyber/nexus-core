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

  let client = null;

  function getRecoveryRedirectTarget() {
    const hash = window.location.hash || '';

    if (!hash) {
      return null;
    }

    const params = new URLSearchParams(hash.slice(1));
    const isRecovery = params.get('type') === 'recovery';
    const isRecoveryError = params.get('error_code') === 'otp_expired';

    if (!isRecovery && !isRecoveryError) {
      return null;
    }

    if (window.location.pathname.includes('/apps/portal-cliente/')) {
      return `redefinir-senha.html${hash}`;
    }

    if (window.location.pathname.includes('/apps/sst-controle/')) {
      return `../portal-cliente/redefinir-senha.html${hash}`;
    }

    return null;
  }

  function getClient() {
    const config = window.NEXUS_SUPABASE_CONFIG;

    if (!config?.url || !config?.publishableKey) {
      throw new Error('Configuração do Supabase não encontrada.');
    }

    if (!window.supabase?.createClient) {
      throw new Error('Biblioteca do Supabase não foi carregada.');
    }

    if (!client) {
      client = window.supabase.createClient(
        config.url,
        config.publishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true
          }
        }
      );
    }

    return client;
  }

  async function loadProfile(user) {
    const supabaseClient = getClient();

    const { data, error } = await supabaseClient
      .from('profiles')
      .select(`
        id,
        organization_id,
        full_name,
        role,
        active,
        organizations (
          name,
          slug,
          status
        )
      `)
      .eq('id', user.id)
      .single();

    if (error || !data) {
      throw new Error('Perfil de acesso não encontrado.');
    }

    if (!data.active) {
      throw new Error('Este usuário está inativo.');
    }

    const organization = Array.isArray(data.organizations)
      ? data.organizations[0]
      : data.organizations;

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

    sessionStorage.setItem(
      'nexus_demo_session',
      JSON.stringify(sessionData)
    );

    return sessionData;
  }

  async function login(email, password) {
    const supabaseClient = getClient();

    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email: String(email).trim().toLowerCase(),
        password
      });

    if (error || !data.user) {
      throw new Error('E-mail ou senha inválidos.');
    }

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

    return loadProfile(data.user);
  }

  async function logout() {
    const supabaseClient = getClient();
    sessionStorage.removeItem('nexus_demo_session');
    await supabaseClient.auth.signOut({ scope: 'local' });
  }

  window.NexusAuth = {
    login,
    logout,
    restoreSession,
    getClient
  };
})();