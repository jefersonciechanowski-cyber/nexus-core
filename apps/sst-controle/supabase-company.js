(() => {
  'use strict';

  let installed = false;
  let currentCompany = null;
  let currentLogoUrl = '';
  let logoUrlExpiresAt = 0;

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
  function hasAllowedCpfInput(value) { return /^[0-9.\-\s]*$/.test(String(value || '')); }

  function formatCpf(value) {
    if (!hasAllowedCpfInput(value)) return String(value || '');
    return digits(value).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2').slice(0, 14);
  }

  function formatCnpj(value) {
    return window.NexusCnpj.format(value);
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
    return window.NexusCnpj.isValid(value);
  }

  function setMessage(text, isError = false) {
    const element = byId('companyFormMessage');
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? 'var(--danger, #b91c1c)' : 'var(--success, #15803d)';
  }

  function setLogoMessage(text, isError = false) {
    const element = byId('companyLogoMessage');
    if (!element) return;
    element.textContent = text;
    element.style.color = isError ? 'var(--danger, #b91c1c)' : 'var(--success, #15803d)';
  }

  function renderLogo() {
    const preview = byId('companyLogoPreview');
    const removeButton = byId('companyLogoRemove');
    if (!preview) return;
    preview.innerHTML = currentLogoUrl
      ? `<img src="${currentLogoUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" alt="Logo da empresa cliente">`
      : '<span class="company-logo-placeholder">Nenhuma logo cadastrada. A emissão personalizada ficará disponível após o envio da marca oficial.</span>';
    if (removeButton) removeButton.hidden = !currentCompany?.logo_path;
  }

  async function loadLogoUrl(path) {
    currentLogoUrl = '';
    logoUrlExpiresAt = 0;
    if (!path) return;
    const { data, error } = await getClient().storage.from('sst-documents').createSignedUrl(path, 3600);
    if (error) throw error;
    currentLogoUrl = data?.signedUrl || '';
    logoUrlExpiresAt = currentLogoUrl ? Date.now() + (55 * 60 * 1000) : 0;
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
    const rawRegistrationNumber = byId('companyRegistrationNumber').value;
    const rawLegalResponsibleCpf = byId('companyLegalResponsibleCpf').value;
    if (Boolean(registrationType) !== Boolean(rawRegistrationNumber.trim())) throw new Error('Informe o tipo e o número da inscrição da empresa.');
    if (registrationType === 'CNPJ' && !window.NexusCnpj.isValid(rawRegistrationNumber)) throw new Error('Informe um CNPJ válido.');
    if (registrationType === 'CPF' && !hasAllowedCpfInput(rawRegistrationNumber)) throw new Error('O CPF deve conter apenas números e formatação permitida.');
    if (rawLegalResponsibleCpf && !hasAllowedCpfInput(rawLegalResponsibleCpf)) throw new Error('O CPF do responsável legal deve conter apenas números e formatação permitida.');
    const registrationNumber = registrationType === 'CNPJ'
      ? window.NexusCnpj.normalize(rawRegistrationNumber)
      : digits(rawRegistrationNumber);
    const legalResponsibleCpf = digits(rawLegalResponsibleCpf);
    const state = byId('companyState').value.trim().toUpperCase();
    const email = byId('companyEmail').value.trim();
    if (Boolean(registrationType) !== Boolean(registrationNumber)) throw new Error('Informe o tipo e o número da inscrição da empresa.');
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
      const { data, error } = await getClient().from('organizations').select('id, name, logo_path, ' + fields.join(', ')).eq('id', organizationId).single();
      if (error) throw error;
      currentCompany = data;
      try {
        await loadLogoUrl(data.logo_path);
      } catch (logoError) {
        console.error('Falha ao carregar a logo da empresa.', logoError);
        currentLogoUrl = '';
        setLogoMessage('A logo cadastrada não pôde ser carregada.', true);
      }
      fillForm(data);
      renderLogo();
      setMessage('Dados da empresa carregados.');
      document.dispatchEvent(new CustomEvent('nexus:company-loaded', { detail: { company: data } }));
      return { ...data, logoUrl: currentLogoUrl };
    } catch (cause) {
      console.error('Falha ao carregar o cadastro legal da empresa.', cause);
      setMessage('Não foi possível carregar os dados da empresa.', true);
    }
  }

  async function uploadLogo() {
    const input = byId('companyLogoInput');
    const button = byId('companyLogoUpload');
    const file = input?.files?.[0];
    if (!file) return setLogoMessage('Selecione uma imagem antes de salvar.', true);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoMessage('Use uma imagem PNG, JPG ou WebP.', true);
    if (file.size > 2097152) return setLogoMessage('A imagem deve possuir no máximo 2 MB.', true);

    button.disabled = true;
    try {
      const organizationId = String(currentCompany?.id || getOrganizationId()).toLowerCase();
      const path = `${organizationId}/branding/company-logo`;
      const { error: uploadError } = await getClient().storage.from('sst-documents').upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600'
      });
      if (uploadError) throw uploadError;
      const { error: updateError } = await getClient().from('organizations').update({ logo_path: path }).eq('id', organizationId);
      if (updateError) throw updateError;
      input.value = '';
      await load();
      setLogoMessage('Logo salva e pronta para os documentos.');
    } catch (cause) {
      console.error('Falha ao salvar a logo da empresa.', cause);
      setLogoMessage(cause.message || 'Não foi possível salvar a logo.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function removeLogo() {
    if (!currentCompany?.logo_path) return;
    if (!window.confirm('Remover a logo da empresa dos próximos documentos?')) return;
    const button = byId('companyLogoRemove');
    button.disabled = true;
    try {
      const organizationId = getOrganizationId();
      const path = currentCompany.logo_path;
      const { error: updateError } = await getClient().from('organizations').update({ logo_path: null }).eq('id', organizationId);
      if (updateError) throw updateError;
      const { error: removeError } = await getClient().storage.from('sst-documents').remove([path]);
      if (removeError) console.error('A referência da logo foi removida, mas o arquivo antigo não pôde ser excluído.', removeError);
      await load();
      setLogoMessage('Logo removida. Envie uma nova marca para voltar a emitir documentos personalizados.');
    } catch (cause) {
      console.error('Falha ao remover a logo da empresa.', cause);
      setLogoMessage(cause.message || 'Não foi possível remover a logo.', true);
    } finally {
      button.disabled = false;
    }
  }

  async function getProfile() {
    if (!currentCompany) await load();
    if (currentCompany?.logo_path && Date.now() >= logoUrlExpiresAt) {
      await loadLogoUrl(currentCompany.logo_path);
      renderLogo();
    }
    return currentCompany ? { ...currentCompany, logoUrl: currentLogoUrl } : null;
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
    byId('companyLogoUpload')?.addEventListener('click', uploadLogo);
    byId('companyLogoRemove')?.addEventListener('click', removeLogo);
    applyMasks();
  }

  window.NexusCompany = { load, getProfile, uploadLogo, removeLogo };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
