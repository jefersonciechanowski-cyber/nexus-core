(() => {
  if (window.NexusAIDrawer) return;

  const defaults = {
    productName: 'Nexus Core',
    packageName: 'Em preparação',
    usageLabel: '0 / 0',
    usagePercent: 0,
    disabled: true,
    suggestions: ['Como funciona este módulo?', 'Quais são os próximos passos?', 'O que devo revisar aqui?']
  };

  function mount(options = {}) {
    const config = { ...defaults, ...options };
    const root = document.createElement('div');
    root.className = 'nexus-ai-ui';
    root.innerHTML = `
      <style>
        .nexus-ai-ui{--nai-bg:#0b1419;--nai-panel:#111a1f;--nai-line:#2f393f;--nai-text:#f5eee0;--nai-muted:#98a2a7;--nai-gold:#e0b84a;--nai-soft:#1b252b;--nai-bad:#dc6c67;position:relative;z-index:2147483000}
        .nai-launcher{position:fixed;right:20px;bottom:88px;border:1px solid rgba(224,184,74,.6);background:linear-gradient(180deg,#121c21,#0c1419);color:var(--nai-text);border-radius:999px;padding:10px 14px;font:700 13px/1 Inter,"Segoe UI",Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;gap:8px}
        .nai-launcher-dot{width:8px;height:8px;border-radius:50%;background:var(--nai-gold);box-shadow:0 0 0 4px rgba(224,184,74,.08)}
        .nai-backdrop{position:fixed;inset:0;background:rgba(2,7,10,.4);opacity:0;pointer-events:none;transition:.2s ease}
        .nai-drawer{position:fixed;top:0;right:0;height:100vh;width:min(430px,100vw);background:linear-gradient(180deg,#0b1419,#0a1115);border-left:1px solid var(--nai-line);box-shadow:-24px 0 60px rgba(0,0,0,.35);transform:translateX(105%);transition:.24s ease;display:flex;flex-direction:column;font-family:Inter,"Segoe UI",Arial,sans-serif;color:var(--nai-text)}
        .nexus-ai-ui.is-open .nai-backdrop{opacity:1;pointer-events:auto}.nexus-ai-ui.is-open .nai-drawer{transform:translateX(0)}
        .nai-head{padding:18px;border-bottom:1px solid var(--nai-line);display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
        .nai-title{font-weight:800;font-size:18px}.nai-sub{margin-top:4px;color:var(--nai-muted);font-size:12px}.nai-close{border:1px solid var(--nai-line);background:transparent;color:var(--nai-text);width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:18px}
        .nai-body{padding:16px;overflow:auto;display:grid;gap:14px}.nai-card{background:var(--nai-panel);border:1px solid var(--nai-line);border-radius:12px;padding:14px}.nai-status{display:flex;align-items:center;gap:8px;font-size:12px;color:#d7cdb9}.nai-status i{width:8px;height:8px;border-radius:50%;background:var(--nai-gold)}
        .nai-usage-top{display:flex;justify-content:space-between;gap:12px;font-size:12px}.nai-usage-label{color:var(--nai-muted)}.nai-meter{height:8px;border-radius:99px;background:#081015;overflow:hidden;margin-top:9px;border:1px solid #253139}.nai-meter>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#c7962f,#e0b84a)}
        .nai-package{margin-top:9px;color:var(--nai-muted);font-size:11px}.nai-suggestions{display:flex;flex-wrap:wrap;gap:8px}.nai-chip{border:1px solid var(--nai-line);background:#0d171c;color:var(--nai-text);border-radius:999px;padding:8px 10px;font-size:11px;cursor:not-allowed;opacity:.75}
        .nai-label{font-size:11px;color:var(--nai-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}.nai-input{width:100%;min-height:110px;resize:none;border:1px solid var(--nai-line);background:#081116;color:var(--nai-text);border-radius:10px;padding:12px;font:inherit;opacity:.7}.nai-send{width:100%;margin-top:10px;border:1px solid rgba(224,184,74,.45);background:rgba(224,184,74,.12);color:#d7cdb9;border-radius:9px;padding:11px;font-weight:800;cursor:not-allowed;opacity:.72}.nai-note{color:var(--nai-muted);font-size:11px;line-height:1.5;margin-top:8px}
        @media(max-width:640px){.nai-launcher{right:14px;bottom:82px}.nai-drawer{width:100vw}}
      </style>
      <button class="nai-launcher" type="button" aria-label="Abrir Nexus AI"><span class="nai-launcher-dot"></span><span>Nexus AI</span></button>
      <div class="nai-backdrop"></div>
      <aside class="nai-drawer" aria-hidden="true">
        <div class="nai-head"><div><div class="nai-title">Nexus AI</div><div class="nai-sub">${config.productName}</div></div><button class="nai-close" type="button" aria-label="Fechar">×</button></div>
        <div class="nai-body">
          <div class="nai-card"><div class="nai-status"><i></i><strong>${config.disabled ? 'IA indisponível no momento' : 'IA disponível'}</strong></div><div class="nai-note">A interface está pronta. A execução real permanecerá desabilitada até a ativação do provedor.</div></div>
          <div class="nai-card"><div class="nai-usage-top"><strong>Uso mensal</strong><span>${config.usageLabel}</span></div><div class="nai-meter"><span style="width:${Math.max(0, Math.min(100, Number(config.usagePercent) || 0))}%"></span></div><div class="nai-package">Pacote: ${config.packageName}</div></div>
          <div class="nai-card"><div class="nai-label">Sugestões</div><div class="nai-suggestions">${config.suggestions.map(text => `<button class="nai-chip" type="button">${text}</button>`).join('')}</div></div>
          <div class="nai-card"><div class="nai-label">Converse com a Nexus AI</div><textarea class="nai-input" disabled placeholder="Digite sua pergunta aqui..."></textarea><button class="nai-send" type="button" disabled>Enviar</button><div class="nai-note">Recurso em preparação. Nenhuma chamada de IA é feita nesta versão visual.</div></div>
        </div>
      </aside>`;
    document.body.appendChild(root);
    const drawer = root.querySelector('.nai-drawer');
    const open = () => { root.classList.add('is-open'); drawer?.setAttribute('aria-hidden','false'); };
    const close = () => { root.classList.remove('is-open'); drawer?.setAttribute('aria-hidden','true'); };
    root.querySelector('.nai-launcher')?.addEventListener('click', open);
    root.querySelector('.nai-close')?.addEventListener('click', close);
    root.querySelector('.nai-backdrop')?.addEventListener('click', close);
    window.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    return { open, close, root };
  }

  window.NexusAIDrawer = { mount };
})();
