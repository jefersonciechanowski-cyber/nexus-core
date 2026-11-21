/* Preview visual local: sem API, dados, credenciais, comandos ou armazenamento. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', async function () {
    try {
      if (!window.NexusAuth?.restoreSession || !window.NexusAuth?.getClient) return;
      const session = await window.NexusAuth.restoreSession();
      if (session?.role !== 'nexus_admin') return;
      const client = window.NexusAuth.getClient();
      const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error || assurance.data?.currentLevel !== 'aal2') return;
      window.enableNexusAIPreview(session);
    } catch {
      // Negar a exibição da prévia em qualquer erro de sessão ou MFA.
    }
  });
  window.enableNexusAIPreview = function (session) {
    if (!session || session.role !== 'nexus_admin' || document.getElementById('nexus-ai-preview-trigger')) return;
    const nav = document.querySelector('.side .nav');
    if (!nav) return;
    const style = document.createElement('style');
    style.textContent = `
      .nexus-ai-preview-trigger{border:1px solid rgba(224,184,74,.4)!important;color:#e0b84a!important;background:rgba(224,184,74,.07)!important}
      .nexus-ai-preview-trigger:hover{background:rgba(224,184,74,.14)!important}
      .nexus-ai-preview-dialog{background:radial-gradient(ellipse at 60% 0%,#18313b,#090f14 60%,#070d11);color:#f5eee0;border:1px solid #465056;border-radius:16px;width:min(1080px,95vw);max-height:90vh;padding:0;box-shadow:0 24px 85px #0009}
      .nexus-ai-preview-dialog::backdrop{background:rgba(0,0,0,.82)}
      .nexus-ai-preview-content{padding:28px;overflow:auto;max-height:88vh;font-family:Inter,"Segoe UI",Arial,sans-serif}
      .nexus-ai-preview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
      .nexus-ai-preview-head h2{font-size:clamp(28px,4vw,44px);margin:5px 0}
      .nexus-ai-preview-kicker{letter-spacing:.17em;font-size:11px;color:#e0b84a}
      .nexus-ai-preview-muted{color:#9eabb0;font-size:13px;line-height:1.6}
      .nexus-ai-preview-close{color:#e0b84a;background:#13232b;border:1px solid #465056;border-radius:8px;padding:8px 12px;cursor:pointer}
      .nexus-ai-preview-orb{width:120px;height:120px;margin:40px auto 28px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#e6db9a,#d3b757 11%,#4b7c8a 31%,#14323b 60%,#071015 76%);box-shadow:0 0 40px #5ba2ae55,0 0 90px #d7b64a22;animation:nexus-ai-preview-breathe 5s ease-in-out infinite}
      .nexus-ai-preview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:28px 0}
      .nexus-ai-preview-card{border:1px solid #314047;border-radius:13px;padding:18px;background:#101b21}
      .nexus-ai-preview-card h3{margin:0 0 12px;font-size:16px}
      .nexus-ai-preview-card p{font-size:12px;color:#9eabb0;margin:4px 0}
      .nexus-ai-preview-card strong{font-size:13px;color:#e0b84a}
      .nexus-ai-preview-note{border:1px solid #314047;background:#101b21;padding:18px;border-radius:13px}
      @keyframes nexus-ai-preview-breathe{50%{transform:scale(1.04);filter:brightness(1.2)}}
      @media(max-width:760px){.nexus-ai-preview-grid{grid-template-columns:repeat(2,1fr)}}
      @media(max-width:440px){.nexus-ai-preview-grid{grid-template-columns:1fr}}
      @media(prefers-reduced-motion:reduce){.nexus-ai-preview-orb{animation:none}}
    `;
    document.head.appendChild(style);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'nexus-ai-preview-trigger';
    trigger.className = 'nexus-ai-preview-trigger';
    trigger.textContent = 'Visualizar Nexus AI';
    nav.appendChild(trigger);
    const dialog = document.createElement('dialog');
    dialog.className = 'nexus-ai-preview-dialog';
    dialog.setAttribute('aria-label', 'Prévia visual do Nexus AI');
    dialog.innerHTML = `
      <div class="nexus-ai-preview-content">
        <header class="nexus-ai-preview-head"><div><span class="nexus-ai-preview-kicker">NEXUS CORE · CONCEITO VISUAL</span><h2>Nexus AI</h2><div class="nexus-ai-preview-muted">Centro de inteligência do ecossistema</div></div><button class="nexus-ai-preview-close" type="button">Fechar</button></header>
        <div class="nexus-ai-preview-orb" aria-hidden="true"></div>
        <div style="text-align:center"><span class="nexus-ai-preview-kicker">NEXUS · INTELIGÊNCIA CENTRAL</span><p class="nexus-ai-preview-muted">Uma visão integrada de cada unidade.</p></div>
        <div class="nexus-ai-preview-grid" aria-label="Painéis ilustrativos">
          <div class="nexus-ai-preview-card"><h3>Nexus CRM</h3><p>Indicadores</p><strong>Aguardando integração</strong></div>
          <div class="nexus-ai-preview-card"><h3>SST Controle</h3><p>Indicadores</p><strong>Aguardando integração</strong></div>
          <div class="nexus-ai-preview-card"><h3>Nexus Agency</h3><p>Indicadores</p><strong>Aguardando integração</strong></div>
          <div class="nexus-ai-preview-card"><h3>Nexus Core</h3><p>Visão consolidada</p><strong>Aguardando integração</strong></div>
        </div>
        <div class="nexus-ai-preview-note"><strong>Assistente Nexus</strong><p class="nexus-ai-preview-muted">Esta é somente uma demonstração do visual. A IA NVIDIA, a voz e as consultas de dados ainda não estão disponíveis. Nenhuma informação é enviada ou alterada.</p></div>
      </div>`;
    document.body.appendChild(dialog);
    trigger.addEventListener('click', () => dialog.showModal());
    dialog.querySelector('.nexus-ai-preview-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  };
})();
