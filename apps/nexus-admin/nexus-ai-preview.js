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
.nexus-ai-preview-trigger{border:1px solid #ae8e4b!important;background:linear-gradient(120deg,#b7903219,#4b9ca319)!important;color:#e9c679!important;font-weight:650}
.nexus-ai-preview-trigger::before{content:'✧';margin-right:7px;font-size:18px}
.nexus-ai-preview-dialog{width:min(1150px,96vw);max-width:96vw;max-height:92vh;margin:auto;padding:0;border-radius:20px;border:1px solid #42606a;overflow:hidden;background:#08121b;color:#f5f1e9;box-shadow:0 30px 100px #000b;font-family:Inter,'Segoe UI',Arial,sans-serif}
.nexus-ai-preview-dialog::backdrop{background:#020911dd;backdrop-filter:blur(6px)}
.nexus-ai-preview-dialog *{box-sizing:border-box}
.nexus-ai-preview-content{padding:clamp(18px,3vw,34px);max-height:92vh;overflow:auto;overscroll-behavior:contain;background:radial-gradient(ellipse 65% 34% at 50% 27%,#276b8a40,transparent 80%),radial-gradient(ellipse 50% 28% at 90% 0%,#a8832914,transparent 80%),repeating-linear-gradient(0deg,transparent 0 40px,#5b9eac0a 41px),repeating-linear-gradient(90deg,transparent 0 40px,#5b9eac0a 41px),#080f17}
.nexus-ai-preview-head{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #657f8c40;padding-bottom:22px}
.nexus-ai-preview-brand{display:flex;align-items:center;gap:12px}
.nexus-ai-preview-emblem{min-width:44px;height:44px;border:1px solid #a98a52aa;border-radius:13px;display:grid;place-items:center;color:#eac882;background:#24364299;box-shadow:0 0 24px #af8a3030;font-size:23px}
.nexus-ai-preview-eyebrow{color:#ceb780;font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:700}
.nexus-ai-preview-head h2{font-size:clamp(27px,3vw,39px);font-weight:650;letter-spacing:-.045em;margin:4px 0}
.nexus-ai-preview-muted{color:#99afbb;font-size:12px;line-height:1.6}
.nexus-ai-preview-actions{display:flex;gap:9px;align-items:center}
.nexus-ai-preview-mode{border:1px solid #d7ad7059;border-radius:999px;color:#eed49e;background:#daaf6115;padding:8px 11px;font-size:10px;white-space:nowrap}
.nexus-ai-preview-close{border:1px solid #607988;border-radius:9px;color:#edf1f1;background:#20313c66;padding:9px 13px;cursor:pointer;font-size:12px}
.nexus-ai-preview-close:hover,.nexus-ai-preview-close:focus-visible{border-color:#e3c080;background:#294452}
.nexus-ai-preview-hero{text-align:center;padding-top:9px}
.nexus-ai-preview-core{height:266px;position:relative;display:grid;place-items:center;isolation:isolate}
.nexus-ai-preview-core::before{content:'';position:absolute;width:360px;height:250px;background:radial-gradient(ellipse,#3cabc230,transparent 73%);filter:blur(14px);z-index:-1}
.nexus-ai-preview-ring{width:246px;height:246px;border-radius:50%;border:1px solid #71c0d249;position:absolute;animation:nexus-ai-orbit 28s linear infinite}
.nexus-ai-preview-ring::before{content:'';inset:-1px;border-radius:50%;position:absolute;border:2px solid transparent;border-top-color:#87deeb;border-bottom-color:#dfba7370}
.nexus-ai-preview-ring.r2{width:286px;height:286px;border-style:dashed;border-color:#e0b76a46;animation-direction:reverse;animation-duration:39s}
.nexus-ai-preview-ring.r2::before{border-width:1px;border-top-color:#e7c583bd;border-bottom-color:transparent}
.nexus-ai-preview-ring.r3{width:320px;height:320px;border-color:#5c93aa22;animation-duration:52s}
.nexus-ai-preview-ring.r3::before{border-width:1px;border-top-color:#79acbd55;border-bottom-color:transparent}
.nexus-ai-preview-orb{width:188px;height:188px;border-radius:50%;position:relative;background:radial-gradient(circle at 31% 23%,#fff0be,#e7d292 8%,#75c8dd 18%,#2588b6 38%,#133f5e 66%,#06101b 88%);box-shadow:inset -19px -21px 45px #020609bc,inset 13px 11px 25px #c4eeeb55,0 0 42px #4baedb77,0 0 92px #49bbce38;animation:nexus-ai-breathe 5.5s ease-in-out infinite}
.nexus-ai-preview-orb::after{content:'';position:absolute;inset:14%;border:1px solid #c5eef540;border-radius:50%;box-shadow:inset 0 0 20px #a3e9eb1e}
.nexus-ai-preview-hero h3{font-size:clamp(18px,2.3vw,24px);letter-spacing:-.025em;font-weight:550;margin:12px 0 6px}
.nexus-ai-preview-hero p{font-size:12px;color:#a5bdc6;margin:0;line-height:1.6}
.nexus-ai-preview-section-head{display:flex;justify-content:space-between;align-items:center;margin:27px 0 13px;gap:12px}
.nexus-ai-preview-section-head h3{font-size:16px;font-weight:650;margin:0}
.nexus-ai-preview-section-head small{color:#92aab7;font-size:11px}
.nexus-ai-preview-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.nexus-ai-preview-card{padding:17px;min-height:155px;border-radius:15px;border:1px solid #63889666;background:linear-gradient(148deg,#213541cc,#101e2aee);transition:transform .22s,border-color .22s}
.nexus-ai-preview-card:hover{border-color:#c59d59;transform:translateY(-2px)}
.nexus-ai-preview-card-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
.nexus-ai-preview-symbol{height:30px;width:30px;border:1px solid #6fa9ba62;border-radius:9px;display:grid;place-items:center;color:#98d8e6;font-size:18px}
.nexus-ai-preview-card small{color:#a5b9c0;font-size:10px}
.nexus-ai-preview-card h4{font-size:16px;letter-spacing:-.02em;margin:18px 0 5px;font-weight:650}
.nexus-ai-preview-card p{font-size:11px;color:#a0b6c0;margin:0;line-height:1.55}
.nexus-ai-preview-foot{display:flex;gap:7px;align-items:center;border-top:1px solid #a4c5cf23;margin-top:14px;padding-top:11px;color:#e2bf82;font-size:10px}
.nexus-ai-preview-foot::before{content:'';height:6px;width:6px;border-radius:50%;border:1px solid #dbb679}
.nexus-ai-preview-console{margin-top:18px;padding:18px;border:1px solid #c7a46655;border-radius:15px;background:linear-gradient(125deg,#1a303dcc,#10202dea)}
.nexus-ai-preview-console-head{display:flex;justify-content:space-between;align-items:center;gap:9px}
.nexus-ai-preview-console h3{font-size:15px;margin:0;font-weight:650}
.nexus-ai-preview-tag{border:1px solid #deb87755;border-radius:999px;padding:5px 9px;color:#ecd099;font-size:10px;white-space:nowrap}
.nexus-ai-preview-console p{font-size:12px;color:#a0b5bd;line-height:1.5;margin:8px 0 13px}
.nexus-ai-preview-prompt{display:flex;gap:9px}
.nexus-ai-preview-input{min-width:0;flex:1;background:#071923;color:#eff5f5;border:1px solid #86aaba8a;border-radius:10px;padding:12px 14px;font:inherit;font-size:13px}
.nexus-ai-preview-input::placeholder{color:#94aab4}
.nexus-ai-preview-send{border-radius:10px;border:1px solid #f1d9a7;background:linear-gradient(125deg,#f0d296,#d2a95c);color:#1d2730;padding:12px 18px;font-size:12px;font-weight:750;cursor:pointer}
.nexus-ai-preview-suggestions{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}
.nexus-ai-preview-suggestion{border:1px solid #83b0c350;color:#c5d2d5;background:#5490aa12;border-radius:999px;padding:7px 11px;font-size:11px;cursor:pointer}
.nexus-ai-preview-suggestion:hover,.nexus-ai-preview-suggestion:focus-visible{border-color:#96e2ef;color:white}
.nexus-ai-preview-answer{margin:12px 0 0!important;padding:11px 13px;background:#dab77712;border-left:2px solid #d6b577;border-radius:0 9px 9px 0;color:#e6cfaa!important}
.nexus-ai-preview-answer[hidden]{display:none}
.nexus-ai-preview-disclaimer{text-align:center;font-size:10px;color:#92a7af;margin:16px 0 0;line-height:1.6}
@keyframes nexus-ai-orbit{to{transform:rotate(360deg)}}
@keyframes nexus-ai-breathe{0%,100%{filter:brightness(.95);transform:scale(.99)}50%{filter:brightness(1.13);transform:scale(1.035)}}
@media(max-width:900px){.nexus-ai-preview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:570px){.nexus-ai-preview-content{padding:18px}.nexus-ai-preview-head{gap:8px}.nexus-ai-preview-brand{gap:7px}.nexus-ai-preview-emblem{min-width:34px;height:34px;font-size:19px}.nexus-ai-preview-mode{display:none}.nexus-ai-preview-close{padding:7px 10px}.nexus-ai-preview-core{height:240px}.nexus-ai-preview-orb{height:148px;width:148px}.nexus-ai-preview-ring{height:195px;width:195px}.nexus-ai-preview-ring.r2{height:226px;width:226px}.nexus-ai-preview-ring.r3{height:250px;width:250px}.nexus-ai-preview-section-head{flex-direction:column;align-items:start;gap:4px}.nexus-ai-preview-card{padding:14px;min-height:143px}.nexus-ai-preview-card h4{font-size:14px}.nexus-ai-preview-card small{font-size:9px}.nexus-ai-preview-prompt{flex-direction:column}}
@media(max-width:360px){.nexus-ai-preview-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.nexus-ai-preview-ring,.nexus-ai-preview-orb{animation:none!important}.nexus-ai-preview-card{transition:none}.nexus-ai-preview-card:hover{transform:none}}
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
<header class="nexus-ai-preview-head">
 <div class="nexus-ai-preview-brand"><span class="nexus-ai-preview-emblem" aria-hidden="true">✧</span><div><span class="nexus-ai-preview-eyebrow">Nexus Core Industrial Trust</span><h2>Nexus AI</h2><span class="nexus-ai-preview-muted">Centro de inteligência do ecossistema</span></div></div>
 <div class="nexus-ai-preview-actions"><span class="nexus-ai-preview-mode">Prévia demonstrativa</span><button class="nexus-ai-preview-close" type="button">Fechar ✕</button></div>
</header>
<section class="nexus-ai-preview-hero" aria-label="Núcleo visual do Nexus AI">
 <div class="nexus-ai-preview-core" aria-hidden="true"><span class="nexus-ai-preview-ring r3"></span><span class="nexus-ai-preview-ring r2"></span><span class="nexus-ai-preview-ring"></span><span class="nexus-ai-preview-orb"></span></div>
 <span class="nexus-ai-preview-eyebrow">Nexus · Inteligência Central</span><h3>Uma plataforma. Visão de todo o ecossistema.</h3><p>Interface em evolução · Sem processamento de dados nesta demonstração</p>
</section>
<section aria-labelledby="nexus-ai-preview-units">
 <div class="nexus-ai-preview-section-head"><h3 id="nexus-ai-preview-units">Unidades da Nexus</h3><small>Painéis ilustrativos · Dados ainda não conectados</small></div>
 <div class="nexus-ai-preview-grid">
  <article class="nexus-ai-preview-card"><div class="nexus-ai-preview-card-top"><span class="nexus-ai-preview-symbol" aria-hidden="true">◇</span><small>COMERCIAL</small></div><h4>Nexus CRM</h4><p>Leads · Negociações · Receita</p><div class="nexus-ai-preview-foot">Aguardando integração</div></article>
  <article class="nexus-ai-preview-card"><div class="nexus-ai-preview-card-top"><span class="nexus-ai-preview-symbol" aria-hidden="true">◎</span><small>OPERAÇÃO</small></div><h4>SST Controle</h4><p>Gestão · Atividades · Equipe</p><div class="nexus-ai-preview-foot">Aguardando integração</div></article>
  <article class="nexus-ai-preview-card"><div class="nexus-ai-preview-card-top"><span class="nexus-ai-preview-symbol" aria-hidden="true">✧</span><small>PERFORMANCE</small></div><h4>Nexus Agency</h4><p>Clientes · Entregas · Resultado</p><div class="nexus-ai-preview-foot">Aguardando integração</div></article>
  <article class="nexus-ai-preview-card"><div class="nexus-ai-preview-card-top"><span class="nexus-ai-preview-symbol" aria-hidden="true">⬡</span><small>ESTRATÉGIA</small></div><h4>Nexus Core</h4><p>Crescimento · Gestão · Governança</p><div class="nexus-ai-preview-foot">Aguardando integração</div></article>
 </div>
</section>
<section class="nexus-ai-preview-console" aria-labelledby="nexus-ai-preview-chat-title">
 <div class="nexus-ai-preview-console-head"><h3 id="nexus-ai-preview-chat-title">Converse com o Nexus</h3><span class="nexus-ai-preview-tag">Simulação visual</span></div>
 <p>Veja como será a área de comandos. Nenhuma pergunta é enviada para uma IA nesta versão.</p>
 <form class="nexus-ai-preview-prompt"><input class="nexus-ai-preview-input" required type="text" maxlength="240" autocomplete="off" placeholder="Ex.: Como está a operação do CRM?" aria-label="Pergunta de demonstração"><button class="nexus-ai-preview-send" type="submit">Perguntar ↗</button></form>
 <div class="nexus-ai-preview-suggestions" aria-label="Comandos ilustrativos"><button class="nexus-ai-preview-suggestion" type="button" data-demo="Resumo do CRM">Resumo do CRM</button><button class="nexus-ai-preview-suggestion" type="button" data-demo="Visão da operação">Visão da operação</button><button class="nexus-ai-preview-suggestion" type="button" data-demo="Pendências prioritárias">Pendências prioritárias</button></div>
 <p class="nexus-ai-preview-answer" aria-live="polite" hidden></p>
</section>
<p class="nexus-ai-preview-disclaimer">Conceito visual isolado · Sem NVIDIA, consultas a clientes, dados financeiros ou ações administrativas</p>
</div>
    `;
    document.body.appendChild(dialog);
    trigger.addEventListener('click', () => dialog.showModal());
    dialog.querySelector('.nexus-ai-preview-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const previewInput = dialog.querySelector('.nexus-ai-preview-input');
    const previewAnswer = dialog.querySelector('.nexus-ai-preview-answer');
    dialog.querySelector('.nexus-ai-preview-prompt').addEventListener('submit', function (event) {
      event.preventDefault();
      previewAnswer.textContent = 'Esta é uma simulação visual. O Nexus AI ainda não está conectado e nenhuma pergunta foi enviada.';
      previewAnswer.hidden = false;
    });
    dialog.querySelectorAll('.nexus-ai-preview-suggestion').forEach(function (button) {
      button.addEventListener('click', function () {
        previewInput.value = button.dataset.demo;
        previewAnswer.hidden = true;
        previewInput.focus();
      });
    });
  };
})();
