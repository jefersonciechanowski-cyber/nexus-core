import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { send } from 'jsr:@daaku/webpush@0.2.0';

const ORIGIN = 'https://nexuscore.app.br';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9_-]+$/;
const MAX_DEVICES_PER_ADMIN = 5;
const PUSH_CONTACT = 'mailto:suporte@nexuscore.app.br';

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(), 'Content-Type':'application/json' } });
}
function safeEndpoint(input: unknown): string | null {
  if (typeof input !== 'string' || input.length < 25 || input.length > 2048) return null;
  try {
    const u = new URL(input);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    const host = u.hostname.toLowerCase();
    const allowed =
      host.endsWith('.push.apple.com') ||
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.notify.windows.com');
    return allowed ? u.toString() : null;
  } catch { return null; }
}
function validKeys(value: any): value is {p256dh:string;auth:string} {
  return Boolean(value && typeof value.p256dh === 'string' &&
    value.p256dh.length >= 65 && value.p256dh.length <= 150 && B64.test(value.p256dh) &&
    typeof value.auth === 'string' && value.auth.length >= 15 &&
    value.auth.length <= 60 && B64.test(value.auth));
}
function safeSubscription(value: any) {
  const endpoint = safeEndpoint(value?.endpoint);
  const keys = value?.keys;
  if (!endpoint || !validKeys(keys)) return null;
  return { endpoint, p256dh: keys.p256dh, auth_secret: keys.auth };
}
async function getVapid(admin:any) {
  const {data,error} = await admin.rpc('nexus_support_push_vapid');
  if (error || typeof data !== 'string' || data.length > 2048) throw new Error('VAPID configuration unavailable');
  const key = JSON.parse(data);
  if (key.kty !== 'EC' || key.crv !== 'P-256' ||
      !B64.test(key.d || '') || !B64.test(key.x || '') || !B64.test(key.y || '')) {
    throw new Error('Invalid VAPID configuration');
  }
  return key;
}
async function authorizeAdmin(jwt: string, url: string, anon: string) {
  if (!jwt || jwt.length > 4096) return null;
  const userClient = createClient(url,anon,{
    global:{headers:{Authorization:'Bearer '+jwt}},
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:{user},error:userError}=await userClient.auth.getUser(jwt);
  if (userError || !user?.id) return null;
  const {data:allowed,error:allowError}=await userClient.rpc('is_nexus_admin_aal2');
  return !allowError && allowed === true ? user.id : null;
}
async function deliver(sub:any,vapid:any,kind:'test'|'ticket') {
  const subscription = {
    endpoint:sub.endpoint,
    expirationTime:null,
    keys:{p256dh:sub.p256dh,auth:sub.auth_secret},
  };
  const payload = JSON.stringify({kind,version:1});
  await send(subscription,payload,{
    vapid,
    subscriber:PUSH_CONTACT,
    ttl:3600,
    urgency:kind === 'test' ? 'normal':'high',
  });
}
function errorStatus(error:any) {
  const status=Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(status) ? status : 0;
}
async function dropExpired(admin:any,id:string,error:any) {
  const status=errorStatus(error);
  if (status === 404 || status === 410) {
    await admin.from('nexus_support_push_subscriptions').delete().eq('id',id);
  }
  return status;
}
Deno.serve(async(req:Request) => {
  if (req.method === 'OPTIONS') {
    return req.headers.get('origin') === ORIGIN
      ? new Response('ok',{headers:cors()}) : json({error:'Origem não autorizada.'},403);
  }
  if (req.method !== 'POST') return json({error:'Método inválido.'},405);
  const len=Number(req.headers.get('content-length') || 0);
  if (len > 10_000) return json({error:'Dados muito grandes.'},413);

  const url=Deno.env.get('SUPABASE_URL') || '';
  const adminKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anon=Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!url || !adminKey || !anon) return json({error:'Serviço indisponível.'},503);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

  let body:any;
  try {
    const raw=await req.text();
    if (raw.length > 10_000) return json({error:'Dados muito grandes.'},413);
    body=JSON.parse(raw);
  } catch {return json({error:'JSON inválido.'},400);}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'Dados inválidos.'},400);
  const action=String(body.action || '');
  const authorization=req.headers.get('authorization') || '';
  const jwt=authorization.replace(/^Bearer\s+/i,'');

  if (action === 'dispatch') {
    // The existing nexus-support function is the ONLY caller of this server action.
    if (authorization !== 'Bearer '+adminKey) return json({error:'Não autorizado.'},401);
    const ticketId=String(body.ticketId || '');
    if (!UUID.test(ticketId)) return json({error:'Identificador inválido.'},400);
    const {data:ticket,error:ticketError}=await admin.from('support_requests')
      .select('id,status,created_at,push_dispatched_at').eq('id',ticketId).maybeSingle();
    if (ticketError || !ticket) return json({error:'Chamado não encontrado.'},404);
    if (ticket.status !== 'open') return json({ok:true,skipped:'status'});
    if (ticket.push_dispatched_at) return json({ok:true,skipped:'already-dispatched'});
    if (Date.now()-Date.parse(ticket.created_at) > 5*60_000) return json({ok:true,skipped:'old-event'});

    const {data:subs,error:subsError}=await admin.from('nexus_support_push_subscriptions')
      .select('id,user_id,endpoint,p256dh,auth_secret').order('created_at',{ascending:false}).limit(60);
    if (subsError) return json({error:'Assinaturas indisponíveis.'},503);
    if (!subs?.length) return json({ok:true,skipped:'no-devices'});

    const ids=[...new Set(subs.map((s:any)=>s.user_id))];
    const {data:profiles,error:profileError}=await admin.from('profiles')
      .select('id,role,active').in('id',ids);
    if (profileError) return json({error:'Autorização indisponível.'},503);
    const eligible=new Set((profiles || []).filter((p:any)=>p.active===true && p.role==='nexus_admin').map((p:any)=>p.id));
    const targets=subs.filter((s:any)=>eligible.has(s.user_id));
    if (!targets.length) return json({ok:true,skipped:'no-active-admins'});

    let vapid:any;
    try {vapid=await getVapid(admin);} catch {
      console.error('support push: Vault key unavailable');
      return json({error:'Push indisponível.'},503);
    }
    // A single atomic claim prevents double delivery for concurrent requests.
    const {data:claimed,error:claimError}=await admin.from('support_requests')
      .update({push_dispatched_at:new Date().toISOString()})
      .eq('id',ticketId).eq('status','open').is('push_dispatched_at',null)
      .select('id').maybeSingle();
    if (claimError) return json({error:'Falha ao reservar a notificação.'},503);
    if (!claimed) return json({ok:true,skipped:'claimed'});
    const outcomes=await Promise.allSettled(targets.map(async(s:any)=>{
      try {
        await deliver(s,vapid,'ticket');
        await admin.from('nexus_support_push_subscriptions')
          .update({last_success_at:new Date().toISOString()}).eq('id',s.id);
        return true;
      } catch(err) {
        await dropExpired(admin,s.id,err);
        return false;
      }
    }));
    const sent=outcomes.filter(o=>o.status==='fulfilled' && o.value===true).length;
    return json({ok:true,devices:targets.length,accepted:sent});
  }

  // All device lifecycle actions require a live Nexus admin session with MFA AAL2.
  if (req.headers.get('origin') !== ORIGIN) return json({error:'Origem não autorizada.'},403);
  const userId=await authorizeAdmin(jwt,url,anon);
  if (!userId) return json({error:'Acesso administrativo com MFA necessário.'},403);

  if (action === 'subscribe') {
    const sub=safeSubscription(body.subscription);
    if (!sub) return json({error:'Assinatura inválida.'},400);
    const {data:existing,error:lookupError}=await admin.from('nexus_support_push_subscriptions')
      .select('id,user_id').eq('endpoint',sub.endpoint).maybeSingle();
    if (lookupError) return json({error:'Não foi possível verificar o dispositivo.'},503);
    if (existing && existing.user_id !== userId) return json({error:'Dispositivo associado a outra conta.'},409);
    if (!existing) {
      const {count,error:countError}=await admin.from('nexus_support_push_subscriptions')
        .select('id',{count:'exact',head:true}).eq('user_id',userId);
      if (countError) return json({error:'Dispositivos indisponíveis.'},503);
      if ((count || 0) >= MAX_DEVICES_PER_ADMIN) return json({error:'Limite de cinco dispositivos atingido.'},409);
    }
    const record={...sub,user_id:userId,updated_at:new Date().toISOString()};
    const {error:saveError}=existing
      ? await admin.from('nexus_support_push_subscriptions').update(record).eq('id',existing.id).eq('user_id',userId)
      : await admin.from('nexus_support_push_subscriptions').insert(record);
    if (saveError) return json({error:'Não foi possível habilitar o dispositivo.'},503);
    return json({ok:true});
  }
  if (action === 'unsubscribe') {
    const endpoint=safeEndpoint(body.endpoint);
    if (!endpoint) return json({error:'Assinatura inválida.'},400);
    const {error}=await admin.from('nexus_support_push_subscriptions')
      .delete().eq('user_id',userId).eq('endpoint',endpoint);
    return error ? json({error:'Não foi possível desativar.'},503):json({ok:true});
  }
  if (action === 'test') {
    const endpoint=safeEndpoint(body.endpoint);
    if (!endpoint) return json({error:'Assinatura inválida.'},400);
    const {data:sub,error:queryError}=await admin.from('nexus_support_push_subscriptions')
      .select('id,endpoint,p256dh,auth_secret,last_test_at')
      .eq('user_id',userId).eq('endpoint',endpoint).maybeSingle();
    if (queryError || !sub) return json({error:'Ative o push neste dispositivo antes do teste.'},404);
    if (sub.last_test_at && Date.now()-Date.parse(sub.last_test_at)<60_000) {
      return json({error:'Aguarde um minuto antes de repetir o teste.'},429);
    }
    const {error:stampError}=await admin.from('nexus_support_push_subscriptions')
      .update({last_test_at:new Date().toISOString()}).eq('id',sub.id);
    if (stampError) return json({error:'Não foi possível iniciar o teste.'},503);
    try {
      const vapid=await getVapid(admin);
      await deliver(sub,vapid,'test');
      return json({ok:true,accepted:true});
    } catch(err) {
      await dropExpired(admin,sub.id,err);
      return json({error:'O serviço de push recusou o teste. Reative as notificações.'},502);
    }
  }
  return json({error:'Ação inválida.'},400);
});
