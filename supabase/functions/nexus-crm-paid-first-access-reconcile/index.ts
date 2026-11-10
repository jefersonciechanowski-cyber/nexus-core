import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {sendCrmAccessEmail} from '../stripe-webhook/crm-provisioning.ts';

// Self-healing delivery for an ALREADY PAID, ALREADY PROVISIONED CRM.
// No payment creation, settlement, tenant creation or subscription edits.
// Signed short-lived recovery URL is issued by the tenant's own CRM service.
const REPO='jefersonciechanowski-cyber/nexus-core';
const WORKFLOW=REPO+'/.github/workflows/crm-paid-first-access-reconcile.yml@refs/heads/main';
const AUDIENCE='nexus-crm-paid-first-access-reconcile';
const TARGET='https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-recover-paid-access';
const PURPOSE='crm-paid-first-access-recovery-v1';
const uuid=(v:unknown):v is string=>typeof v==='string'
  &&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'},
});
async function authorized(req:Request){
  const bearer=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(bearer.length<100||bearer.length>10000||bearer.split('.').length!==3)return false;
  try{
    const keys=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
    const {payload}=await jwtVerify(bearer,keys,{
      issuer:'https://token.actions.githubusercontent.com',audience:AUDIENCE,
    });
    return payload.repository===REPO && payload.ref==='refs/heads/main'
      &&payload.workflow_ref===WORKFLOW &&payload.ref_type==='branch'
      &&['schedule','workflow_dispatch','push'].includes(String(payload.event_name||''));
  }catch{return false;}
}
async function sign(raw:string,secret:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(raw)));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
async function recoverUrl(sale:any,access:any,secret:string):Promise<string|null>{
  const raw=JSON.stringify({
    purpose:PURPOSE,event_id:crypto.randomUUID(),
    central_company_id:access.organization_id,contract_id:access.id,
    crm_organization_id:access.external_tenant_id,
    owner_email:String(sale.email).trim().toLowerCase(),
    occurred_at:new Date().toISOString(),
  });
  let response:Response;
  try{
    response=await fetch(TARGET,{
      method:'POST',headers:{
        'content-type':'application/json','x-nexus-signature':'sha256='+await sign(raw,secret),
      },body:raw,signal:AbortSignal.timeout(12000),
    });
  }catch{return null;}
  if(!response.ok||Number(response.headers.get('content-length')||0)>2200)return null;
  let body:any;
  try{
    const rawResponse=await response.text();
    if(rawResponse.length>2200)return null;
    body=JSON.parse(rawResponse);
  }catch{return null;}
  if(body?.ok!==true||typeof body?.firstAccessUrl!=='string')return null;
  try{
    const url=new URL(body.firstAccessUrl);
    if(url.origin!=='https://crm.nexuscore.app.br'
      ||url.pathname!=='/auth/primeiro-acesso'
      ||url.username||url.password||url.hash||url.searchParams.get('type')!=='recovery'
      ||!url.searchParams.get('token_hash'))
      return null;
    return url.toString();
  }catch{return null;}
}
Deno.serve(async(request:Request)=>{
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!(await authorized(request)))return json({error:'unauthorized'},401);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const secret=Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET')||'';
  if(!supabaseUrl||serviceKey.length<30||secret.length<32)
    return json({error:'unavailable'},503);
  const admin=createClient(supabaseUrl,serviceKey,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const cutoff=new Date(Date.now()-7*86400000).toISOString();
  const {data:failed,error:listError}=await admin.from('audit_logs')
    .select('entity_id,created_at')
    .eq('entity','nexus_sales').eq('action','NEXUS_CRM_ONBOARDING_EMAIL_FAILED')
    .gte('created_at',cutoff).order('created_at',{ascending:false}).limit(80);
  if(listError)return json({error:'audit_unavailable'},503);
  const candidates=Array.from(new Set((failed||[]).map((x:any)=>x.entity_id).filter(uuid))).slice(0,10);
  let recovered=0,skipped=0,review=0;
  for(const id of candidates){
    try{
      const {data:sent,error:sentErr}=await admin.from('audit_logs').select('id')
        .eq('entity','nexus_sales').eq('entity_id',id)
        .eq('action','NEXUS_CRM_ONBOARDING_EMAIL_SENT').limit(1).maybeSingle();
      if(sentErr)throw Error('sent_audit_unavailable');
      if(sent){skipped++;continue;}
      // Do not hammer a customer inbox or create more than 3 links per day.
      const recent=new Date(Date.now()-30*60_000).toISOString();
      const {data:attempt,error:attemptErr}=await admin.from('audit_logs').select('id')
        .eq('entity','nexus_sales').eq('entity_id',id)
        .eq('action','NEXUS_CRM_ONBOARDING_EMAIL_RECOVERY_ATTEMPTED')
        .gte('created_at',recent).limit(1).maybeSingle();
      if(attemptErr)throw Error('attempt_audit_unavailable');
      if(attempt){skipped++;continue;}
      const {data:sale,error:saleErr}=await admin.from('nexus_sales')
        .select('id,organization_id,product_id,plan_id,provider,environment,source,sale_status,paid_at,provisioned_at,email,responsible_name,company_name')
        .eq('id',id).maybeSingle();
      if(saleErr)throw Error('sale_unavailable');
      if(!sale||sale.environment!=='production'||sale.source!=='site-captacao'
        ||!['asaas','stripe'].includes(sale.provider)
        ||sale.sale_status!=='provisioned'||!sale.paid_at
        ||!sale.provisioned_at||Date.parse(sale.provisioned_at)>Date.now()-3*60_000
        ||!uuid(sale.organization_id)||typeof sale.email!=='string'
        ||!sale.email.includes('@')){skipped++;continue;}
      const {data:product,error:productErr}=await admin.from('nexus_products')
        .select('code').eq('id',sale.product_id).maybeSingle();
      if(productErr)throw Error('product_unavailable');
      if(product?.code!=='crm'){skipped++;continue;}
      const {data:access,error:accessErr}=await admin.from('organization_product_access')
        .select('id,organization_id,product_id,plan_id,access_status,subscription_status,commercial_condition,external_tenant_id')
        .eq('organization_id',sale.organization_id)
        .eq('product_id',sale.product_id).maybeSingle();
      if(accessErr)throw Error('access_unavailable');
      if(!access||access.plan_id!==sale.plan_id
        ||access.access_status!=='active'||access.subscription_status!=='active'
        ||access.commercial_condition!=='standard'
        ||!uuid(access.external_tenant_id)){skipped++;continue;}
      const {data:plan,error:planErr}=await admin.from('nexus_plans')
        .select('id,code,name').eq('id',sale.plan_id).maybeSingle();
      if(planErr)throw Error('plan_unavailable');
      if(!plan||!['start','pro','gestao'].includes(plan.code)){skipped++;continue;}

      // Record the attempt BEFORE generating a reset link. If auditing fails,
      // do not contact the customer's account.
      const {error:attemptSaveErr}=await admin.from('audit_logs').insert({
        organization_id:access.organization_id,entity:'nexus_sales',entity_id:id,
        action:'NEXUS_CRM_ONBOARDING_EMAIL_RECOVERY_ATTEMPTED',
        metadata:{kind:'paid_crm_first_access',mode:'scheduled_oidc'},
      });
      if(attemptSaveErr)throw Error('audit_attempt_not_persisted');
      const link=await recoverUrl(sale,access,secret);
      if(!link){review++;continue;}
      const delivered=await sendCrmAccessEmail(admin,sale,plan,link,sale.provider);
      if(delivered)recovered++;
      else review++;
    }catch{
      review++;
      console.error('crm_paid_first_access_reconcile_requires_review');
    }
  }
  return json({
    status:'reconciliation_checked',readOnlyFinancial:true,
    createdCharge:false,createdAccount:false,
    inspected:candidates.length,recovered,skipped,pendingReview:review,
  });
});
