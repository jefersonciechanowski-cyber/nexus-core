import { normalizeCheckout } from '../nexus-public-crm-monthly-checkout/contract.mjs';

// One 15-day trial, no charge and no card, only after verified email.
// Reuse the same CPF/CNPJ check-digit and contact/address checks as paid CRM.
export function normalizeCrmPublicTrial(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)
    ||Number(input.trialDays)!==15 || input.acceptedTerms!==true)
    return {error:'Informe os dados e aceite os termos do teste gratuito de 15 dias.'};
  const {payload,error}=normalizeCheckout({...input,trialDays:0});
  if(error||!payload)return {error:error||'Dados inválidos.'};
  return {payload:{...payload,trialDays:15}};
}

export async function hashCrmTrialToken(token){
  if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))
    throw Error('invalid_token');
  const data=new TextEncoder().encode('nexus-crm-public-trial-v1:'+token);
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',data));
  return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

export function newCrmTrialToken(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
}

export function publicTrialAllowed(env){
  return !!env
    &&env.NEXUS_CRM_PUBLIC_TRIAL_READY==='true'
    // Match the expiry worker gate: never grant a trial that cannot expire.
    &&env.NEXUS_CRM_TRIAL_RELEASE_MODE==='pilot'
    &&env.NEXUS_CRM_TRIAL_RELEASE_APPROVED==='true'
    &&env.NEXUS_CRM_TRIAL_RECONCILE_ENABLED==='true'
    &&env.NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED==='true';
}
