(() => {
  'use strict';

  const path = window.location.pathname;
  const allowed = ['/apps/site-captacao/', '/apps/portal-cliente/', '/apps/sst-controle/'];
  if (!allowed.some(prefix => path.includes(prefix))) return;
  if (document.querySelector('[data-nexus-support-center]')) return;

  const config = window.NEXUS_SUPABASE_CONFIG;
  const supportEmail = window.NEXUS_SUPPORT_EMAIL || 'suporte@nexuscore.app.br';

  function readSession() {
    try {
      const raw = sessionStorage.getItem('nexus_demo_session');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function sourceContext() {
    if (path.includes('/apps/sst-controle/')) return { source: 'sst-controle', productCode: 'sst' };
    if (path.includes('/apps/portal-cliente/')) return { source: 'portal-cliente', productCode: 'central-nexus' };
    if (path.includes('/apps/site-captacao/')) return { source: 'site-captacao', productCode: 'sst' };
    return { source: 'nexus-web', productCode: null };
  }

  function getClient() {
    if (window.NexusAuth?.getClient) {
      try { return window.NexusAuth.getClient(); } catch {}
    }
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) return null;
    return window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }

  async function functionErrorMessage(error) {
    try {
      if (error?.context && typeof error.context.json === 'function') {
        const payload = await error.context.json();
        if (payload?.error) return payload.error;
        if (payload?.message) return payload.message;
      }
    } catch {}
    return error?.message || 'Não foi possível enviar sua solicitação.';
  }

  document.querySelectorAll('[data-nexus-support]').forEach(element => element.remove());
  document.querySelectorAll('a[href^="mailto:suporte@"]').forEach(element => element.remove());

  const style = document.createElement('style');
  style.dataset.nexusSupportCenterStyle = 'true';
  style.textContent = `
    .nexus-support-root{position:fixed;right:22px;bottom:22px;z-index:12000;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#f5eee0}
    .nexus-support-trigger{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 16px;border:1px solid rgba(224,184,74,.52);border-radius:999px;background:linear-gradient(180deg,#111a1f,#0b1419);color:#f5eee0;font:700 13px/1 Inter,"Segoe UI",Arial,sans-serif;box-shadow:0 14px 38px rgba(0,0,0,.32);cursor:pointer}
    .nexus-support-trigger:hover{border-color:#e0b84a;background:#142028}.nexus-support-trigger strong{display:grid;place-items:center;width:23px;height:23px;border-radius:50%;background:#e0b84a;color:#17130a;font-size:14px}
    .nexus-support-panel{position:absolute;right:0;bottom:58px;width:min(390px,calc(100vw - 28px));border:1px solid #39454b;border-radius:15px;background:linear-gradient(180deg,#111a1f,#0b1419);box-shadow:0 24px 70px rgba(0,0,0,.48);overflow:hidden}
    .nexus-support-panel[hidden]{display:none}.nexus-support-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px 18px 14px;border-bottom:1px solid #2f393f;background:rgba(7,12,15,.72)}
    .nexus-support-head strong{display:block;font-size:15px}.nexus-support-head span{display:block;margin-top:5px;color:#98a2a7;font-size:11px;line-height:1.45}.nexus-support-close{border:0;background:transparent;color:#c7ced1;font:700 11px/1 Inter,"Segoe UI",Arial,sans-serif;cursor:pointer;padding:4px}
    .nexus-support-body{padding:16px 18px 18px}.nexus-support-context{margin-bottom:14px;padding:10px 11px;border:1px solid rgba(224,184,74,.18);border-radius:9px;background:rgba(224,184,74,.055);color:#c8c2b5;font-size:11px;line-height:1.5}
    .nexus-support-field{display:grid;gap:6px;margin-top:11px}.nexus-support-field label{color:#b7c0c4;font-size:11px;font-weight:700}.nexus-support-field input,.nexus-support-field textarea{width:100%;border:1px solid #39454b;border-radius:9px;background:#081116;color:#f5eee0;padding:10px 11px;font:13px/1.45 Inter,"Segoe UI",Arial,sans-serif;outline:none}
    .nexus-support-field textarea{min-height:118px;resize:vertical}.nexus-support-field input:focus,.nexus-support-field textarea:focus{border-color:#e0b84a;box-shadow:0 0 0 2px rgba(224,184,74,.09)}
    .nexus-support-actions{display:flex;gap:8px;align-items:center;margin-top:14px}.nexus-support-submit{flex:1;min-height:41px;border:1px solid #e0b84a;border-radius:9px;background:linear-gradient(180deg,#e2bb50,#c7962f);color:#17130a;font:800 12px/1 Inter,"Segoe UI",Arial,sans-serif;cursor:pointer}.nexus-support-submit:disabled{opacity:.58;cursor:wait}
    .nexus-support-mail{color:#9ca7ac;font-size:10px;text-decoration:none}.nexus-support-mail:hover{color:#e0b84a}.nexus-support-message{min-height:18px;margin-top:10px;color:#9ca7ac;font-size:11px;line-height:1.45}.nexus-support-message.good{color:#8fc895}.nexus-support-message.bad{color:#ec8d88}
    .nexus-support-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}
    @media(max-width:760px){.nexus-support-root{right:14px;bottom:calc(14px + env(safe-area-inset-bottom))}.nexus-support-root.has-mobile-bar{bottom:calc(82px + env(safe-area-inset-bottom))}.nexus-support-panel{bottom:56px;width:min(390px,calc(100vw - 28px));max-height:min(640px,calc(100vh - 130px));overflow:auto}.nexus-support-trigger{min-height:44px;padding:0 14px}.nexus-support-body{padding:15px}.nexus-support-head{padding:16px 15px 13px}}
  `;
  document.head.appendChild(style);

  const session = readSession();
  const loggedIn = Boolean(session?.email);
  const root = document.createElement('div');
  root.className = 'nexus-support-root';
  if (document.querySelector('.mobile-access-bar')) root.classList.add('has-mobile-bar');
  root.dataset.nexusSupportCenter = 'true';

  const contextText = loggedIn
    ? `${session.organizationName || 'Sua empresa'} · ${session.name || session.email}`
    : 'Envie sua dúvida e retornaremos pelo e-mail informado.';

  root.innerHTML = `
    <button class="nexus-support-trigger" type="button" aria-expanded="false" aria-controls="nexusSupportPanel"><strong>?</strong><span>Suporte</span></button>
    <section class="nexus-support-panel" id="nexusSupportPanel" role="dialog" aria-modal="false" aria-labelledby="nexusSupportTitle" hidden>
      <div class="nexus-support-head"><div><strong id="nexusSupportTitle">Central de Suporte</strong><span>Olá! Como podemos ajudar?</span></div><button class="nexus-support-close" type="button">Fechar</button></div>
      <form class="nexus-support-body" id="nexusSupportForm">
        <div class="nexus-support-context">${contextText.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}</div>
        ${loggedIn ? '' : '<div class="nexus-support-field"><label for="nexusSupportName">Seu nome</label><input id="nexusSupportName" maxlength="180" autocomplete="name" required></div><div class="nexus-support-field"><label for="nexusSupportEmail">Seu e-mail</label><input id="nexusSupportEmail" type="email" maxlength="254" autocomplete="email" required></div>'}
        <input class="nexus-support-hp" id="nexusSupportWebsite" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="nexus-support-field"><label for="nexusSupportMessage">Sua dúvida</label><textarea id="nexusSupportMessage" maxlength="4000" required placeholder="Digite sua dúvida ou descreva o problema aqui..."></textarea></div>
        <div class="nexus-support-actions"><button class="nexus-support-submit" id="nexusSupportSubmit" type="submit">Enviar solicitação</button><a class="nexus-support-mail" href="mailto:${supportEmail}">E-mail</a></div>
        <div class="nexus-support-message" id="nexusSupportFeedback" role="status" aria-live="polite"></div>
      </form>
    </section>`;

  document.body.appendChild(root);

  const trigger = root.querySelector('.nexus-support-trigger');
  const panel = root.querySelector('.nexus-support-panel');
  const closeButton = root.querySelector('.nexus-support-close');
  const form = root.querySelector('#nexusSupportForm');
  const textarea = root.querySelector('#nexusSupportMessage');
  const submit = root.querySelector('#nexusSupportSubmit');
  const feedback = root.querySelector('#nexusSupportFeedback');

  const setOpen = open => {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => textarea.focus(), 0);
  };

  trigger.addEventListener('click', () => setOpen(panel.hidden));
  closeButton.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    feedback.className = 'nexus-support-message';
    feedback.textContent = '';

    const name = loggedIn ? (session.name || session.email) : root.querySelector('#nexusSupportName').value.trim();
    const email = loggedIn ? session.email : root.querySelector('#nexusSupportEmail').value.trim();
    const message = textarea.value.trim();
    if (name.length < 2 || !email || message.length < 5) {
      feedback.classList.add('bad');
      feedback.textContent = 'Preencha seus dados e descreva sua dúvida com um pouco mais de detalhe.';
      return;
    }

    const client = getClient();
    if (!client) {
      feedback.classList.add('bad');
      feedback.textContent = `Não foi possível abrir o suporte agora. Use ${supportEmail}.`;
      return;
    }

    const { source, productCode } = sourceContext();
    submit.disabled = true;
    submit.textContent = 'Enviando...';

    try {
      const { data, error } = await client.functions.invoke('nexus-support', {
        body: {
          name,
          email,
          message,
          website: root.querySelector('#nexusSupportWebsite').value,
          source,
          productCode,
          pageUrl: location.href,
          pageTitle: document.title,
          userAgent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`
        }
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Não foi possível registrar sua solicitação.');

      textarea.value = '';
      feedback.classList.add('good');
      feedback.textContent = `Solicitação recebida. Protocolo ${data.protocol}.`;
    } catch (error) {
      feedback.classList.add('bad');
      feedback.textContent = await functionErrorMessage(error);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Enviar solicitação';
    }
  });
})();
