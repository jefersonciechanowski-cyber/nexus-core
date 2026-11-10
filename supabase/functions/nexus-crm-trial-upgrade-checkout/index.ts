import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {verifyCheckoutBridgeSignature} from '../nexus-public-crm-monthly-checkout/signature.mjs';
import {normalizeTrialUpgrade,eligibleTrialUpgrade,buildTrialUpgradeLink,safeUpgradeUrl} from '../_shared/crm-trial-upgrade.mjs';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(Deno.env.get('NEXUS_CRM_TRIAL_PAID_UPGRADE_READY')!=='true'
  ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED')!=='true'
  ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')!=='true'
  ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_DISPATCH_ENABLED')!=='true')return reply({error:'Conversão em homologação.'},503);
 if(req.method!=='POST')return reply({error:'Método inválido.'},405);
 if(req.headers.get('origin')!=='https://crm.nexuscore.app.br')return reply({error:'Origem inválida.'},403);
 const bridge=Deno.env.get('NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET')||'';
 if(bridge.length<32)return reply({error:'Integração indisponível.'},503);
 if(!req.headers.get('content-type')?.startsWith('application/json')||Number(req.headers.get('content-length')||0)>4096)return reply({error:'Pedido inválido.'},400);
 const reader=req.body?.getReader();if(!reader)return reply({error:'Pedido inválido.'},400);
 let raw='';const decoder=new TextDecoder();let bytes=0;
 while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;
  if(bytes>4096){await reader.cancel();return reply({error:'Pedido excessivo.'},413);}raw+=decoder.decode(part.value,{stream:true});}
 raw+=decoder.decode();
 if(!await verifyCheckoutBridgeSignature(raw,req.headers.get('x-nexus-checkout-timestamp'),req.headers.get('x-nexus-checkout-signature'),bridge))return reply({error:'Assinatura inválida.'},403);
 let input;try{input=normalizeTrialUpgrade(JSON.parse(raw));}catch{return reply({error:'Pedido inválido.'},400);}
 if(!input)return reply({error:'Pedido inválido.'},400);
 const apiKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 if(!apiKey.startsWith('$aact_prod_'))return reply({error:'Pagamento indisponível.'},503);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:product,error:pe}=await admin.from('nexus_products').select('id').eq('code','crm').eq('status','active').single();
 if(pe)return reply({error:'Produto indisponível.'},503);
 const {data:access,error:ae}=await admin.from('organization_product_access').select('*').eq('product_id',product.id).eq('external_tenant_id',input.crmOrganizationId).single();
 if(ae||!access)return reply({error:'Contrato não localizado.'},409);
 const [o,c,p]=await Promise.all([
  admin.from('organizations').select('*').eq('id',access.organization_id).single(),
  admin.from('nexus_crm_trial_claims').select('*').eq('access_id',access.id).eq('organization_id',access.organization_id).single(),
  admin.from('nexus_plans').select('*').eq('product_id',product.id).eq('code',input.planCode).single()]);
 if(o.error||c.error||p.error)return reply({error:'Cadastro indisponível.'},503);
 if(!eligibleTrialUpgrade({input,organization:o.data,access,claim:c.data,plan:p.data}))return reply({error:'A conta não é elegível para esta conversão.'},409);
 const {data:prior,error:priorError}=await admin.from('nexus_sales').select('id,sale_status,plan_id,asaas_checkout_url,lead_notes')
  .eq('organization_id',access.organization_id).eq('product_id',product.id).eq('source','crm-trial-upgrade').eq('provider','asaas').eq('environment','production')
  .in('sale_status',['lead','checkout_created','paid','provisioned','manual_review']).maybeSingle();
 if(priorError)return reply({error:'Consulta indisponível.'},503);
 if(prior){const link=safeUpgradeUrl(prior.asaas_checkout_url);
  if(prior.sale_status==='checkout_created'&&prior.plan_id===p.data.id&&prior.lead_notes===input.paymentMethod&&link)return reply({link,reused:true});
  return reply({error:'Existe uma contratação em andamento. Não efetue outro pagamento.'},409);}
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('trial-upgrade:'+input.actorUserId)));
 const {data:allowed,error:le}=await admin.rpc('consume_nexus_public_request_limit',{p_fingerprint_hash:Array.from(hash,x=>x.toString(16).padStart(2,'0')).join(''),p_action:'crm-trial-upgrade',p_window_seconds:3600,p_limit:3});
 if(le||allowed!==true)return reply({error:'Aguarde antes de tentar novamente.'},429);
 const org=o.data;const saleId=crypto.randomUUID();
 const {error:insertError}=await admin.from('nexus_sales').insert({id:saleId,organization_id:org.id,
  product_id:product.id,plan_id:p.data.id,source:'crm-trial-upgrade',sale_status:'lead',lead_stage:'new',
  provider:'asaas',environment:'production',billing_mode:'recurring',billing_cycle_months:1,
  checkout_amount_cents:p.data.price_cents,company_name:org.name,responsible_name:org.legal_responsible_name||org.name,
  email:org.email,phone:org.phone,registration_number:org.registration_number,registration_type:org.registration_type,
  postal_code:org.postal_code,street:org.street,street_number:org.street_number,address_complement:org.address_complement,
  district:org.district,city:org.city,state:org.state,lead_notes:input.paymentMethod,
  external_reference:'crm-trial-upgrade-'+access.id,return_origin:'https://crm.nexuscore.app.br'});
 if(insertError)return reply({error:'Contratação já reservada ou indisponível.'},409);
 try{
  const response=await fetch('https://api.asaas.com/v3/paymentLinks',{method:'POST',headers:{'content-type':'application/json',access_token:apiKey,'User-Agent':'NexusCRM-TrialUpgrade/1.0'},body:JSON.stringify(buildTrialUpgradeLink({plan:p.data,method:input.paymentMethod,saleId})),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('provider_rejected');
  const result=await response.json();const link=safeUpgradeUrl(result.url);
  if(!link||typeof result.id!=='string'||!/^[A-Za-z0-9_-]{4,120}$/.test(result.id))throw Error('provider_response_invalid');
  const {data:saved,error}=await admin.from('nexus_sales').update({sale_status:'checkout_created',asaas_checkout_id:result.id,asaas_checkout_url:link,provider_checkout_id:result.id,provider_checkout_url:link})
   .eq('id',saleId).eq('sale_status','lead').select('id').single();
  if(error||!saved)throw Error('provider_link_not_saved');
  return reply({link});
 }catch{
  // An ambiguous POST must never be retried with another payment link.
  await admin.from('nexus_sales').update({sale_status:'manual_review',last_error:'Checkout de conversão requer conciliação; não gerar outra cobrança.'}).eq('id',saleId).eq('sale_status','lead');
  return reply({error:'Contratação em conferência. Não tente gerar outro pagamento.'},503);
 }
});
