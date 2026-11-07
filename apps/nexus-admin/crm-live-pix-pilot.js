const $=id=>document.getElementById(id);
let apiClient=null,busy=false,currentStatus='not_prepared',chargeAttempted=false,financeEnabled=false,chargeEnabled=false;
const stages=new Set(['payment_pending','paid','provision_pending','provisioned']);
function showError(msg){$('error').textContent=String(msg||'Falha privada de validação.');}
function update(state){
 currentStatus=state?.status||'not_prepared';
 $('progress').textContent='Status do piloto: '+currentStatus+' · Pix avulso R$ 10,00';
 if(state?.expiresAt && currentStatus==='provisioned'){
  $('pilotExpiryNotice').hidden=false;
  $('pilotExpiryNotice').textContent='Contrato avulso com vigência até '+String(state.expiresAt)+
   '. Não há cobrança recorrente. Conferir encerramento/suspensão administrativa na data de vencimento.';
 }
 $('prepareButton').disabled=busy||!financeEnabled||currentStatus!=='not_prepared';
 $('charge').disabled=busy||!chargeEnabled||!financeEnabled||chargeAttempted||currentStatus!=='prepared'||!$('chargeConsent').checked;
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
  chargeEnabled=data?.chargeEnabled===true;
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
     +(data.paymentsRead===true?'OK':'não confirmadas')+'. Esta verificação não criou nova cobrança.';
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
async function checkCrmAsaasWebhook(){
 if(!apiClient)return;
 $('webhookCheck').disabled=true;
 $('webhookCheckResult').textContent='Conferindo webhooks de produção em modo somente leitura...';
 try{
  const {data,error}=await apiClient.functions.invoke('nexus-admin-asaas-production-health',{
   body:{action:'webhooks'}
  });
  if(error){
   let message='Não foi possível consultar o Asaas.';
   try{if(typeof error.context?.json==='function'){
    const parsed=await error.context.json();if(parsed?.error)message=String(parsed.error);
   }}catch{}
   throw new Error(message);
  }
  if(data?.production!==true||data?.createdCharge!==false
    ||typeof data?.receiverBlocked!=='boolean')
    throw new Error('Diagnóstico retornou dados inválidos.');
  const states={
   webhook_not_registered:'Nenhum webhook exclusivo do Nexus CRM encontrado na conta Asaas de produção.',
   webhook_disabled:'Webhook CRM existente, porém desativado no Asaas.',
   webhook_interrupted:'Fila do webhook CRM interrompida. Examine os logs do Asaas antes de reativar.',
   missing_webhook_events:'Webhook CRM cadastrado, mas faltam eventos obrigatórios.',
   receiver_token_not_configured:'Webhook CRM cadastrado, mas o token exclusivo ainda não está configurado na Nexus Central.',
   configuration_detected_receiver_still_blocked:'Configuração do webhook encontrada. O receptor do CRM continua bloqueado para homologação.',
   receiver_ready_for_delivery_test:'Webhook cadastrado e receptor liberado para guardar eventos autenticados. A entrega real ainda precisa ser confirmada pelos Logs do Asaas. O checkout e a liberação do CRM permanecem bloqueados.',
   duplicate_webhook_configuration:'Existem múltiplos webhooks para o mesmo endpoint. Revisão manual necessária.',
   provider_response_invalid:'O Asaas retornou uma lista de webhooks não reconhecida.',
   permission_or_ip_restricted:'Asaas bloqueou a consulta de webhooks por permissão ou IP.',
   unauthorized:'Asaas recusou a chave de produção.',
   rate_limited:'O Asaas limitou a consulta. Evite repetir agora.',
   unavailable:'Não foi possível confirmar o estado dos webhooks.',
  };
  const state=String(data.status||data.connection||'unavailable');
  let result=states[state]||'A verificação de webhooks está inconclusiva.';
  if(Array.isArray(data.missingEvents)&&data.missingEvents.length){
   result+=' Eventos ausentes: '+data.missingEvents.join(', ')+'.';
  }
  if(typeof data.receiverUrl==='string'&&data.receiverUrl.startsWith('https://')
    &&data.receiverUrl.endsWith('/functions/v1/nexus-crm-asaas-production-events')){
   result+=' Endpoint exclusivo do CRM: '+data.receiverUrl+'.';
  }
  result+=' Nenhum pagamento ou webhook foi criado nesta consulta.';
  $('webhookCheckResult').textContent=result;
 }catch(error){
  $('webhookCheckResult').textContent=String(error?.message||'Diagnóstico privado falhou.');
 }finally{$('webhookCheck').disabled=false;}
}
$('webhookCheck').addEventListener('click',checkCrmAsaasWebhook);
async function checkEmailReadiness(){
 if(!apiClient)return;
 $('emailCheck').disabled=true;
 $('emailCheckResult').textContent='Conferindo autenticação SMTP com TLS, sem enviar mensagem...';
 $('emailSendTest').disabled=true;
 try{
  const {data,error}=await apiClient.functions.invoke('nexus-admin-crm-email-health',{
   body:{action:'check'}
  });
  if(error){
   let message='Não foi possível consultar o serviço de e-mail.';
   try{if(typeof error.context?.json==='function'){
    const parsed=await error.context.json();
    if(parsed?.error)message=String(parsed.error);
   }}catch{}
   throw new Error(message);
  }
  if(data?.emailSent!==false || typeof data?.status!=='string')
   throw new Error('Diagnóstico de e-mail retornou uma resposta inválida.');
  const mapping={
   smtp_authenticated:'SMTP do CRM autenticado com segurança. Nenhuma mensagem foi enviada. O remetente ainda precisa de homologação por envio controlado.',
   smtp_invalid_credentials:'O Brevo recusou o login ou a chave SMTP exclusiva do CRM. Confira as credenciais no Supabase.',
   smtp_connection_failed:'Não foi possível estabelecer a conexão SMTP com o Brevo na porta 2525. Confira a rede e a porta, sem alterar outras chaves.',
   smtp_unavailable:'O Brevo SMTP não concluiu a autenticação. Nenhuma mensagem foi enviada.',
   missing_configuration:'Falta a configuração exclusiva do CRM: BREVO_CRM_SMTP_USER, BREVO_CRM_SMTP_KEY, BREVO_CRM_SMTP_HOST, BREVO_CRM_SMTP_PORT ou BREVO_FROM_EMAIL.',
  };
  $('emailCheckResult').textContent=mapping[data.status] ||
    'Não foi possível confirmar a configuração de e-mail. Nenhum envio ocorreu.';
  if(data.status==='smtp_authenticated' && $('emailSendTestResult').dataset.attempted!=='true')$('emailSendTest').disabled=false;
 }catch(e){
  $('emailCheckResult').textContent=String(e?.message || 'Falha de diagnóstico, sem envio.');
 }finally{$('emailCheck').disabled=false;}
}
$('emailCheck').addEventListener('click',checkEmailReadiness);
$('emailSendTest').addEventListener('click',async()=>{
 if(!apiClient||$('emailSendTest').disabled)return;
 if(!confirm('Confirma enviar UM e-mail de teste para o endereço da sua sessão Nexus Admin? Não haverá cobrança, criação de cliente ou link de acesso.'))return;
 $('emailSendTest').disabled=true;
 $('emailSendTestResult').dataset.attempted='true';
 $('emailSendTestResult').textContent='Solicitando envio SMTP para o e-mail da sua sessão...';
 try{
  const {data,error}=await apiClient.functions.invoke('nexus-admin-crm-email-send-test',{
   body:{action:'send_self_test'}
  });
  if(error){
   let message='Não foi possível completar o envio do teste.';
   try{if(typeof error.context?.json==='function'){
    const parsed=await error.context.json();
    if(parsed?.error)message=String(parsed.error);
   }}catch{}
   throw new Error(message);
  }
  const messages={
   smtp_accepted:'Brevo aceitou o e-mail de teste. Verifique sua caixa de entrada e spam. Isso não confirma entrega até você recebê-lo.',
   already_attempted:'Uma tentativa já foi registrada nas últimas 24 horas. Não será feito outro envio automático.',
   audit_unavailable:'Não foi possível registrar o teste com segurança. Nenhum e-mail foi enviado.',
   admin_email_missing:'A sessão não possui um e-mail válido. Nenhum e-mail foi enviado.',
   smtp_invalid_credentials:'O Brevo recusou o login SMTP para envio.',
   smtp_configuration_missing:'Configuração SMTP incompleta. Nenhum e-mail foi enviado.',
   smtp_connection_failed:'Falha na conexão SMTP durante o envio. Não repita imediatamente.',
   smtp_recipient_not_accepted:'O servidor SMTP não aceitou o destinatário.',
   smtp_unavailable:'O Brevo SMTP não concluiu o envio. Não repita automaticamente.',
  };
  $('emailSendTestResult').textContent=messages[data?.status]||
   'Não foi possível confirmar a aceitação do envio. Não repita automaticamente.';
 }catch(e){
  $('emailSendTestResult').textContent=String(e?.message||'Falha de envio. Não repita automaticamente.');
 }
});


$('prepare').addEventListener('submit',async event=>{
 event.preventDefault();
 if(!confirm('Confirma que o CPF, o e-mail novo e o nome da empresa estão corretos? Esta reserva é única e não cria cobrança agora.'))return;
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
  $('webhookCheck').disabled=false;
  await checkAsaasProduction();
  await call('status');
  await checkEmailReadiness();
 }catch(e){showError(e?.message||'Acesso administrativo indisponível.');}
})();
