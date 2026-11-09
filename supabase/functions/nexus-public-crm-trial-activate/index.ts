import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { hashCrmTrialToken, publicTrialAllowed } from '../_shared/crm-public-trial-contract.mjs';
import { fingerprintTrialIdentity, addTrialDays } from '../_shared/crm-trial-contract.mjs';
import { provisionCrmTenant } from '../_shared/crm-provisioning.ts';
import { sendCrmSmtpMail } from '../stripe-webhook/crm-brevo-smtp.ts';

const ORIGIN='https://crm.nexuscore.app.br';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json','cache-control':'no-store',
  'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type',
  'Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','X-Content-Type-Options':'nosniff'},
});
const clean=(value:unknown,max=200)=>String(value??'').trim().slice(0,max);
const escape=(v:unknown)=>clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'cliente';

Deno.serve(async(request:Request)=>{
  if(!publicTrialAllowed(Deno.env.toObject()))
    return reply({error:'Ativação de teste em homologação.'},503);
  if(request.headers.get('origin')!==ORIGIN)return reply({error:'Origem inválida.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:reply({},200).headers});
  if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
  if(!(request.headers.get('content-type')||'').startsWith('application/json')
    ||Number(request.headers.get('content-length')||0)>2048)return reply({error:'Pedido inválido.'},400);
  const raw=await request.text();
  if(raw.length>2048)return reply({error:'Pedido inválido.'},400);
  let token:string;
  try{
    const input=JSON.parse(raw);
    token=typeof input.token==='string'?input.token:'';
    if(!/^[0-9a-f]{64}$/.test(token))throw Error('invalid_token');
  }catch{return reply({error:'Link inválido ou expirado.'},400);}
  const hash=await hashCrmTrialToken(token);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const fingerSecret=Deno.env.get('NEXUS_CRM_TRIAL_FINGERPRINT_SECRET')||'';
  if(!url||serviceKey.length<30||fingerSecret.length<32)
    return reply({error:'Ativação não configurada.'},503);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:limit,error:limitError}=await admin.rpc('consume_nexus_public_request_limit',{
    p_fingerprint_hash:hash,p_action:'crm-public-trial-activate',
    p_window_seconds:1200,p_limit:5,
  });
  if(limitError)return reply({error:'Validação indisponível.'},503);
  if(limit!==true)return reply({error:'Muitas tentativas. Contate a Nexus.'},429);
  const {data:claimed,error:claimError}=await admin.rpc('claim_nexus_crm_public_trial_request',{
    p_token_hash:hash,
  });
  if(claimError)return reply({error:'Validação indisponível.'},503);
  if(claimed?.decision!=='claimed'||!claimed.id)
    return reply({error:'Link expirado ou já utilizado. Solicite um novo teste.'},409);
  const id=claimed.id;
  const manual=async(reason:string)=>{
    await admin.from('nexus_crm_public_trial_requests').update({
      state:'manual_review',updated_at:new Date().toISOString(),
    }).eq('id',id).eq('state','activating');
    console.error('crm-trial-activation-review',clean(reason,55));
  };
  const {data:trial,error:requestError}=await admin.from('nexus_crm_public_trial_requests')
    .select('*').eq('id',id).eq('state','activating').maybeSingle();
  if(requestError||!trial||trial.trial_days!==15){
    await manual('trial_request_invalid');
    return reply({error:'Solicitação requer revisão.'},503);
  }
  const {data:plan,error:planError}=await admin.from('nexus_plans')
    .select('id,code,name,product_id,included_user_limit,currency,billing_interval_months,status,public_visible')
    .eq('id',trial.plan_id).eq('status','active').maybeSingle();
  const {data:product,error:productError}=plan?.product_id
    ? await admin.from('nexus_products').select('id,code,status').eq('id',plan.product_id).maybeSingle()
    :{data:null,error:null};
  if(planError||productError||product?.code!=='crm'||product.status!=='active'
    ||!['start','pro','gestao'].includes(plan?.code||'')
    ||plan?.public_visible!==true||plan?.billing_interval_months!==1
    ||plan?.currency!=='BRL'
    ||!Number.isInteger(Number(plan.included_user_limit))
    ||Number(plan.included_user_limit)<1){
    await manual('plan_not_eligible');
    return reply({error:'Plano indisponível para teste.'},409);
  }
  const [existingDoc,existingEmail]=await Promise.all([
    admin.from('organizations').select('id').eq('registration_number',trial.registration_number).limit(1),
    admin.from('organizations').select('id').ilike('email',trial.email).limit(1),
  ]);
  if(existingDoc.error||existingEmail.error||existingDoc.data?.length||existingEmail.data?.length){
    await manual('identity_conflict');
    return reply({error:'Esse cadastro não pode receber outro teste. Contate a Nexus.'},409);
  }
  const emailFingerprint=await fingerprintTrialIdentity(fingerSecret,'email',trial.email);
  const documentFingerprint=await fingerprintTrialIdentity(fingerSecret,'document',trial.registration_number);
  const claimId=crypto.randomUUID();
  const {data:reserved,error:reserveError}=await admin.rpc('reserve_nexus_crm_trial',{
    p_id:claimId,p_email_fingerprint:emailFingerprint,
    p_document_fingerprint:documentFingerprint,p_trial_days:15,
  });
  if(reserveError||reserved!==true){
    await manual('trial_already_reserved');
    return reply({error:'Este documento ou e-mail já utilizou o teste gratuito.'},409);
  }
  const started=new Date().toISOString().slice(0,10),end=addTrialDays(started,15);
  const organizationId=crypto.randomUUID();
  const {data:org,error:orgError}=await admin.from('organizations').insert({
    id:organizationId,name:trial.company_name,
    slug:slugify(trial.company_name)+'-crm-'+organizationId.replace(/-/g,'').slice(0,8),
    status:'active',email:trial.email,phone:trial.phone,
    legal_responsible_name:trial.responsible_name,registration_number:trial.registration_number,
    registration_type:trial.registration_type,
    postal_code:trial.postal_code,street:trial.street,street_number:trial.street_number,
    address_complement:trial.address_complement,district:trial.district,
    city:trial.city,state:trial.address_state,
  }).select('id').single();
  if(orgError||!org?.id){
    await manual('organization_not_created');
    return reply({error:'Cadastro requer revisão da equipe Nexus.'},503);
  }
  const {data:access,error:accessError}=await admin.from('organization_product_access').insert({
    organization_id:organizationId,product_id:product.id,
    access_status:'active',subscription_status:'trial',
    plan_name:plan.name+' · Teste 15 dias',starts_at:started,renews_at:end,
    plan_id:plan.id,contracted_price_cents:0,contracted_currency:'BRL',
    billing_provider:null,provider_customer_id:null,provider_subscription_id:null,
    billing_mode:'prepaid',billing_cycle_months:1,commercial_condition:'standard',
    base_user_limit_override:Number(plan.included_user_limit),additional_users:0,
  }).select('id').single();
  if(accessError||!access?.id){
    await manual('trial_access_not_created');
    return reply({error:'Cadastro requer revisão da equipe Nexus.'},503);
  }
  const provisioned=await provisionCrmTenant(admin,{
    id:crypto.randomUUID(),plan_id:plan.id,company_name:trial.company_name,
    responsible_name:trial.responsible_name,email:trial.email,
  },access,'administrative');
  if(provisioned.error||!provisioned.crmOrganizationId||!provisioned.firstAccessUrl){
    await manual('crm_provision_or_first_access_missing');
    return reply({error:'Seu cadastro está em verificação. A equipe Nexus continuará a ativação.'},503);
  }
  const {data:confirmed,error:confirmationError}=await admin.rpc('confirm_nexus_crm_trial',{
    p_id:claimId,p_organization_id:organizationId,p_access_id:access.id,
  });
  if(confirmationError||confirmed!==true){
    await manual('trial_claim_confirmation_failed');
    return reply({error:'Seu cadastro requer revisão antes do primeiro acesso.'},503);
  }
  let firstAccess:string;
  try{
    const link=new URL(provisioned.firstAccessUrl);
    if(link.origin!==ORIGIN || link.pathname!=='/auth/primeiro-acesso' || link.username || link.password)
      throw Error('not_crm_first_access_link');
    firstAccess=link.toString();
  }catch{
    await manual('unsafe_first_access_link');
    return reply({error:'O link de acesso necessita revisão.'},503);
  }
  const sent=await sendCrmSmtpMail({
    toEmail:trial.email,toName:trial.responsible_name,
    subject:'Seus 15 dias grátis no Nexus CRM já começaram',
    htmlContent:
      '<div style="max-width:580px;font-family:Arial,sans-serif;line-height:1.7;color:#182126">'
      +'<h2>Seu Nexus CRM está pronto!</h2>'
      +'<p>Olá, '+escape(trial.responsible_name)+'.</p>'
      +'<p>O teste gratuito de 15 dias da empresa '+escape(trial.company_name)
      +' foi ativado. Seu prazo vai até '+escape(end)+'.</p>'
      +'<p><a href="'+firstAccess+'" style="display:inline-block;padding:12px 18px;background:#d7aa42;color:#172026;text-decoration:none">Definir senha e entrar</a></p>'
      +'<p>Ao final do teste, o acesso será suspenso se você não contratar. Não há cobrança automática.</p></div>',
  });
  await admin.from('nexus_crm_public_trial_requests').update({
    state:sent.sent?'provisioned':'manual_review',organization_id:organizationId,
    access_id:access.id,updated_at:new Date().toISOString(),
  }).eq('id',id);
  await admin.from('audit_logs').insert({
    organization_id:organizationId,action:sent.sent?'NEXUS_CRM_PUBLIC_TRIAL_ACTIVATED':'NEXUS_CRM_PUBLIC_TRIAL_EMAIL_FAILED',
    entity:'organization_product_access',entity_id:access.id,
    metadata:{plan_id:plan.id,trial_days:15,trial_ends_at:end,first_access_email_sent:sent.sent},
  });
  if(!sent.sent)return reply({
    error:'O CRM foi criado, mas o envio do e-mail de acesso precisa de suporte. Não cadastre outra empresa.',
  },503);
  return reply({ok:true,message:'Seu teste começou! Enviamos o primeiro acesso ao seu e-mail.'});
});
