import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const endpoint='https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-owner-visit-status';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  const allowed=['https://nexuscore.app.br','https://www.nexuscore.app.br'].includes(origin);
  const headers={'cache-control':'no-store','vary':'Origin','access-control-allow-origin':allowed?origin:'https://nexuscore.app.br',
    'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,x-client-info,content-type,x-nexus-access'};
  const reply=(status:number,data:unknown)=>Response.json(data,{status,headers});
  if(origin&&!allowed) return reply(403,{error:'Origem inválida.'});
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(request.method!=='POST') return reply(405,{error:'Método inválido.'});
  const bearer=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/i.test(bearer)) return reply(401,{error:'Sessão obrigatória.'});
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}}});
  const {data:admin,error:authError}=await client.rpc('is_nexus_admin_aal2');
  if(authError||admin!==true) return reply(403,{error:'Administração Nexus com MFA obrigatória.'});
  const id=request.headers.get('x-nexus-access')||'';
  if(!uuid.test(id)) return reply(400,{error:'Contrato inválido.'});
  const {data:row,error}=await client.from('organization_product_access')
    .select('organization_id,external_tenant_id,nexus_products!inner(code)').eq('id',id).eq('nexus_products.code','crm').maybeSingle();
  if(error) return reply(503,{error:'Consulta indisponível.'});
  if(!row||!uuid.test(row.external_tenant_id||'')||!uuid.test(row.organization_id)) return reply(404,{error:'Vínculo indisponível.'});
  const org=row.external_tenant_id,company=row.organization_id,at=String(Date.now());
  const secret=Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET')||'';
  if(secret.length<32) return reply(503,{error:'Consulta indisponível.'});
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(['crm-owner-visit-v1',org,company,id,at].join('|')));
  const hex=Array.from(new Uint8Array(sig),byte=>byte.toString(16).padStart(2,'0')).join('');
  try {
    const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'x-visit-org':org,'x-visit-company':company,'x-visit-contract':id,'x-visit-at':at,'x-visit-signature':hex}});
    if(!response.ok) return reply(503,{error:'CRM indisponível.'});
    const {visit}=await response.json();
    return reply(200,{matched:Boolean(visit),firstSeen:visit?.first_seen_at??null,loginKnown:visit?.previous_login_known===true});
  } catch {return reply(503,{error:'CRM indisponível.'});}
});
