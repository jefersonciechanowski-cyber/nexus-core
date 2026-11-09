import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

// Read-only production configuration check. Never exposes environment values,
// never queries customer records and never calls Asaas or sends emails.
// Only the reviewed, scheduled/main-branch Nexus Core workflow may invoke it.
const REPO='jefersonciechanowski-cyber/nexus-core';
const WORKFLOW=REPO+'/.github/workflows/crm-public-release-smoke.yml@refs/heads/main';
const AUDIENCE='nexus-crm-public-release-preflight';
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff',
  },
});
async function authorized(request:Request):Promise<boolean>{
  const header=request.headers.get('authorization')||'';
  const token=header.replace(/^Bearer\s+/i,'').trim();
  if(token.length<100||token.length>10000||token.split('.').length!==3)return false;
  try{
    const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
    const {payload}=await jwtVerify(token,jwks,{
      issuer:'https://token.actions.githubusercontent.com',audience:AUDIENCE,
    });
    return payload.repository===REPO
      &&payload.workflow_ref===WORKFLOW
      &&payload.ref==='refs/heads/main'
      &&payload.ref_type==='branch'
      &&['push','workflow_dispatch'].includes(String(payload.event_name||''));
  }catch{return false;}
}
const TRIAL_FLAGS=[
  'NEXUS_CRM_PUBLIC_TRIAL_READY',
  'NEXUS_CRM_TRIAL_RELEASE_APPROVED',
  'NEXUS_CRM_TRIAL_RECONCILE_ENABLED',
  'NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED',
] as const;
const ANNUAL_FLAGS=[
  'NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED',
  'NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY',
  'NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY',
  'NEXUS_CRM_ASAAS_PROD_ANNUAL_EXPIRY_ENABLED',
] as const;
Deno.serve(async(request:Request)=>{
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  if(!(await authorized(request)))return reply({error:'unauthorized'},401);
  const env=Deno.env.toObject();
  const present=(key:string)=>Object.prototype.hasOwnProperty.call(env,key);
  const active=(key:string)=>env[key]==='true';
  const secret=(key:string)=>typeof env[key]==='string' && env[key].length>=32;
  const flags=(names:readonly string[])=>({
    declared:names.filter(present),
    pending:names.filter(name=>!active(name)),
    enabled:names.filter(active),
  });
  const trial=flags(TRIAL_FLAGS);
  const annual=flags(ANNUAL_FLAGS);
  return reply({
    status:'preflight',readOnly:true,createdCharge:false,createdAccount:false,
    sentEmail:false,customerDataRead:false,
    trial:{
      fingerprintConfigured:secret('NEXUS_CRM_TRIAL_FINGERPRINT_SECRET'),
      configuredReleaseMode:present('NEXUS_CRM_TRIAL_RELEASE_MODE'),
      expiryModePilot:env.NEXUS_CRM_TRIAL_RELEASE_MODE==='pilot',
      flags:trial,
      ready:trial.pending.length===0&&secret('NEXUS_CRM_TRIAL_FINGERPRINT_SECRET'),
    },
    annual:{
      bridgeConfigured:secret('NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET'),
      workerConfigured:secret('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET'),
      providerConfigured:secret('ASAAS_PRODUCTION_API_KEY'),
      existingSettlementReady:active('NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY'),
      existingWebhookConfirmed:active('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED'),
      commonReleaseApproved:active('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'),
      flags:annual,
      ready:annual.pending.length===0
        &&secret('NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET')
        &&secret('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET')
        &&secret('ASAAS_PRODUCTION_API_KEY')
        &&active('NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY')
        &&active('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')
        &&active('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'),
    },
    // CRM uses dedicated SMTP credentials, not the older generic Brevo config.
    // Return only readiness booleans: never sender address, login or password.
    emailTransport:{
      loginConfigured:/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test((env.BREVO_CRM_SMTP_USER||'').trim()),
      keyConfigured:(env.BREVO_CRM_SMTP_KEY||'').length>=12,
      hostConfigured:(env.BREVO_CRM_SMTP_HOST||'').trim().toLowerCase()==='smtp-relay.brevo.com',
      portConfigured:(env.BREVO_CRM_SMTP_PORT||'').trim()==='2525',
      senderConfigured:/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test((env.BREVO_FROM_EMAIL||'').trim()),
    },
  });
});
