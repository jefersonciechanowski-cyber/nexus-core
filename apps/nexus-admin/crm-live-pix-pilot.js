const $=id=>document.getElementById(id);
let apiClient=null,busy=false,currentStatus='not_prepared',chargeAttempted=false;
const stages=new Set(['payment_pending','paid','provision_pending','provisioned']);
function showError(msg){$('error').textContent=String(msg||'Falha privada de validação.');}
function update(state){
 currentStatus=state?.status||'not_prepared';
 $('progress').textContent='Status do piloto: '+currentStatus+' · Pix avulso R$ 10,00';
 $('prepareButton').disabled=busy||currentStatus!=='not_prepared';
 $('charge').disabled=busy||chargeAttempted||currentStatus!=='prepared'||!$('chargeConsent').checked;
 $('verify').disabled=busy||!stages.has(currentStatus);
 $('activate').disabled=busy||!['paid','provision_pending'].includes(currentStatus);
 if(state?.invoiceUrl) {
  try{const url=new URL(state.invoiceUrl);if(url.protocol==='https:'&&['www.asaas.com','asaas.com'].includes(url.hostname)){
   $('invoiceLink').href=url.toString();$('invoice').hidden=false;
  }}catch{}
 }
}
async function call(action,payload={}){
 if(busy) return null;
 busy=true;showError('');update({status:currentStatus});
 try{
  const {data,error}=await apiClient.functions.invoke('nexus-admin-crm-live-pix-pilot',{body:{action,...payload}});
  if(error){let message='';
   try{const res=error.context;if(typeof res?.json==='function'){const parsed=await res.json();message=String(parsed?.error||'');}}catch{}
   throw new Error(message||'Piloto de produção ainda não habilitado.');
  }
  if(data?.error)throw new Error(String(data.error));
  update(data);
  return data;
 }catch(err){showError(err?.message||'Falha. Não tente criar outra cobrança automaticamente.');return null;
 }finally{busy=false;update({status:currentStatus});}
}
$('prepare').addEventListener('submit',async event=>{
 event.preventDefault();
 const payload={companyName:$('company').value,responsibleName:$('responsible').value,
 email:$('email').value,cpf:$('cpf').value,acceptedOneTimeTerms:$('terms').checked};
 const result=await call('prepare',payload);
 $('cpf').value='';
 if(result){$('prepare').reset();$('prepareButton').disabled=true;}
});
$('chargeConsent').addEventListener('change',()=>update({status:currentStatus}));
$('charge').addEventListener('click',async()=>{
 if(!$('chargeConsent').checked||currentStatus!=='prepared')return;
 if(!confirm('Confirma a CRIAÇÃO DE UMA COBRANÇA REAL e única de R$ 10 via Pix, sem renovação?'))return;
 chargeAttempted=true;
 $('charge').disabled=true;
 await call('charge',{confirmation:'AUTORIZO COBRANCA REAL PIX DE R$ 10'});
});
$('verify').addEventListener('click',()=>call('verify'));
$('activate').addEventListener('click',async()=>{
 if(!confirm('O Pix já foi recebido e conferido. Confirma a liberação de um novo CRM pago de homologação?'))return;
 const data=await call('activate');
 if(data?.firstAccessUrl) {
   try{const url=new URL(data.firstAccessUrl);
    if(url.origin==='https://crm.nexuscore.app.br'&&url.pathname==='/auth/primeiro-acesso'){
      $('accessLink').value=url.toString();$('access').hidden=false;
    }
   }catch{}
 }
});
$('copy').addEventListener('click',async()=>{if($('accessLink').value)await navigator.clipboard.writeText($('accessLink').value);});
(async()=>{
 try{
  const session=await window.NexusAuth.restoreSession();
  if(!session){location.replace('login.html');return}
  if(session.role!=='nexus_admin')throw new Error('Apenas a administração Nexus pode operar este piloto.');
  apiClient=window.NexusAuth.getClient();
  await call('status');
 }catch(e){showError(e?.message||'Acesso administrativo indisponível.');}
})();
