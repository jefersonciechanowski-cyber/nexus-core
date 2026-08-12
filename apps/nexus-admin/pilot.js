(() => {
  'use strict';

  function injectStyles() {
    if (document.getElementById('nexusPilotAdminStyles')) return;
    const style = document.createElement('style');
    style.id = 'nexusPilotAdminStyles';
    style.textContent = `
      .pilot-card{margin-bottom:16px;padding:18px;border:1px solid rgba(224,184,74,.28);border-radius:12px;background:linear-gradient(135deg,rgba(224,184,74,.07),rgba(17,26,31,.96))}
      .pilot-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:14px}.pilot-head h3{margin:0;font-size:16px}.pilot-head p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.pilot-tag{padding:6px 9px;border:1px solid rgba(224,184,74,.34);border-radius:999px;color:var(--gold);font-size:10px;font-weight:800;white-space:nowrap}
      .pilot-grid{display:grid;grid-template-columns:1.3fr 1.1fr 1.2fr .9fr .72fr auto;gap:9px;align-items:end}.pilot-field{display:grid;gap:6px}.pilot-field label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.pilot-field input,.pilot-field select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#0b1419;color:var(--text)}.pilot-submit{min-height:39px}
      .pilot-message{display:none;margin-top:12px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5}.pilot-message.good{display:block;color:#a8d2aa;border:1px solid rgba(114,168,117,.35);background:rgba(114,168,117,.08)}.pilot-message.warn{display:block;color:#dfc879;border:1px solid rgba(224,184,74,.3);background:rgba(224,184,74,.07)}.pilot-message.bad{display:block;color:#ec8d88;border:1px solid rgba(220,108,103,.3);background:rgba(220,108,103,.07)}
      @media(max-width:1180px){.pilot-grid{grid-template-columns:1fr 1fr 1fr}.pilot-submit{width:100%}}@media(max-width:760px){.pilot-head{flex-direction:column}.pilot-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function normalizePilotPresentation() {
    ['overviewRows', 'clientRows'].forEach(id => {
      const tbody = document.getElementById(id);
      if (!tbody) return;
      [...tbody.querySelectorAll('tr')].forEach(row => {
        if (!String(row.textContent || '').includes('Nexus SST Piloto')) return;
        const cells = row.querySelectorAll('td');
        if (id === 'overviewRows' && cells.length >= 5) {
          cells[3].textContent = 'Cortesia';
          const badge = cells[4].querySelector('.badge');
          if (badge) badge.textContent = 'Piloto';
        }
        if (id === 'clientRows' && cells.length >= 6) {
          cells[3].textContent = 'Cortesia';
          const badge = cells[4].querySelector('.badge');
          if (badge) badge.textContent = 'Piloto';
        }
      });
    });

    const detail = document.getElementById('clientDetail');
    if (detail && !detail.hidden && String(detail.textContent || '').includes('Nexus SST Piloto')) {
      [...detail.querySelectorAll('.detail-item')].forEach(item => {
        const label = item.querySelector('span');
        const value = item.querySelector('strong');
        if (!label || !value) return;
        const key = String(label.textContent || '').trim();
        if (key === 'Valor contratado') value.textContent = 'Cortesia';
        if (key === 'Modelo') value.textContent = 'Piloto / sem cobrança';
        if (key === 'Situação') value.textContent = 'Piloto ativo';
        if (key === 'Última cobrança') value.textContent = 'Não se aplica';
        if (key === 'Provedor financeiro') value.textContent = 'Não se aplica';
        if (key === 'Assinatura no provedor') value.textContent = 'Não se aplica';
      });
    }
  }

  function watchPilotPresentation() {
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        normalizePilotPresentation();
      });
    };
    const observer = new MutationObserver(schedule);
    ['overviewRows', 'clientRows', 'clientDetail'].forEach(id => {
      const node = document.getElementById(id);
      if (node) observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    });
    schedule();
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

  function mount() {
    const panel = document.querySelector('#view-clients > .panel');
    if (!panel || document.getElementById('pilotForm')) return;
    injectStyles();
    watchPilotPresentation();

    const card = document.createElement('section');
    card.className = 'pilot-card';
    card.innerHTML = `
      <div class="pilot-head"><div><h3>Criar acesso piloto</h3><p>Cria uma empresa isolada, sem cobrança, e envia o primeiro acesso por e-mail. O piloto expira automaticamente na data definida.</p></div><span class="pilot-tag">CORTESIA INTERNA</span></div>
      <form id="pilotForm">
        <div class="pilot-grid">
          <div class="pilot-field"><label for="pilotCompany">Empresa</label><input id="pilotCompany" maxlength="160" required placeholder="Empresa do técnico"></div>
          <div class="pilot-field"><label for="pilotResponsible">Responsável</label><input id="pilotResponsible" maxlength="160" required placeholder="Nome completo"></div>
          <div class="pilot-field"><label for="pilotEmail">E-mail</label><input id="pilotEmail" type="email" maxlength="255" required placeholder="tecnico@empresa.com"></div>
          <div class="pilot-field"><label for="pilotPhone">Telefone</label><input id="pilotPhone" maxlength="20" placeholder="Opcional"></div>
          <div class="pilot-field"><label for="pilotDays">Duração</label><select id="pilotDays"><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></div>
          <button class="action primary pilot-submit" id="pilotSubmit" type="submit">Criar piloto</button>
        </div>
        <div class="pilot-message" id="pilotMessage"></div>
      </form>`;

    panel.insertBefore(card, panel.firstChild);
    const form = card.querySelector('#pilotForm');
    const message = card.querySelector('#pilotMessage');
    const submit = card.querySelector('#pilotSubmit');

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
          }
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'O backend não confirmou a criação do piloto.');

        const until = data.validUntil ? new Date(`${data.validUntil}T12:00:00`).toLocaleDateString('pt-BR') : 'data definida';
        if (data.emailSent) {
          showMessage(message, `Piloto criado com sucesso até ${until}. O primeiro acesso foi enviado para ${data.email}.`, 'good');
        } else {
          showMessage(message, `Piloto criado até ${until}, mas o e-mail de primeiro acesso não foi enviado. Verifique a configuração da Brevo antes de entregar o acesso.`, 'warn');
        }
        form.reset();
        card.querySelector('#pilotDays').value = '30';
        if (typeof window.loadData === 'function') await window.loadData();
        setTimeout(normalizePilotPresentation, 0);
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
