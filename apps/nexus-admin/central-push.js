/* Nexus Central Web Push — user-initiated PWA permissions, server-side admin MFA.
   No VAPID private key, phone, customer details or messages in this browser code. */
(() => {
  'use strict';
  const PUBLIC_VAPID_KEY='BLngmMZAft4AStqxxdGm5qcbtTvAUX61wdgJ-oGCllyqTu96Rm2ZVFsCp2NxRgavnu5QVtP229HXyP58sCi4hhA';
  const SERVICE_WORKER='/apps/nexus-admin/sw.js';
  const button=document.getElementById('supportEnablePush');
  const disableButton=document.getElementById('supportDisablePush');
  const testButton=document.getElementById('supportTestPush');
  const note=document.getElementById('supportPushNote');
  if (!button || !note || !testButton || !disableButton) return;

  const state={active:false,working:false};
  window.NexusCentralPush=state;
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function supported(){
    return window.isSecureContext && 'serviceWorker' in navigator &&
      'PushManager' in window && 'Notification' in window;
  }
  function inform(text,error=false){
    note.textContent=text;
    note.dataset.error=error?'true':'false';
  }
  function render(){
    button.disabled=state.working;
    disableButton.disabled=state.working;
    testButton.disabled=state.working;
    button.hidden=state.active;
    disableButton.hidden=!state.active;
    testButton.hidden=!state.active;
    if(!state.working) button.textContent='Ativar push no iPhone';
  }
  function base64ToBytes(input){
    const normalized=input.replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));
    return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  async function credential(){
    const client=window.NexusAuth?.getClient?.();
    if(!client) throw new Error('Entre na Central antes de ativar as notificações.');
    const {data,error}=await client.auth.getSession();
    const token=data?.session?.access_token;
    if(error || !token) throw new Error('Sua sessão expirou. Entre novamente na Central.');
    const {data:aal,error:mfaError}=await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if(mfaError || aal?.currentLevel !== 'aal2') throw new Error('Confirme a autenticação em duas etapas para ativar o push.');
    return token;
  }
  async function api(action,extra={}){
    const token=await credential();
    const config=window.NEXUS_SUPABASE_CONFIG;
    if(!config?.url || !config?.publishableKey) throw new Error('Central não está configurada para notificações.');
    const response=await fetch(config.url.replace(/\/$/,'')+'/functions/v1/nexus-support-push',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':config.publishableKey,
        'Authorization':'Bearer '+token,
      },
      body:JSON.stringify({action,...extra}),
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok || payload.ok!==true) throw new Error(payload.error || 'Não foi possível configurar as notificações.');
    return payload;
  }
  async function registration(){
    return navigator.serviceWorker.register(SERVICE_WORKER,{scope:'/apps/nexus-admin/'});
  }
  async function localSubscription(){
    const reg=await navigator.serviceWorker.getRegistration('/apps/nexus-admin/');
    if(!reg || !reg.pushManager) return null;
    return reg.pushManager.getSubscription();
  }
  function currentKeyMatches(subscription){
    const original=subscription?.options?.applicationServerKey;
    if(!original) return true;
    const a=new Uint8Array(original);
    const b=base64ToBytes(PUBLIC_VAPID_KEY);
    return a.length===b.length && a.every((x,i)=>x===b[i]);
  }

  async function enable(){
    if(state.working) return;
    if(isiOS && !standalone) {
      inform('No iPhone: abra no Safari, escolha Compartilhar → Adicionar à Tela de Início e abra a Nexus Central pelo novo ícone.',true);
      return;
    }
    if(!supported()) {
      inform('Este navegador ainda não oferece Push para a Central. No iPhone, use iOS 16.4 ou superior e o atalho da Tela de Início.',true);
      return;
    }
    // Required by iOS: request notification permission directly from this click,
    // before awaiting any network request that could consume user activation.
    let permission=Notification.permission;
    if(permission==='default') permission=await Notification.requestPermission();
    if(permission!=='granted') {
      inform('Notificações não autorizadas. Ative as permissões da Nexus Central nos Ajustes do iPhone.',true);
      return;
    }
    state.working=true;
    render();
    let created=false;
    let sub=null;
    try {
      await credential();
      const reg=await registration();
      sub=await reg.pushManager.getSubscription();
      if(sub && !currentKeyMatches(sub)){
        await sub.unsubscribe();
        sub=null;
      }
      if(!sub){
        sub=await reg.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:base64ToBytes(PUBLIC_VAPID_KEY),
        });
        created=true;
      }
      await api('subscribe',{subscription:sub.toJSON()});
      state.active=true;
      inform('Push ativado! Use “Enviar teste” para verificar a chegada da notificação.');
    } catch(error){
      if(created && sub) try {await sub.unsubscribe();}catch {}
      state.active=false;
      inform(error instanceof Error?error.message:'Não foi possível ativar o push.',true);
    } finally {
      state.working=false;
      render();
    }
  }
  async function disable(){
    if(state.working) return;
    state.working=true;render();
    try{
      const sub=await localSubscription();
      if(sub){
        await api('unsubscribe',{endpoint:sub.endpoint});
        await sub.unsubscribe();
      }
      state.active=false;
      inform('Notificações push desativadas neste dispositivo.');
    }catch(error){
      inform(error instanceof Error?error.message:'Falha ao desativar o push.',true);
    }finally{state.working=false;render();}
  }
  async function sendTest(){
    if(state.working) return;
    state.working=true;render();
    try{
      const sub=await localSubscription();
      if(!sub) throw new Error('Ative o push neste dispositivo antes de enviar o teste.');
      const result=await api('test',{endpoint:sub.endpoint});
      if(result.accepted!==true) throw new Error('O serviço não confirmou o teste.');
      inform('Teste aceito pelo serviço de notificações. Confira os avisos do seu iPhone.');
    }catch(error){
      inform(error instanceof Error?error.message:'Falha ao enviar teste.',true);
    }finally{state.working=false;render();}
  }
  button.addEventListener('click',()=>void enable());
  disableButton.addEventListener('click',()=>void disable());
  testButton.addEventListener('click',()=>void sendTest());

  async function refresh(){
    if(!supported()){
      state.active=false;
      render();
      if(isiOS && !standalone){
        inform('Instale a Nexus Central pela Tela de Início do Safari para habilitar o push no iPhone.');
      }else{
        inform('Notificações push não disponíveis neste navegador ou modo de acesso.');
      }
      return;
    }
    try{
      const sub=await localSubscription();
      state.active=Notification.permission==='granted' && !!sub && currentKeyMatches(sub);
      render();
      if(!state.active && isiOS && !standalone)
        inform('Abra a Central pelo ícone da Tela de Início do iPhone.');
      else if(!state.active)
        inform('Ative o push para receber chamados mesmo com a Central fechada.');
    }catch{
      inform('Não foi possível consultar o status das notificações.',true);
    }
  }
  render();
  void refresh();
})();
