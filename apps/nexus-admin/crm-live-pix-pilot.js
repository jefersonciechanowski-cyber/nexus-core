const $=id=>document.getElementById(id);
let apiClient=null,busy=false,currentStatus='not_prepared',chargeAttempted=false,financeEnabled=false;
const stages=new Set(['payment_pending','paid','provision_pending','provisioned']);
function showError(msg){$('error').textContent=String(msg||'Falha privada de validação.');}
function update(state){
 currentStatus=state?.status||'not_prepared';
 $('progress').textContent='Status do piloto: '+currentStatus+' · Pix avulso R$ 10,00';
 $('prepareButton').disabled=busy||!financeEnabled||currentStatus!=='not_prepared';
 $('charge').disabled=busy||!financeEnabled||chargeAttempted||currentStatus!=='prepared'||!$('chargeConsent').checked;
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
  if(action==='status')financeEnabled=true;
  update(data);
  return data;
 }catch(err){showError(err?.message||'Falha. Não tente criar outra cobrança automaticamente.');return null;
 }finally{busy=false;update({status:currentStatus});}
}
async function checkAsaasProduction(){
 if(!apiClient)return;
 $('asaasCheck').disabled=true;
 $('asaasCheckResult').textContent='Conferindo conexão de produção, somente leitura...';
 try{
  const {data,error}=await apiClient.functions.invoke('nexus-admin-asaas-production-health',{
   body:{action:'check'}
  });
  if(error){
   let message='Não foi possível consultar a integração.';
   try{if(typeof error.context?.json==='function'){
    const parsed=await error.context.json();if(parsed?.error)message=String(parsed.error);
   }}catch{}
   throw new Error(message);
  }
  if(data?.production!==true||data?.createdCharge!==false)throw new Error('Resposta inválida.');
  const connection=data.connection;
  let message='A consulta ao Asaas não foi concluída.';
  if(connection==='ok'){
   const approval=data.accountApproval==='APPROVED'?'Conta aprovada':data.accountApproval==='UNKNOWN'?'Situação cadastral não identificada':'Situação cadastral: '+String(data.accountApproval||'não identificada');
   message='Asaas Produção autenticado. '+approval+'. Consultas de clientes: '
     +(data.customersRead===true?'OK':'não confirmadas')+'. Consultas de cobranças: '
     +(data.paymentsRead===true?'OK':'não confirmadas')+'. Nenhuma cobrança criada.';
  }else if(connection==='missing_or_wrong_environment'){
   message='A chave Asaas de produção não foi reconhecida pelo servidor. Confira o Secret, sem enviá-lo.';
  }else if(connection==='unauthorized'){
   message='Asaas recusou a autenticação. Confira a chave de produção e se ela permanece ativa.';
  }else if(connection==='permission_or_ip_restricted'){
   message='Asaas recusou a consulta por permissão ou restrição de IP.';
  }else if(connection==='rate_limited'){
   message='Asaas limitou as consultas. Evite tentativas repetidas.';
  }
  $('asaasCheckResult').textContent=message;
 }catch(e){
  $('asaasCheckResult').textContent=String(e?.message||'Falha de conexão privada.');
 }finally{$('asaasCheck').disabled=false;}
}
$('asaasCheck').addEventListener('click',checkAsaasProduction);
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
  if(!session){location.replace('login.html?next=crm-live-pix-pilot.html');return}
  if(session.role!=='nexus_admin')throw new Error('Apenas a administração Nexus pode operar este piloto.');
  apiClient=window.NexusAuth.getClient();
  await checkAsaasProduction();
  await call('status');
 }catch(e){showError(e?.message||'Acesso administrativo indisponível.');}
})();
