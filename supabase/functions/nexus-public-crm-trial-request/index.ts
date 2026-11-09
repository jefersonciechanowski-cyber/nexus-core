import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { normalizeCrmPublicTrial, publicTrialAllowed, newCrmTrialToken, hashCrmTrialToken } from '../_shared/crm-public-trial-contract.mjs';
import { fingerprintTrialIdentity } from '../_shared/crm-trial-contract.mjs';
import { sendCrmSmtpMail } from '../stripe-webhook/crm-brevo-smtp.ts';

// Public input only requests an email proof of possession; NEVER activates CRM.
const ORIGIN='https://crm.nexuscore.app.br';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type',
  'Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','X-Content-Type-Options':'nosniff'},
});
const scrub=(s:unknown,max=200)=>String(s??'').trim().slice(0,max);
const escape=(s:unknown)=>scrub(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

Deno.serve(async(request:Request)=>{
  if(!publicTrialAllowed(Deno.env.toObject()))
    return reply({error:'Teste gratuito em homologação.'},503);
  if(request.headers.get('origin')!==ORIGIN)return reply({error:'Origem não autorizada.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:reply({},200).headers});
  if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
  if(!(request.headers.get('content-type')||'').startsWith('application/json')
    ||Number(request.headers.get('content-length')||0)>12_000)return reply({error:'Dados inválidos.'},400);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).length>12_000)return reply({error:'Dados muito extensos.'},413);
  let submitted:Record<string,unknown>;
  try{
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('bad_json');
    submitted=parsed;
  }catch{return reply({error:'Dados inválidos.'},400);}
  if(scrub(submitted.website,100))return reply({ok:true,message:'Verifique seu e-mail.'});
  const normalized=normalizeCrmPublicTrial(submitted);
  if(!normalized.payload)return reply({error:normalized.error||'Dados inválidos.'},400);
  const input=normalized.payload;
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const claimSecret=Deno.env.get('NEXUS_CRM_TRIAL_FINGERPRINT_SECRET')||'';
  if(!supabaseUrl || serviceKey.length<30 || claimSecret.length<32)
    return reply({error:'Ativação temporariamente indisponível.'},503);
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const documentFingerprint=await fingerprintTrialIdentity(claimSecret,'document',input.registrationNumber);
  const emailFingerprint=await fingerprintTrialIdentity(claimSecret,'email',input.email);
  const limitHash=await fingerprintTrialIdentity(claimSecret,'email',input.email+':'+input.registrationNumber);
  const {data:rateLimit,error:rateError}=await admin.rpc('consume_nexus_public_request_limit',{
    p_fingerprint_hash:limitHash,p_action:'crm-public-trial-email',
    p_window_seconds:3600,p_limit:3,
  });
  if(rateError)return reply({error:'Não foi possível receber seu pedido.'},503);
  if(rateLimit!==true)return reply({error:'Muitas tentativas. Verifique seu e-mail ou tente novamente mais tarde.'},429);
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  if(productError||!product?.id)return reply({error:'Produto indisponível.'},503);
  const {data:plan,error:planError}=await admin.from('nexus_plans')
    .select('id,code,product_id,status,public_visible,currency,billing_interval_months')
    .eq('product_id',product.id).eq('code',input.planCode).maybeSingle();
  if(planError || !plan || plan.status!=='active' || plan.public_visible!==true
    ||plan.currency!=='BRL'||plan.billing_interval_months!==1)
    return reply({error:'Plano de teste indisponível.'},409);
  const generic={ok:true,message:'Se os dados forem elegíveis, enviaremos um link de verificação para seu e-mail.'};
  // Silent conflict response: never reveal whether a CPF/CNPJ or email belongs to a client.
  const [orgByDocument,orgByEmail,claims]=await Promise.all([
    admin.from('organizations').select('id').eq('registration_number',input.registrationNumber).limit(1),
    admin.from('organizations').select('id').ilike('email',input.email).limit(1),
    admin.from('nexus_crm_trial_claims').select('id')
      .or('document_fingerprint.eq.'+documentFingerprint+',email_fingerprint.eq.'+emailFingerprint).limit(1),
  ]);
  if(orgByDocument.error||orgByEmail.error||claims.error)
    return reply({error:'Verificação temporariamente indisponível.'},503);
  if(orgByDocument.data?.length||orgByEmail.data?.length||claims.data?.length)return reply(generic);
  const token=newCrmTrialToken();
  const tokenHash=await hashCrmTrialToken(token);
  const expiration=new Date(Date.now()+20*60*1000).toISOString();
  const {data:row,error:insertError}=await admin.from('nexus_crm_public_trial_requests').insert({
    token_hash:tokenHash,email:input.email,company_name:input.companyName,
    responsible_name:input.responsibleName,registration_number:input.registrationNumber,
    registration_type:input.registrationType,phone:input.phone,plan_id:plan.id,
    postal_code:input.postalCode,street:input.street,street_number:input.streetNumber,
    address_complement:input.addressComplement||null,district:input.district,
    city:input.city,address_state:input.state,trial_days:15,state:'pending',expires_at:expiration,
  }).select('id').single();
  if(insertError||!row?.id)return reply({error:'Não foi possível preparar seu teste.'},503);
  const url=ORIGIN+'/site-captacao/trial/confirm#token='+token;
  const sent=await sendCrmSmtpMail({
    toEmail:input.email,toName:input.responsibleName,
    subject:'Confirme seu e-mail para ativar 15 dias grátis no Nexus CRM',
    htmlContent:
      '<div style="font-family:Arial,sans-serif;max-width:580px;margin:auto;color:#203036;line-height:1.7">'
      +'<h2>Confirme seu teste gratuito de 15 dias</h2>'
      +'<p>Olá, '+escape(input.responsibleName)+'.</p>'
      +'<p>Clique no botão para verificar seu e-mail e ativar o teste. Não há cobrança automática.</p>'
      +'<p><a href="'+url+'" style="display:inline-block;background:#d7aa42;padding:12px 18px;color:#172026;text-decoration:none">'
      +'Ativar meu teste</a></p>'
      +'<p>Este link expira em 20 minutos e só pode ser usado uma vez. Se você não solicitou o teste, ignore.</p></div>',
  });
  if(!sent.sent){
    await admin.from('nexus_crm_public_trial_requests').update({state:'manual_review',updated_at:new Date().toISOString()}).eq('id',row.id);
    return reply({error:'Não foi possível enviar o e-mail. Tente novamente mais tarde.'},503);
  }
  return reply(generic);
});
