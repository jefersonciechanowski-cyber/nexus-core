const ADMIN_MFA_MAX_AGE_SECONDS=7200;
function loginTarget(){const requested=new URLSearchParams(location.search).get('next');return ['index.html','crm-access.html','crm-live-pix-pilot.html'].includes(requested)?requested:'index.html';}

const e=document.getElementById('email'),p=document.getElementById('password'),b=document.getElementById('login'),m=document.getElementById('error'),passwordStep=document.getElementById('passwordStep'),mfaStep=document.getElementById('mfaStep'),mfaCode=document.getElementById('mfaCode'),verifyMfa=document.getElementById('verifyMfa'),enrollArea=document.getElementById('enrollArea'),mfaQr=document.getElementById('mfaQr'),mfaSecret=document.getElementById('mfaSecret'),mfaTitle=document.getElementById('mfaTitle'),mfaText=document.getElementById('mfaText');
let factorId=null,currentSession=null;
function recentTotp(methods){const cutoff=Math.floor(Date.now()/1000)-ADMIN_MFA_MAX_AGE_SECONDS;return (methods||[]).some(item=>item?.method==='totp'&&Number(item.timestamp)>=cutoff);}
function markAdminSession(){if(!currentSession)return;sessionStorage.setItem('nexus_admin_mfa_session',JSON.stringify({userId:currentSession.userId,verifiedAt:Date.now()}));}
async function ensureAal2(){const client=window.NexusAuth.getClient();const{data,error}=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(error)throw error;if(data?.currentLevel!=='aal2'||!recentTotp(data.currentAuthenticationMethods))throw new Error('A verificação em duas etapas não foi concluída.');markAdminSession();location.replace(loginTarget());}
async function prepareMfa(){const client=window.NexusAuth.getClient();const{data,error}=await client.auth.mfa.listFactors();if(error)throw error;const verified=(data?.totp||[]).find(item=>item.status==='verified');if(verified){factorId=verified.id;mfaTitle.textContent='Verificação em duas etapas';mfaText.textContent='Abra seu aplicativo autenticador e informe o código atual.';enrollArea.hidden=true;}else{for(const item of (data?.totp||[]).filter(x=>x.status!=='verified')){await client.auth.mfa.unenroll({factorId:item.id}).catch(()=>undefined);}const{data:enrolled,error:enrollError}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Central Nexus'});if(enrollError||!enrolled?.id)throw enrollError||new Error('Não foi possível iniciar o MFA.');factorId=enrolled.id;mfaTitle.textContent='Proteja a Central Nexus';mfaText.textContent='Este é o primeiro acesso com MFA. Cadastre a Central no seu aplicativo autenticador e confirme o código.';mfaQr.src=enrolled.totp.qr_code;mfaSecret.textContent=enrolled.totp.secret;enrollArea.hidden=false;}passwordStep.hidden=true;mfaStep.hidden=false;setTimeout(()=>mfaCode.focus(),0);}
async function login(){m.textContent='';b.disabled=true;b.textContent='Validando...';try{const s=await window.NexusAuth.login(e.value,p.value);if(s.role!=='nexus_admin'){await window.NexusAuth.logout();throw new Error('Esta conta não possui acesso administrativo Nexus.');}currentSession=s;await prepareMfa();}catch(err){m.textContent=err.message||'Não foi possível entrar.';}finally{b.disabled=false;b.textContent='Continuar';}}
async function confirmMfa(){m.textContent='';const code=mfaCode.value.replace(/\D/g,'');if(code.length!==6){m.textContent='Informe o código de 6 dígitos.';return;}verifyMfa.disabled=true;verifyMfa.textContent='Verificando...';try{const client=window.NexusAuth.getClient();const{error}=await client.auth.mfa.challengeAndVerify({factorId,code});if(error)throw error;await ensureAal2();}catch(err){m.textContent='Código inválido ou expirado. Gere um novo código no autenticador e tente novamente.';}finally{verifyMfa.disabled=false;verifyMfa.textContent='Verificar e entrar';}}
b.onclick=login;verifyMfa.onclick=confirmMfa;mfaCode.addEventListener('input',()=>{mfaCode.value=mfaCode.value.replace(/\D/g,'').slice(0,6)});document.addEventListener('keydown',ev=>{if(ev.key!=='Enter')return;if(!mfaStep.hidden)confirmMfa();else login();});
window.addEventListener('DOMContentLoaded',async()=>{
  b.disabled=true;
  try{
    const s=await window.NexusAuth.restoreSession();
    if(!s)return;
    if(s.role!=='nexus_admin'){
      m.textContent='Existe uma sessão de outra conta neste navegador. Entre com a conta de administração Nexus.';
      return;
    }
    currentSession=s;
    const{data,error}=await window.NexusAuth.getClient().auth.mfa.getAuthenticatorAssuranceLevel();
    if(error){
      m.textContent='Não foi possível confirmar o MFA da sessão existente. Atualize a página ou entre novamente.';
      return;
    }
    if(data?.currentLevel==='aal2'&&recentTotp(data.currentAuthenticationMethods)){
      // AAL2 and recent TOTP are verified by Supabase; the per-tab marker
      // is not proof of authentication and must never destroy valid sessions.
      markAdminSession();
      location.replace(loginTarget());
      return;
    }
    // Valid password session, but MFA is missing/expired: re-verify TOTP
    // without asking for the password again or silently signing out.
    await prepareMfa();
  }catch(error){
    m.textContent=error?.message||'Não foi possível recuperar a sessão administrativa.';
  }finally{b.disabled=false;}
});
