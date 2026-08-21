(() => {
  'use strict';

  const config = window.NEXUS_SUPABASE_CONFIG;
  const client = window.supabase.createClient(config.url, config.publishableKey);
  const email = document.getElementById('email');
  const button = document.getElementById('send');
  const message = document.getElementById('message');
  const successMessage = 'Se este e-mail estiver cadastrado, enviaremos as instruções para redefinir a senha.';

  function show(text, type) {
    message.textContent = text;
    message.className = `message ${type || ''}`.trim();
  }

  function isCaptchaError(error) {
    return `${error?.code || ''} ${error?.message || ''}`.toLowerCase().includes('captcha');
  }

  async function send() {
    const value = email.value.trim().toLowerCase();
    show('');
    if (!value || !value.includes('@')) {
      show('Informe um e-mail válido.', 'error');
      return;
    }

    button.disabled = true;
    button.textContent = 'Enviando...';
    try {
      const turnstile = window.NexusTurnstile;
      if (config.turnstileSiteKey && !turnstile?.requireToken) {
        throw new Error('A verificação de segurança não pôde ser carregada. Atualize a página e tente novamente.');
      }
      const captchaToken = turnstile?.requireToken();
      const redirectTo = `${location.origin}/apps/portal-cliente/redefinir-senha.html`;
      const { error } = await client.auth.resetPasswordForEmail(value, { redirectTo, captchaToken });
      if (error) throw error;
      show(successMessage, 'success');
    } catch (error) {
      if (isCaptchaError(error) || /verificação de segurança/i.test(error?.message || '')) {
        show(error?.message || 'A verificação de segurança expirou. Tente novamente.', 'error');
      } else {
        show(successMessage, 'success');
      }
    } finally {
      window.NexusTurnstile?.reset();
      button.disabled = false;
      button.textContent = 'Enviar instruções';
    }
  }

  button.addEventListener('click', send);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter') send();
  });
})();
