import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// Dedicated SST pilot -> Asaas checkout. NOT used by the CRM or anonymous site.
const ALLOWED_ORIGINS = new Set(['https://nexuscore.app.br','https://www.nexuscore.app.br']);
const RELEASED = Deno.env.get('NEXUS_SST_ASAAS_PROD_RELEASE_APPROVED') === 'true';
const CHECKOUT_ENABLED = Deno.env.get('NEXUS_SST_ASAAS_PROD_CHECKOUT_ENABLED') === 'true';
const SETTLEMENT_READY = Deno.env.get('NEXUS_SST_ASAAS_PROD_SETTLEMENT_READY') === 'true';
const clean = (x: unknown, max = 240) => String(x ?? '').trim().slice(0,max);
const reply = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body),{
  status, headers: {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    ...(ALLOWED_ORIGINS.has(origin) ? {'access-control-allow-origin':origin,'vary':'Origin'} : {}),
    'access-control-allow-methods':'POST, GET, OPTIONS',
    'access-control-allow-headers':'authorization, apikey, content-type, x-client-info'
  }
});
const digits=(x:unknown)=>clean(x,30).replace(/\D/g,'');
function validDocument(d:string) {
  if(![11,14].includes(d.length) || /^(\d)\1+$/.test(d))return false;
  if(d.length===11){
    const check=(size:number)=>{let sum=0;for(let i=0;i<size;i++)sum+=Number(d[i])*(size+1-i);const mod=(sum*10)%11;return (mod===10?0:mod)===Number(d[size]);};
    return check(9)&&check(10);
  }
  const check=(size:number,weights:number[])=>{let s=0;for(let i=0;i<size;i++)s+=Number(d[i])*weights[i];const r=s%11;return Number(d[size])===(r<2?0:11-r);};
  return check(12,[5,4,3,2,9,8,7,6,5,4,3,2])&&check(13,[6,5,4,3,2,9,8,7,6,5,4,3,2]);
}
const secureUrl=(x:unknown)=>{
  try{
    const u=new URL(clean(x,2048));
    return u.protocol==='https:'&&['asaas.com','www.asaas.com'].includes(u.hostname)&&!u.username&&!u.password&&!u.port?u.href:null;
  }catch{return null;}
};
function checkoutId(x:unknown){const s=clean(x,130);return /^[A-Za-z0-9_-]{5,130}$/.test(s)?s:null;}
const client = ()=>{
  const url=Deno.env.get('SUPABASE_URL')||'';
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||secret.length<32)throw new Error('database_not_configured');
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
};
async function getContext(admin:any,req:Request){
  const authorization=clean(req.headers.get('authorization'),6000);
  if(!/^Bearer \S+$/i.test(authorization))return null;
  const {data:{user},error}=await admin.auth.getUser(authorization.slice(7));
  if(error||!user?.id||!user?.email)return null;
  const {data:profile,error:profileError}=await admin.from('profiles')
    .select('id,organization_id,role,active,full_name').eq('id',user.id).maybeSingle();
  if(profileError||!profile?.active||profile.role!=='org_admin'||!profile.organization_id)return null;
  const {data:membership}=await admin.from('organization_memberships')
    .select('organization_id').eq('user_id',user.id).eq('organization_id',profile.organization_id)
    .eq('active',true).limit(1).maybeSingle();
  if(!membership)return null;
  const {data:access}=await admin.from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,subscription_status,access_status,renews_at,plan:nexus_plans(code,status),product:nexus_products(code)')
    .eq('organization_id',profile.organization_id).limit(30);
  const pilot=(access||[]).find((a:any)=>{
    const pl=Array.isArray(a.plan)?a.plan[0]:a.plan;
    const product=Array.isArray(a.product)?a.product[0]:a.product;
    return product?.code==='sst'&&pl?.code==='piloto'&&pl?.status==='active'&&a.subscription_status==='trial';
  });
  if(!pilot)return null;
  const {data:org}=await admin.from('organizations')
    .select('id,name,registration_number').eq('id',profile.organization_id).maybeSingle();
  if(!org?.id)return null;
  const {count,error:countError}=await admin.from('employees')
    .select('id',{head:true,count:'exact'}).eq('organization_id',org.id).eq('active',true);
  if(countError)throw new Error('employee_count_unavailable');
  return {user,profile,org,pilot,employeeCount:Number(count||0)};
}
Deno.serve(async req=>{
  const origin=clean(req.headers.get('origin'),200);
  if(req.method==='OPTIONS')return ALLOWED_ORIGINS.has(origin)?reply({},200,origin):reply({error:'Origem inválida.'},403);
  if(!ALLOWED_ORIGINS.has(origin))return reply({error:'Origem inválida.'},403);
  if(!['GET','POST'].includes(req.method))return reply({error:'Método não permitido.'},405,origin);
  let admin;
  try{admin=client();}catch{return reply({error:'Serviço não configurado.'},503,origin);}
  let context;
  try{context=await getContext(admin,req);}catch{return reply({error:'Não foi possível conferir seu acesso.'},503,origin);}
  if(!context)return reply({error:'Entre na Minha Central com a conta administradora do piloto.'},401,origin);

  const {data:plans,error:planError}=await admin.from('nexus_plans')
    .select('id,code,name,price_cents,currency,employee_limit,billing_interval_months,status')
    .eq('product_id',context.pilot.product_id)
    .in('code',['essencial','profissional','empresarial']).eq('status','active');
  if(planError||!plans)return reply({error:'Planos temporariamente indisponíveis.'},503,origin);
  const options=plans.filter((p:any)=>p.currency==='BRL'&&p.billing_interval_months===1
    &&p.price_cents>0&&(!p.employee_limit||context.employeeCount<=p.employee_limit))
    .map((p:any)=>({code:p.code,name:p.name,priceCents:p.price_cents,employeeLimit:p.employee_limit}));
  if(req.method==='GET')return reply({
    plans:options, employeeCount:context.employeeCount,
    companyName:context.org.name,
    registrationNumber:context.org.registration_number||'',
    ready:RELEASED&&CHECKOUT_ENABLED&&SETTLEMENT_READY
  },200,origin);

  if(!RELEASED||!CHECKOUT_ENABLED||!SETTLEMENT_READY)
    return reply({error:'Contratação Asaas SST em homologação. Seus dados do piloto estão preservados.'},503,origin);
  const asaasKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
  if(!asaasKey.startsWith('$aact_prod_')||asaasKey.length<32)
    return reply({error:'Pagamento temporariamente indisponível.'},503,origin);

  let input:Record<string,unknown>;
  try{const s=await req.text();if(s.length>2048)return reply({error:'Solicitação inválida.'},400,origin);input=JSON.parse(s);}
  catch{return reply({error:'Solicitação inválida.'},400,origin);}
  const planCode=clean(input.planCode,30).toLowerCase();
  const method=clean(input.paymentMethod,20).toUpperCase();
  const registrationNumber=digits(input.registrationNumber);
  if(!validDocument(registrationNumber))return reply({error:'Informe um CPF ou CNPJ válido.'},400,origin);
  if(!['PIX','BOLETO'].includes(method))return reply({error:'Forma de pagamento inválida.'},400,origin);
  const plan=plans.find((x:any)=>x.code===planCode);
  if(!plan||!options.some((x:any)=>x.code===planCode))
    return reply({error:'Plano indisponível para a quantidade de colaboradores.'},409,origin);
  if(context.org.registration_number && digits(context.org.registration_number)!==registrationNumber)
    return reply({error:'Documento diferente do cadastro da empresa. Procure a Nexus Central.'},409,origin);
  const {data:conflictingOrg}=await admin.from('organizations').select('id')
    .eq('registration_number',registrationNumber).neq('id',context.org.id).limit(1).maybeSingle();
  if(conflictingOrg?.id)return reply({error:'Documento já vinculado a outra empresa Nexus.'},409,origin);

  const {data:existing,error:existingError}=await admin.from('nexus_sst_asaas_pilot_checkouts')
    .select('id,plan_id,billing_type,registration_number,provider_link_url,state')
    .eq('organization_id',context.org.id).maybeSingle();
  if(existingError)return reply({error:'Não foi possível validar compras existentes.'},503,origin);
  if(existing){
    if(existing.state==='ready'&&existing.plan_id===plan.id&&existing.billing_type===method
      &&existing.registration_number===registrationNumber&&secureUrl(existing.provider_link_url)){
      return reply({url:secureUrl(existing.provider_link_url),reused:true},200,origin);
    }
    return reply({error:'Já existe uma contratação em andamento. Para alterar o plano ou recuperar um pagamento, procure a Nexus Central. Nenhuma nova cobrança foi criada.'},409,origin);
  }

  const intentId=crypto.randomUUID();
  const {error:insertError}=await admin.from('nexus_sst_asaas_pilot_checkouts').insert({
    id:intentId,organization_id:context.org.id,access_id:context.pilot.id,
    user_id:context.user.id,plan_id:plan.id,owner_email:context.user.email.toLowerCase(),
    company_name:context.org.name,registration_number:registrationNumber,
    amount_cents:plan.price_cents,billing_type:method,environment:'production',state:'reserved'
  });
  if(insertError)return reply({error:'Uma contratação pode já estar em preparação. Consulte a Central antes de tentar novamente.'},409,origin);

  try{
    const body={
      billingType:method, chargeType:'RECURRENT', subscriptionCycle:'MONTHLY',
      name:'Nexus SST - '+plan.name,description:'Assinatura mensal do SST Controle',
      value:Number((plan.price_cents/100).toFixed(2)),limit:1,
      externalReference:'sst-pilot-'+intentId,notificationEnabled:true,
      ...(method==='BOLETO'?{dueDateLimitDays:5}:{})
    };
    const response=await fetch('https://api.asaas.com/v3/paymentLinks',{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json',
        'access_token':asaasKey,'User-Agent':'NexusSST/1.0'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw new Error('asaas_request_failed');
    const raw=await response.text();if(raw.length>20000)throw new Error('asaas_response_too_large');
    const data=JSON.parse(raw);
    const providerId=checkoutId(data.id),url=secureUrl(data.url);
    if(!providerId||!url)throw new Error('asaas_response_invalid');
    const {error:saved}=await admin.from('nexus_sst_asaas_pilot_checkouts')
      .update({provider_link_id:providerId,provider_link_url:url,state:'ready',updated_at:new Date().toISOString()})
      .eq('id',intentId).eq('state','reserved');
    if(saved)throw new Error('persistence_unknown');
    await admin.from('audit_logs').insert({
      organization_id:context.org.id,user_id:context.user.id,
      action:'NEXUS_SST_ASAAS_PILOT_CHECKOUT_CREATED',entity:'organization_product_access',
      entity_id:context.pilot.id,metadata:{checkout_id:intentId,plan_code:planCode}
    });
    return reply({url},200,origin);
  }catch(e){
    // The provider MAY have created a link even if its response was lost.
    // Never retry the same intent or create another link automatically.
    await admin.from('nexus_sst_asaas_pilot_checkouts')
      .update({state:'review',updated_at:new Date().toISOString()})
      .eq('id',intentId).eq('state','reserved');
    console.error('sst-asaas-checkout-unknown',clean((e as Error)?.message,80));
    return reply({error:'O resultado da contratação precisa de conferência pela Nexus Central. Não repita o pagamento.'},503,origin);
  }
});
