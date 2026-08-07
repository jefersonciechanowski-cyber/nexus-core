(() => {
  'use strict';

  let installed = false;

  const byId = id => document.getElementById(id);
  const fields = [
    'legal_name', 'trade_name', 'registration_type', 'registration_number',
    'state_registration', 'cnae_code', 'email', 'phone', 'postal_code',
    'street', 'street_number', 'address_complement', 'district', 'city', 'state',
    'legal_responsible_name', 'legal_responsible_cpf', 'legal_responsible_role'
  ];
  const brazilianStates = new Set([
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ]);

  function getClient() {
    if (!window.NexusAuth?.getClient) throw new Error('Cliente autenticado do Supabase não está disponível.');
    return window.NexusAuth.getClient();
  }

  function getOrganizationId() {
    const raw = sessionStorage.getItem('nexus_demo_session');
    if (!raw) throw new Error('Sessão autenticada não encontrada.');
    let session;
    try { session = JSON.parse(raw); } catch { throw new Error('Sessão autenticada inválida.'); }
    const organizationId = String(session?.organizationId || '').trim();
    if (!organizationId) throw new Error('Organização autenticada não foi identificada.');
    return organizationId;
  }

  function digits(value) { return String(value || '').replace(/\D/g, ''); }
  function isRepeated(value) { return /^(\d)\1+$/.test(value); }

  function formatCpf(value) {
    return digits(value).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2').slice(0, 14);
  }

  function formatCnpj(value) {
    return digits(value).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
  }

  function isValidCpf(value) {
    const cpf = digits(value);
    if (cpf.length !== 11 || isRepeated(cpf)) return false;
    const digit = length => {
      const sum = cpf.slice(0, length).split('').reduce((total, item, index) => total + Number(item) * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  }

  function isValidCnpj(value) {
    const cnpj = digits(value);
    if (cnpj.length !== 14 || isRepeated(cnpj)) return false;
    const digit = length => {
      let weight = length - 7;
      const sum = cnpj.slice(0, length).split('').reduce((total, item) => {
        const next = total + Number(item) * weight;
        weight = weight === 2 ? 9 : weight - 1;
        return next;
      }, 0);
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    return digit(12) === Number(cnpj[12]) && digit(13) === Number(cnpj[13]);
  }

  function setMessage(text, isError = false) {
    const element = byId('companyFormMessage');
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? 'var(--danger, #b91c1c)' : 'var(--success, #15803d)';
  }

  function applyMasks() {
    const registration = byId('companyRegistrationNumber');
    const registrationType = byId('companyRegistrationType');
    const cpf = byId('companyLegalResponsibleCpf');
    const cep = byId('companyPostalCode');
    const phone = byId('companyPhone');
    const masks = [
      [registration, value => registrationType?.value === 'CNPJ' ? formatCnpj(value) : registrationType?.value === 'CPF' ? formatCpf(value) : digits(value).slice(0, 14)],
      [cpf, formatCpf],
      [cep, value => value.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1-$2').slice(0, 9)],
      [phone, value => value.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15)]
    ];
    masks.forEach(([element, format]) => element?.addEventListener('input', () => { element.value = format(element.value); }));
    registrationType?.addEventListener('change', () => registration?.dispatchEvent(new Event('input')));
  }

  function payloadFromForm() {
    const registrationType = byId('companyRegistrationType').value;
    const registrationNumber = digits(byId('companyRegistrationNumber').value);
    const legalResponsibleCpf = digits(byId('companyLegalResponsibleCpf').value);
    const state = byId('companyState').value.trim().toUpperCase();
    const email = byId('companyEmail').value.trim();
    if (Boolean(registrationType) !== Boolean(registrationNumber)) throw new Error('Informe o tipo e o número da inscrição da empresa.');
    if (registrationType === 'CNPJ' && !isValidCnpj(registrationNumber)) throw new Error('Informe um CNPJ válido.');
    if (registrationType === 'CPF' && !isValidCpf(registrationNumber)) throw new Error('Informe um CPF válido.');

    if (legalResponsibleCpf && !isValidCpf(legalResponsibleCpf)) throw new Error('Informe um CPF válido para o responsável legal.');
    if (state && !brazilianStates.has(state)) throw new Error('Informe uma UF brasileira válida.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');

    const payload = {};
    fields.forEach(field => {
      const element = byId(`company${field.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`);
      payload[field] = element ? element.value.trim() || null : null;
    });
    payload.registration_number = registrationNumber || null;
    payload.legal_responsible_cpf = legalResponsibleCpf || null;
    payload.state = state || null;
    return payload;
  }

  function fillForm(company) {
    fields.forEach(field => {
      const element = byId(`company${field.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')}`);
      if (element) element.value = company?.[field] || '';
    });
    const registration = byId('companyRegistrationNumber');
    if (registration) registration.dispatchEvent(new Event('input'));
    const cpf = byId('companyLegalResponsibleCpf');
    if (cpf) cpf.dispatchEvent(new Event('input'));
  }

  async function load() {
    try {
      setMessage('Carregando dados da empresa...');
      const organizationId = getOrganizationId();
      const { data, error } = await getClient().from('organizations').select('id, name, ' + fields.join(', ')).eq('id', organizationId).single();
      if (error) throw error;
      fillForm(data);
      setMessage('Dados da empresa carregados.');
    } catch (cause) {
      console.error('Falha ao carregar o cadastro legal da empresa.', cause);
      setMessage('Não foi possível carregar os dados da empresa.', true);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    try {
      button.disabled = true;
      const organizationId = getOrganizationId();
      const { error } = await getClient().from('organizations').update(payloadFromForm()).eq('id', organizationId);
      if (error) throw error;
      await load();
      setMessage('Dados da empresa salvos com sucesso.');
    } catch (cause) {
      console.error('Falha ao salvar o cadastro legal da empresa.', cause);
      setMessage(cause.message || 'Não foi possível salvar os dados da empresa.', true);
    } finally {
      button.disabled = false;
    }
  }

  function install() {
    if (installed) return;
    const form = byId('companyForm');
    if (!form) return;
    installed = true;
    form.addEventListener('submit', submit);
    applyMasks();
  }

  window.NexusCompany = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
