(() => {
  'use strict';

  const ADMIN_MFA_MAX_AGE_SECONDS = 7200;

  async function enforceAdminMfaSession() {
    if (/\/apps\/nexus-admin\/login(?:\.html)?\/?$/.test(location.pathname)) return true;
    const client = window.NexusAuth?.getClient?.();
    if (!client) return false;
    try {
      const session = await window.NexusAuth.restoreSession();
      if (!session || session.role !== 'nexus_admin') throw new Error('Sessão administrativa inválida.');
      let marker = null;
      try { marker = JSON.parse(sessionStorage.getItem('nexus_admin_mfa_session') || 'null'); } catch {}
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      const cutoff = Math.floor(Date.now() / 1000) - ADMIN_MFA_MAX_AGE_SECONDS;
      const recentTotp = (data?.currentAuthenticationMethods || []).some(item => item?.method === 'totp' && Number(item.timestamp) >= cutoff);
      const markerFresh = marker?.userId === session.userId && Date.now() - Number(marker.verifiedAt || 0) <= ADMIN_MFA_MAX_AGE_SECONDS * 1000;
      if (data?.currentLevel !== 'aal2' || !recentTotp || !markerFresh) throw new Error('MFA administrativo expirado.');
      return true;
    } catch {
      sessionStorage.removeItem('nexus_admin_mfa_session');
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
      location.replace('login.html?reason=mfa');
      return false;
    }
  }

  function injectStyles() {
    if (document.getElementById('nexusPilotAdminStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusPilotAdminStyles';
    style.textContent = `
      .pilot-card{margin-bottom:16px;padding:18px;border:1px solid rgba(224,184,74,.28);border-radius:12px;background:linear-gradient(135deg,rgba(224,184,74,.07),rgba(17,26,31,.96))}
      .pilot-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.pilot-head h3{margin:0;font-size:16px}.pilot-head p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.pilot-tag{padding:6px 9px;border:1px solid rgba(224,184,74,.34);border-radius:999px;color:var(--gold);font-size:10px;font-weight:800;white-space:nowrap}
      .pilot-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:11px;align-items:end}.pilot-field{grid-column:span 3;min-width:0}.pilot-field.pilot-plan{grid-column:span 7}.pilot-field.pilot-days{grid-column:span 2}.pilot-submit{grid-column:span 3}.pilot-field{display:grid;gap:6px}.pilot-field label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.pilot-field input,.pilot-field select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#0b1419;color:var(--text)}.pilot-submit{min-height:43px}
      .pilot-message{display:none;margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5}.pilot-message.good{display:block;color:#a8d2aa;border:1px solid rgba(114,168,117,.35);background:rgba(114,168,117,.08)}.pilot-message.warn{display:block;color:#dfc879;border:1px solid rgba(224,184,74,.3);background:rgba(224,184,74,.07)}.pilot-message.bad{display:block;color:#ec8d88;border:1px solid rgba(220,108,103,.3);background:rgba(220,108,103,.07)}
      .crm-control-row{display:flex;justify-content:space-between;gap:18px;align-items:center}.crm-control-row p{margin:0;color:var(--muted);font-size:12px;line-height:1.55;max-width:780px}.crm-control-link{display:inline-flex;align-items:center;justify-content:center;min-height:39px;text-decoration:none;white-space:nowrap}
      @media(max-width:1180px){.pilot-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.pilot-field{grid-column:span 3}.pilot-field.pilot-plan{grid-column:span 4}.pilot-field.pilot-days,.pilot-submit{grid-column:span 2;width:100%}}@media(max-width:760px){.pilot-head{flex-direction:column;align-items:stretch}.pilot-grid{grid-template-columns:1fr}.pilot-field,.pilot-field.pilot-plan,.pilot-field.pilot-days,.pilot-submit{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  async function edgeError(error) {
    try {
      if (error?.context && typeof error.context.json === 'function') {
        const payload = await error.context.json();
        if (payload?.error) return payload.error;
      }
    } catch { /* resposta sem JSON */ }
    return error?.message || 'Não foi possível criar o acesso piloto.';
  }

  function showMessage(element, text, type) {
    element.textContent = text;
    element.className = `pilot-message ${type}`;
  }

  const planInfo={essencial:{label:'Essencial',limit:50},profissional:{label:'Profissional',limit:100},empresarial:{label:'Empresarial',limit:250}};
  async function mount() {
    if (!await enforceAdminMfaSession()) return;
    const panel = document.querySelector('#view-clients > .panel');
    if (!panel || document.getElementById('pilotForm')) return;
    injectStyles();

    const card = document.createElement('section');
    card.className = 'pilot-card';
    card.innerHTML = `
      <div class="pilot-head"><div><h3>Criar acesso piloto — Nexus SST</h3><p>Teste gratuito e isolado, sem cobrança, com o limite de colaboradores do plano escolhido. Seus registros serão mantidos para a futura contratação.</p></div><span class="pilot-tag">PILOTO SST</span></div>
      <form id="pilotForm">
        <div class="pilot-grid">
          <div class="pilot-field"><label for="pilotCompany">Empresa</label><input id="pilotCompany" maxlength="160" required placeholder="Empresa do técnico"></div>
          <div class="pilot-field"><label for="pilotResponsible">Responsável</label><input id="pilotResponsible" maxlength="160" required placeholder="Nome completo"></div>
          <div class="pilot-field"><label for="pilotEmail">E-mail</label><input id="pilotEmail" type="email" maxlength="255" required placeholder="tecnico@empresa.com"></div>
          <div class="pilot-field"><label for="pilotPhone">Telefone</label><input id="pilotPhone" maxlength="20" placeholder="Opcional"></div>
          <div class="pilot-field pilot-plan"><label for="pilotTargetPlan">Plano em avaliação</label><select id="pilotTargetPlan" required><option value="essencial" selected>Essencial · até 50 colaboradores</option><option value="profissional">Profissional · até 100 colaboradores</option><option value="empresarial">Empresarial · até 250 colaboradores</option></select></div>
          <div class="pilot-field pilot-days"><label for="pilotDays">Duração</label><select id="pilotDays"><option value="15" selected>15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></div>
          <button class="action primary pilot-submit" id="pilotSubmit" type="submit">Criar piloto</button>
        </div>
        <div class="pilot-message" id="pilotMessage"></div>
      </form>`;

    panel.insertBefore(card, panel.firstChild);

    const form = card.querySelector('#pilotForm');
    const message = card.querySelector('#pilotMessage');
    const submit = card.querySelector('#pilotSubmit');
    window.openNexusPilotForm = () => { if(typeof window.setView==='function')window.setView('clients');card.scrollIntoView({behavior:'smooth',block:'start'});card.querySelector('#pilotCompany').focus({preventScroll:true}); };
    window.refreshPilotPlanChoices = (plans,products) => {
      const product=(products||[]).find(p=>p.code==='sst');if(!product)return;
      const options=(plans||[]).filter(p=>p.product_id===product.id&&p.status==='active'&&planInfo[p.code]);
      const select=card.querySelector('#pilotTargetPlan');
      for(const entry of select.options){ const plan=options.find(p=>p.code===entry.value);entry.disabled=!plan;if(plan){planInfo[entry.value].limit=Number(plan.employee_limit)||planInfo[entry.value].limit;entry.textContent=planInfo[entry.value].label+' · até '+planInfo[entry.value].limit+' colaboradores';}}
      if(select.selectedOptions[0]?.disabled)select.value=options[0]?.code||'';
    };

    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      const original = submit.textContent;
      submit.textContent = 'Criando...';
      message.className = 'pilot-message';

      try {
        const client = window.NexusAuth.getClient();
        const { data, error } = await client.functions.invoke('nexus-admin-pilot', {
          body: {
            companyName: card.querySelector('#pilotCompany').value,
            responsibleName: card.querySelector('#pilotResponsible').value,
            email: card.querySelector('#pilotEmail').value,
            phone: card.querySelector('#pilotPhone').value,
            days: Number(card.querySelector('#pilotDays').value),
            targetPlanCode: card.querySelector('#pilotTargetPlan').value,
          }
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'O backend não confirmou a criação do piloto.');

        const until = data.validUntil ? new Date(`${data.validUntil}T12:00:00`).toLocaleDateString('pt-BR') : 'data definida';
        const planLabel=planInfo[data.targetPlanCode||card.querySelector('#pilotTargetPlan').value]?.label||'selecionado';
        if (data.emailSent && data.permanentEmailSent) {
          showMessage(message, `Piloto ${planLabel} criado com sucesso até ${until}. Enviamos o primeiro acesso e um segundo e-mail com o link permanente da Minha Central para ${data.email}.`, 'good');
        } else if (data.emailSent) {
          showMessage(message, `Piloto ${planLabel} criado até ${until} e primeiro acesso enviado. O e-mail com o link permanente não foi enviado; oriente o usuário a entrar pelo site nexuscore.app.br em “Já sou cliente”.`, 'warn');
        } else {
          showMessage(message, `Piloto ${planLabel} criado até ${until}, mas o e-mail de primeiro acesso não foi enviado. Verifique a configuração da Brevo antes de entregar o acesso.`, 'warn');
        }
        form.reset();
        card.querySelector('#pilotDays').value = '15';
        if (typeof window.loadData === 'function') await window.loadData();
      } catch (error) {
        showMessage(message, await edgeError(error), 'bad');
      } finally {
        submit.disabled = false;
        submit.textContent = original;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
