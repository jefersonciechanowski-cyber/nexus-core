import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';

// Temporary, single-event, read-only bridge. NEVER rotates or returns a secret.
// It delegates to the existing guarded verifier, with reserve explicitly false.
// The worker has no database client, service_role, payment or tenant permissions.
const AUDIENCE = 'nexus-crm-asaas-readonly-once-v1';
const REPO = 'jefersonciechanowski-cyber/nexus-core';
const WORKFLOW = REPO + '/.github/workflows/crm-asaas-sandbox-readonly.yml@refs/heads/main';
const EVENT = 'asaas:evt_d26e303b238e509335ac9ba210e51b0f&23773213';
const VERIFIER = 'https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-verify-event';
const EXPIRES = Date.parse('2026-11-09T00:00:00Z');
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));

const json=(body: Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});
const reason=(value: unknown):string => typeof value==='string' && /^[a-z0-9_]{1,90}$/.test(value)
  ? value : 'unavailable';

Deno.serve(async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return json({decision:'hold',reason:'method_not_allowed'},405);
  if(Date.now()>=EXPIRES)return json({decision:'hold',reason:'one_time_window_expired'},410);
  const auth=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>8500){
    return json({decision:'hold',reason:'oidc_required'},401);
  }
  try{
    const {payload}=await jwtVerify(auth.slice(7),jwks,{
      issuer:'https://token.actions.githubusercontent.com',
      audience:AUDIENCE,
    });
    if(payload.repository!==REPO
      ||payload.ref!=='refs/heads/main'
      ||payload.event_name!=='push'
      ||payload.workflow_ref!==WORKFLOW) {
      return json({decision:'hold',reason:'oidc_workflow_not_authorized'},403);
    }
  }catch{return json({decision:'hold',reason:'oidc_invalid'},401);}

  const body=await request.text();
  if(body.trim()!=='{}'||body.length>100)return json({decision:'hold',reason:'empty_body_required'},400);

  const secret=Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_SECRET')||'';
  if(Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_ENABLED')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE')!=='sandbox') {
    return json({decision:'hold',reason:'sandbox_verifier_disabled'},503);
  }
  if(secret.length<32)return json({decision:'hold',reason:'internal_verifier_not_configured'},503);

  try{
    const response=await fetch(VERIFIER,{
      method:'POST',
      headers:{'content-type':'application/json','x-nexus-central-internal-key':secret},
      body:JSON.stringify({eventId:EVENT,reserve:false}),
      signal:AbortSignal.timeout(55000),
    });
    const raw=await response.text();
    if(raw.length>5000)return json({decision:'retry',reason:'oversized_verifier_reply'},502);
    let result:Record<string,unknown>;
    try{result=JSON.parse(raw)}catch{return json({decision:'retry',reason:'invalid_verifier_reply'},502)}
    if(!response.ok){
      const failureReason=reason(result.reason||result.error);
      return json({decision:'hold',reason:failureReason==='unavailable'?'verifier_http_'+response.status:failureReason},503);
    }
    if(result.canActivateCrm!==false)return json({decision:'manual_review',reason:'unexpected_activation_state'},502);
    const decision=result.decision;
    if(!['verified_for_review','manual_review','hold','retry'].includes(String(decision))){
      return json({decision:'retry',reason:'unexpected_verifier_decision'},502);
    }
    return json({decision,reason:reason(result.reason),canActivateCrm:false,readOnly:true});
  }catch{return json({decision:'retry',reason:'sandbox_verifier_unavailable'},503)}
});
