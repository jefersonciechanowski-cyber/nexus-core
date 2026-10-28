// Pure, offline-testable Nexus CRM admin-trial contract.
// This does not change the agency's months-long courtesy grants.
export const CRM_TRIAL_DAYS = Object.freeze([15, 30]);
export const TRIAL_ALLOWED_PLANS = Object.freeze(['start','pro','gestao']);
export function normalizeTrialRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error:'Dados inválidos.' };
  const text = (value,max) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ').slice(0,max) : '';
  const companyName = text(input.companyName,160);
  const responsibleName = text(input.responsibleName,160);
  const email = text(input.email,254).toLowerCase();
  const planId = text(input.planId,80);
  const doc = text(input.registrationNumber,30).replace(/[^0-9A-Za-z]/g,'').toUpperCase();
  const trialDays = Number(input.trialDays);
  const registrationType = /^\d{11}$/.test(doc) ? 'CPF' : 'CNPJ';
  const validDoc = /^\d{11}$/.test(doc) || /^[A-Z0-9]{12}\d{2}$/.test(doc);
  if (companyName.length < 2 || responsibleName.length < 2
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(planId)
    || !validDoc || /^0+$/.test(doc) || !CRM_TRIAL_DAYS.includes(trialDays)) {
    return { error:'Confira os dados, documento e prazo de 15 ou 30 dias.' };
  }
  return { payload:{ companyName,responsibleName,email,planId,registrationNumber:doc,registrationType,trialDays } };
}
export function addTrialDays(dateIso, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso) || !CRM_TRIAL_DAYS.includes(days)) throw new Error('Data/prazo inválido.');
  const date = new Date(dateIso + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== dateIso) throw new Error('Data inválida.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}
export async function fingerprintTrialIdentity(secret, type, value) {
  if (typeof secret!=='string' || secret.length < 32 || !['email','document'].includes(type))
    throw new Error('Ambiente trial não configurado.');
  const bytes=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',bytes.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const hash=await crypto.subtle.sign('HMAC',key,bytes.encode('nexus-crm-trial-v1:'+type+':'+value));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
