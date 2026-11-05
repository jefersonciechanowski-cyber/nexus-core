(() => {
  'use strict';

  const query = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const tokenHash = query.get('token_hash');
  const tokenType = query.get('type') || 'recovery';
  const hashRecovery = hashParams.get('type') === 'recovery';
  const hashError = hashParams.get('error_code') || hashParams.get('error');
  const cfg = window.NEXUS_SUPABASE_CONFIG;
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, detectSessionInUrl: true }
  });

  const pass = document.getElementById('password');
  const confirm = document.getElementById('confirm');
  const save = document.getElementById('save');
  const message = document.getElementById('message');
  const sessionText = document.getElementById('sessionText');
  const mfaField = document.getElementById('mfaField');
  const mfaCode = document.getElementById('mfaCode');

  let recoveryUserId = null;
  let mfaFactorId = null;
  let completed = false;
  let invalidLink = false;

  function show(text, type = '') {
    message.textContent = text;
    message.className = 'message ' + type;
  }

  function invalid(text = 'Este link é inválido, expirou ou já foi usado. Solicite um novo link para continuar.') {
    invalidLink = true;
    save.disabled = true;
    save.textContent = 'Salvar nova senha';
    sessionText.textContent = 'Não foi possível validar o link de acesso.';
    show(text, 'error');
  }

  async function establishRecoverySession() {
    if (recoveryUserId) {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session || data.session.user?.id !== recoveryUserId) {
        throw new Error('Sua sessão de recuperação expirou. Solicite um novo link.');
      }
      return data.session;
    }

    let session;
    if (tokenHash) {
      await client.auth.signOut({ scope: 'local' });
      const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: tokenType });
      if (error || !data?.session) throw error || new Error('Link inválido ou expirado.');
      session = data.session;
    } else if (hashError) {
      throw new Error('Link inválido ou expirado.');
    } else if (hashRecovery) {
      const { data, error } = await client.auth.getSession();
      if (error || !data?.session) throw error || new Error('Link inválido ou expirado.');
      session = data.session;
    } else {
      throw new Error('Abra esta página pelo botão enviado no e-mail de primeiro acesso ou recuperação de senha.');
    }

    if (!session.user?.id) throw new Error('Não foi possível identificar a conta deste link.');
    recoveryUserId = session.user.id;
    return session;
  }

  async function requireSecondFactor(session) {
    const { data: assurance, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    if (assurance?.currentLevel === 'aal2' || assurance?.nextLevel !== 'aal2') return true;

    if (!mfaFactorId) {
      const { data, error: listError } = await client.auth.mfa.listFactors();
      if (listError) throw listError;
      const verified = (data?.totp || []).find(factor => factor.status === 'verified');
      if (!verified) throw new Error('Não foi encontrado o autenticador da conta. Entre em contato com o suporte Nexus.');
      mfaFactorId = verified.id;
      mfaField.hidden = false;
      sessionText.textContent = 'Link validado. Para proteger sua conta, informe o código do aplicativo autenticador.';
      save.textContent = 'Verificar e salvar senha';
      show('Confirme a verificação em duas etapas para definir a nova senha.');
      mfaCode.focus();
      return false;
    }

    const code = mfaCode.value.replace(/\D/g, '');
    if (code.length !== 6) {
      show('Informe o código de 6 dígitos do aplicativo autenticador.', 'error');
      return false;
    }

    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code });
    if (verifyError) {
      show('Código inválido ou expirado. Informe o código atual do autenticador.', 'error');
      mfaCode.select();
      return false;
    }

    const { data: verifiedAssurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || verifiedAssurance?.currentLevel !== 'aal2') {
      throw assuranceError || new Error('A verificação em duas etapas não foi concluída.');
    }
    return true;
  }

  async function update() {
    if (completed || invalidLink || save.disabled) return;
    const password = pass.value;
    show('');
    if (password.length < 8) return show('A senha precisa ter pelo menos 8 caracteres.', 'error');
    if (password !== confirm.value) return show('As senhas digitadas não são iguais.', 'error');

    save.disabled = true;
    save.textContent = mfaFactorId ? 'Verificando código...' : 'Validando acesso...';
    try {
      const session = await establishRecoverySession();
      if (!(await requireSecondFactor(session))) return;

      sessionText.textContent = `Acesso validado para ${session.user.email || 'o usuário Nexus'}. Salvando nova senha...`;
      save.textContent = 'Salvando...';
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;

      completed = true;
      show('Senha definida com sucesso. Você será direcionado para o login.', 'success');
      setTimeout(async () => {
        try { await client.auth.signOut({ scope: 'local' }); } catch {}
        location.replace('login.html');
      }, 1400);
    } catch (error) {
      if (!recoveryUserId || /sessão de recuperação expirou/i.test(error?.message || '')) {
        invalid(error?.message);
      } else if (error?.code === 'insufficient_aal') {
        show('Esta conta exige verificação em duas etapas para alterar a senha.', 'error');
      } else {
        show(error?.message || 'Não foi possível salvar a senha. Tente novamente.', 'error');
      }
    } finally {
      if (!completed && !invalidLink) {
        save.disabled = false;
        save.textContent = mfaFactorId ? 'Verificar e salvar senha' : 'Salvar nova senha';
      }
    }
  }

  save.onclick = update;
  mfaCode.addEventListener('input', () => {
    mfaCode.value = mfaCode.value.replace(/\D/g, '').slice(0, 6);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !save.disabled) update();
  });

  if (!tokenHash && !hashRecovery) {
    invalid(hashError
      ? 'Este link expirou ou já foi usado. Solicite um novo link para continuar.'
      : 'Abra esta página pelo botão enviado no e-mail de primeiro acesso ou recuperação de senha.');
  } else if (tokenHash) {
    sessionText.textContent = 'Link de primeiro acesso pronto. Defina a nova senha e clique em Salvar.';
  }
})();
