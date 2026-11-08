// Pure validation for CRM product enquiries collected by the public sales site.
// No payment, account, trial, subscription or entitlement is created.
export const CRM_INTEREST_PLANS = Object.freeze(['start','pro','gestao']);
const clean = (value,limit) =>
  typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').slice(0,limit)
    : '';
const digits = value => clean(value,40).replace(/\D/g,'');

/** @param {unknown} data */
export function normalizeCrmInterest(data) {
  if (!data || typeof data!=='object' || Array.isArray(data)) {
    return {error:'Dados inválidos.'};
  }
  const input=/** @type {Record<string,unknown>} */(data);
  // Disposable lead spam traps should not produce error feedback to bots.
  if (clean(input.website,160)) return {spam:true};
  const planCode=clean(input.planCode,20).toLowerCase();
  const companyName=clean(input.companyName,160);
  const responsibleName=clean(input.responsibleName,120);
  const phone=digits(input.phone);
  const email=clean(input.email,180).toLowerCase();
  if(companyName.length<2||responsibleName.length<2
    || !/^\d{10,11}$/.test(phone)
    ||(email.length>0&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ||(!CRM_INTEREST_PLANS.includes(planCode)&&planCode!=='')
    ||input.acceptedContact!==true) {
    return {error:'Preencha empresa, responsável, WhatsApp e autorização de contato.'};
  }
  return {
    payload:Object.freeze({
      companyName,responsibleName,phone,email,planCode,
      utmSource:clean(input.utmSource,80),
      utmMedium:clean(input.utmMedium,80),
      utmCampaign:clean(input.utmCampaign,100),
      utmContent:clean(input.utmContent,100),
      utmTerm:clean(input.utmTerm,80),
    }),
  };
}
