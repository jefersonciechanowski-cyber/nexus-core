import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// NVIDIA's official Magpie Multilingual cloud NIM, Brazilian Portuguese / male Diego.
// Fixed endpoint and voice: callers cannot choose a third-party URL.
const TTS_URL='https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/synthesize';
const VOICES_URL='https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com/v1/audio/list_voices';
const MALE_VOICE='Magpie-Multilingual.PT-BR.Diego';
const MAX_TEXT_CHARS=520;
const MAX_AUDIO_BYTES=1_900_000;
const MAX_REQUEST_BYTES=6_000;

function originAllowed(req: Request) {
  const raw=req.headers.get('Origin');
  if(!raw)return 'https://nexuscore.app.br';
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:')return null;
    if(['nexuscore.app.br','www.nexuscore.app.br'].includes(url.hostname))return url.origin;
    if(url.hostname.endsWith('.jefersonciechanowski.workers.dev'))return url.origin;
    return null;
  }catch{return null;}
}
function headers(origin:string){
  return {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Content-Type':'application/json',
    'Cache-Control':'private, no-store, max-age=0',
    'Vary':'Origin',
  };
}
function toBase64(buffer:ArrayBuffer){
  const bytes=new Uint8Array(buffer);
  let encoded='';
  for(let i=0;i<bytes.length;i+=16_384){
    encoded+=String.fromCharCode(...bytes.subarray(i,i+16_384));
  }
  return btoa(encoded);
}
Deno.serve(async req=>{
  const origin=originAllowed(req);
  const responseOrigin=origin||'https://nexuscore.app.br';
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(responseOrigin)});
  if(req.method==='OPTIONS')return new Response(null,{status:origin?204:403,headers:headers(responseOrigin)});
  if(!origin)return json({error:'Origem não autorizada.'},403);
  if(req.method!=='POST')return json({error:'Método não permitido.'},405);
  if(!(req.headers.get('content-type')||'').toLowerCase().includes('application/json'))return json({error:'Conteúdo inválido.'},415);
  const contentLength=Number(req.headers.get('content-length')||0);
  if(Number.isFinite(contentLength)&&contentLength>MAX_REQUEST_BYTES)return json({error:'Solicitação muito grande.'},413);
  const auth=req.headers.get('authorization');
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY');
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const nvidiaKey=Deno.env.get('NVIDIA_API_KEY');
  if(!url||!anon||!service||!auth)return json({error:'Servidor de voz indisponível.'},503);

  // Same administrative guard as nexus-ai-core. Never trust browser-provided roles.
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await client.auth.getUser();
  if(userError||!user)return json({error:'Sessão inválida.'},401);
  const {data:profile,error:profileError}=await admin.from('profiles')
    .select('organization_id,active,role').eq('id',user.id).maybeSingle();
  if(profileError||!profile?.active||profile.role!=='nexus_admin'||!profile.organization_id)
    return json({error:'Acesso administrativo necessário.'},403);
  const {data:aal2,error:mfaError}=await client.rpc('is_nexus_admin_aal2');
  if(mfaError||aal2!==true)return json({error:'Autenticação de dois fatores necessária.'},403);

  let body:Record<string,unknown>;
  try{
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_REQUEST_BYTES) return json({error:'Solicitação muito grande.'},413);
    body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('invalid');
  }catch{return json({error:'Solicitação inválida.'},400);}
  if(Deno.env.get('NEXUS_AI_ENABLED')!=='true'||!nvidiaKey)
    return json({error:'NVIDIA não configurada para a Central.'},503);

  // Free capability check: lets the browser distinguish unavailable NIM from TTS.
  if(body.operation==='status'){
    try{
      const response=await fetch(VOICES_URL,{
        headers:{Authorization:`Bearer ${nvidiaKey}`},
        signal:AbortSignal.timeout(10_000),
      });
      if(!response.ok)return json({available:false,provider:'nvidia',voice:'male-pt-BR'});
      const payload=await response.text();
      return json({
        available:payload.includes(MALE_VOICE),
        provider:'nvidia',voice:'male-pt-BR',language:'pt-BR',
      });
    }catch{return json({available:false,provider:'nvidia',voice:'male-pt-BR'});}
  }

  if(body.operation!=='speak')return json({error:'Operação de voz não permitida.'},400);
  if(typeof body.text!=='string')return json({error:'Texto de voz inválido.'},400);
  const text=body.text.trim();
  if(text.length<2||text.length>MAX_TEXT_CHARS)
    return json({error:'Texto de áudio fora do limite permitido.'},400);
  // Serialized, server-only per-org voice budget: 40/day, 500/month, <=120k chars/month.
  const {data:usageId,error:usageError}=await admin.rpc('reserve_nexus_ai_voice_usage',{
    p_organization_id:profile.organization_id,
    p_user_id:user.id,
    p_character_count:text.length,
  });
  if(usageError||!usageId)return json({error:'Limite de teste da voz neural atingido ou indisponível.'},429);
  try{
    const form=new FormData();
    form.set('text',text);
    form.set('language','pt-BR');
    form.set('voice',MALE_VOICE);
    form.set('encoding','LINEAR_PCM');
    form.set('sample_rate_hz','22050');
    const result=await fetch(TTS_URL,{
      method:'POST',
      headers:{Authorization:`Bearer ${nvidiaKey}`},
      body:form,
      signal:AbortSignal.timeout(27_000),
    });
    if(!result.ok){
      console.error(JSON.stringify({event:'nexus_neural_tts_error',provider_status:result.status}));
      return json({error:'Voz neural NVIDIA indisponível. Utilize a voz do navegador.'},502);
    }
    const declaredBytes=Number(result.headers.get('content-length')||0);
    if(Number.isFinite(declaredBytes)&&declaredBytes>MAX_AUDIO_BYTES)
      return json({error:'Áudio gerado ultrapassou o limite de tamanho.'},502);
    const audio=await result.arrayBuffer();
    if(audio.byteLength<44||audio.byteLength>MAX_AUDIO_BYTES)
      return json({error:'Resposta de áudio inválida.'},502);
    const bytes=new Uint8Array(audio);
    const signature=String.fromCharCode(...bytes.slice(0,4));
    const format=String.fromCharCode(...bytes.slice(8,12));
    if(signature!=='RIFF'||format!=='WAVE')return json({error:'Formato de áudio não suportado.'},502);
    return json({provider:'nvidia',model:'magpie-tts-multilingual',voice:'Diego',
      language:'pt-BR',mimeType:'audio/wav',audioBase64:toBase64(audio)});
  }catch{
    return json({error:'Não foi possível gerar a voz neural neste momento.'},502);
  }
});
