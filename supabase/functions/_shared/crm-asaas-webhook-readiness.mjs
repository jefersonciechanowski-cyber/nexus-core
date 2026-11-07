// Pure assessment of the Asaas production webhook configuration.
// This NEVER validates authToken parity: Asaas may mask/omit it in GET responses.
// True readiness still requires an authenticated inbound delivery and the
// financial/entitlement worker with its independent production release gate.
export const REQUIRED_CRM_ASAAS_EVENTS = Object.freeze([
  'PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED',
  'SUBSCRIPTION_UPDATED','SUBSCRIPTION_DELETED',
]);

const result=(status,partial={})=>Object.freeze({
  status,registered:false,enabled:false,interrupted:false,
  eventsCovered:false,missingEvents:[],
  ...partial,
});

export function assessCrmAsaasProductionWebhook(webhooks,expectedUrl,secretConfigured) {
  if(!Array.isArray(webhooks) || typeof expectedUrl!=='string'
    || !expectedUrl.startsWith('https://'))return result('provider_response_invalid');
  const found=webhooks.filter(row=>row && typeof row==='object' && row.url===expectedUrl);
  if(found.length>1)return result('duplicate_webhook_configuration');
  if(!found.length)return result('webhook_not_registered');
  const hook=found[0];
  const covered=new Set(Array.isArray(hook.events)
    ?hook.events.filter(x=>typeof x==='string') : []);
  const missing=REQUIRED_CRM_ASAAS_EVENTS.filter(e=>!covered.has(e));
  const details={registered:true,enabled:hook.enabled===true,
    interrupted:hook.interrupted===true,
    eventsCovered:missing.length===0,missingEvents:missing};
  if(hook.enabled!==true)return result('webhook_disabled',details);
  if(hook.interrupted===true)return result('webhook_interrupted',details);
  if(missing.length)return result('missing_webhook_events',details);
  if(secretConfigured!==true)return result('receiver_token_not_configured',details);
  return result('configuration_detected_receiver_still_blocked',details);
}
