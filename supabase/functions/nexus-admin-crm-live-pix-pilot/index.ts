import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { sendCrmSmtpMail } from '../stripe-webhook/crm-brevo-smtp.ts';
import { provisionCrmTenant } from '../_shared/crm-provisioning.ts';
import {
  LIVE_PIX_AMOUNT_CENTS, LIVE_PIX_AMOUNT_BRL, LIVE_PIX_SLOT,
  LIVE_PIX_PROVIDER_HOST, LIVE_PIX_CHARGE_CONFIRMATION, LIVE_PIX_PILOT_PREFIX,
  validateLivePixApplicant, canRunLivePixPilot, safeAsaasProductionInvoice,
  assertLivePixCustomer, assertLivePixPayment,
} from '../_shared/crm-live-pix-pilot.mjs';

// Admin-only read/status and applicant reservation are enabled.
// Real production Asaas charging stays blocked even if every environment
// variable is set. A separate reviewed deployment is required to charge.
const STAGED_LIVE_PIX_DISABLED = false;
const STAGED_LIVE_PIX_CHARGE_DISABLED = false;
const MAX_BODY_BYTES = 8192;
const ORIGINS = new Set([
  'https://nexuscore.app.br',
  'https://www.nexuscore.app.br',
  'https://central.nexuscore.app.br',
]);
const small = (v: unknown, n = 200) => typeof v === 'string' ? v.trim().slice(0,n) : '';
const isUuid = (v: unknown) => typeof v === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(v);

function reply(body: unknown, status = 200, origin = 'https://nexuscore.app.br') {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'vary': 'Origin',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  }});
}

async function readJson(req: Request) {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return null;
  const length = Number(req.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return null;
  const body = await req.text();
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch { return null; }
}

async function asaasRequest(key: string, method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>) {
  if (!/^\/(customers|payments)(\/[A-Za-z0-9_-]{4,130})?$/.test(path)) throw new Error('invalid_provider_path');
  const response = await fetch(LIVE_PIX_PROVIDER_HOST + path, {
    method, headers: { access_token: key, accept: 'application/json',
      'Content-Type': 'application/json', 'User-Agent': 'NexusCRM-PixPilot/1.0' },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  if (raw.length > 25000 || !response.ok) throw new Error('provider_not_confirmed');
  try { return JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error('provider_unreadable'); }
}

function safeView(p: any, chargeEnabled = false) {
  return p ? {
    status: p.status,
    amount: 'R$ 10,00',
    billingType: 'PIX',
    invoiceUrl: safeAsaasProductionInvoice(p.invoice_url),
    providerPaymentCreated: Boolean(p.provider_payment_id),
    received: Boolean(p.received_at),
    crmReady: Boolean(p.access_id && p.organization_id && p.status === 'provisioned'),
    expiresAt: p.status === 'provisioned' ? p.access_ends_at ?? null : null,
    onboardingEmailSent: Boolean(p.access_email_sent_at),
    chargeEnabled,
  } : { status: 'not_prepared', amount: 'R$ 10,00', billingType: 'PIX', chargeEnabled };
}

async function audit(admin: any, action: string, userId: string, pilotId: string, data: Record<string, unknown> = {}) {
  await admin.from('audit_logs').insert({
    user_id: userId, action, entity: 'nexus_crm_live_pix_pilot', entity_id: pilotId,
    metadata: { amount_cents: LIVE_PIX_AMOUNT_CENTS, ...data },
  });
}
async function updatePilot(admin: any, id: string, patch: Record<string, unknown>) {
  const { data, error } = await admin.from('nexus_crm_live_pix_pilot')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single();
  if (error || !data) throw new Error('pilot_update_failed');
  return data;
}
async function failReview(admin: any, pilotId: string, code: string) {
  await admin.from('nexus_crm_live_pix_pilot').update({
    status:'manual_review', error_code:code,updated_at:new Date().toISOString(),
  }).eq('id',pilotId);
}
function inOneMonth() {
  const today = new Date();
  const year = today.getUTCFullYear(), month = today.getUTCMonth(), day = today.getUTCDate();
  const start = new Date(Date.UTC(year, month+1,1));
  const last = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
  start.setUTCDate(Math.min(day,last));
  return start.toISOString().slice(0,10);
}

type PilotEmailResult = { sent:boolean; reason:string };
async function sendPilotFirstAccessEmail(
  email: string, responsible: string, company: string, firstAccessUrl: string | null,
): Promise<PilotEmailResult> {
  if (!firstAccessUrl) return {sent:false,reason:'access_link_missing'};
  let safeUrl: string;
  try {
    const u = new URL(firstAccessUrl);
    if (u.origin !== 'https://crm.nexuscore.app.br'
      || u.pathname !== '/auth/primeiro-acesso')
      return {sent:false,reason:'access_link_unrecognized'};
    safeUrl = u.toString();
  } catch { return {sent:false,reason:'access_link_invalid'}; }
  const esc = (input: string) => small(input,160)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const content = '<div style="font-family:Arial,sans-serif;line-height:1.6">'
    +'<h2>Seu acesso ao Nexus CRM está pronto</h2>'
    +'<p>Olá, '+esc(responsible)+'. A empresa '+esc(company)
    +' concluiu o pagamento <strong>Pix avulso de homologação de R$ 10</strong>.</p>'
    +'<p>Este teste não cria assinatura automática ou cobranças recorrentes.</p>'
    +'<p><a href="'+safeUrl+'">Definir minha senha e entrar no CRM</a></p>'
    +'<p>Não encaminhe este link de primeiro acesso para outra pessoa.</p></div>';
  const result = await sendCrmSmtpMail({
    toEmail: email, toName: responsible,
    subject: 'Nexus CRM — primeiro acesso do piloto Pix',
    htmlContent: content,
  });
  return {sent:result.sent,reason:result.reason};
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  const cors = ORIGINS.has(origin) ? origin : 'https://nexuscore.app.br';
  if (STAGED_LIVE_PIX_DISABLED) return reply({error:'Piloto real Pix ainda não habilitado.'},503,cors);
  if (!ORIGINS.has(origin)) return reply({error:'Origem não autorizada.'},403,cors);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:reply({},200,cors).headers});
  if (request.method !== 'POST') return reply({error:'Método não permitido.'},405,cors);
  const body = await readJson(request);
  if (!body) return reply({error:'Solicitação inválida.'},400,cors);
  const action = small(body.action,30);
  // Non-financial preparation is allowed only after active Nexus admin and
  // fresh AAL2 below. Charge/verification/activation remain feature-gated.
  if (!['status','prepare'].includes(action) &&
      !canRunLivePixPilot(Deno.env.toObject(),action))
    return reply({error:'Operação financeira privada desativada.'},503,cors);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = request.headers.get('Authorization') || '';
  if (!url || !anon || !service || !authHeader.startsWith('Bearer ')) return reply({error:'Servidor não configurado.'},503,cors);
  const userClient = createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
  const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError} = await userClient.auth.getUser();
  if (userError || !user) return reply({error:'Sessão inválida.'},401,cors);
  const accessToken = authHeader.replace(/^Bearer\s+/i,'').trim();
  const {data:aal,error:aalError} = await userClient.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
  if (aalError || aal?.currentLevel !== 'aal2') return reply({error:'Autenticação MFA2 obrigatória.'},403,cors);
  const {data:profile,error:profileError} = await admin.from('profiles')
    .select('id,role,active').eq('id',user.id).maybeSingle();
  if (profileError || profile?.role !== 'nexus_admin' || profile.active !== true)
    return reply({error:'Administração Nexus necessária.'},403,cors);

  const chargeEnabled = !STAGED_LIVE_PIX_CHARGE_DISABLED
    && canRunLivePixPilot(Deno.env.toObject(),'charge');
  const {data:pilot,error:pilotError} = await admin.from('nexus_crm_live_pix_pilot')
    .select('*').eq('slot',LIVE_PIX_SLOT).maybeSingle();
  if (pilotError) return reply({error:'Tabela do piloto não disponível.'},503,cors);
  if (action === 'status') return reply(safeView(pilot,chargeEnabled),200,cors);

  if (action === 'prepare') {
    if (pilot) return reply({error:'Já existe uma única operação piloto reservada.',...safeView(pilot)},409,cors);
    const applicant = validateLivePixApplicant(body);
    if (!applicant) return reply({error:'Confira e-mail, CPF, responsável, empresa e consentimento.'},400,cors);
    const {data:check,error:preflightError} = await admin.rpc('preflight_nexus_crm_public_identity',{
      p_document:applicant.cpf,p_email:applicant.email,
    });
    if (preflightError || check?.eligible !== true)
      return reply({error:'Esta identidade já está vinculada ou não foi aprovada para um novo CRM.'},409,cors);
    const {data:product} = await admin.from('nexus_products')
      .select('id').eq('code','crm').eq('status','active').maybeSingle();
    const {data:plan} = product?.id ? await admin.from('nexus_plans')
      .select('id,code,name,price_cents,included_user_limit,status')
      .eq('product_id',product.id).eq('code','start').eq('status','active').maybeSingle()
      : {data:null};
    if (!plan?.id || Number(plan.included_user_limit) < 1)
      return reply({error:'Plano Start indisponível.'},503,cors);
    const id = crypto.randomUUID();
    const {data:created,error:insertError} = await admin.from('nexus_crm_live_pix_pilot').insert({
      id,slot:LIVE_PIX_SLOT,external_reference:LIVE_PIX_PILOT_PREFIX+id,
      created_by:user.id,company_name:applicant.companyName,responsible_name:applicant.responsibleName,
      email:applicant.email,cpf:applicant.cpf,plan_id:plan.id,
      amount_cents:LIVE_PIX_AMOUNT_CENTS,currency:'BRL',billing_type:'PIX',status:'prepared',
    }).select('*').single();
    if (insertError || !created) return reply({error:'Reserva única já existente ou bloqueada.'},409,cors);
    try { await audit(admin,'NEXUS_CRM_LIVE_PIX_PILOT_PREPARED',user.id,id); }
    catch { /* Reservation persists; avoid misleading the operator or retrying. */ }
    return reply(safeView(created,chargeEnabled),200,cors);
  }

  if (!pilot) return reply({error:'Prepare a contratação antes de prosseguir.'},409,cors);
  const asaasKey = Deno.env.get('ASAAS_PRODUCTION_API_KEY') || '';
  if (asaasKey.length < 20) return reply({error:'Chave Asaas de produção não configurada no servidor.'},503,cors);

  if (action === 'charge') {
    if (!chargeEnabled)
      return reply({error:'Geração de Pix real não habilitada nas duas autorizações privadas.'},503,cors);
    if (body.confirmation !== LIVE_PIX_CHARGE_CONFIRMATION)
      return reply({error:'Confirmação explícita de Pix real R$ 10 obrigatória.'},400,cors);
    // This UPDATE is a single-winner lock. Never retry charge after an unclear result.
    const {data:locked,error:lockError} = await admin.from('nexus_crm_live_pix_pilot')
      .update({status:'creating_customer',updated_at:new Date().toISOString()})
      .eq('id',pilot.id).eq('status','prepared').select('id').maybeSingle();
    if (lockError || !locked) return reply({error:'Esta operação já foi iniciada. Não gere outra cobrança.'},409,cors);
    try {
      const customer = await asaasRequest(asaasKey,'POST','/customers',{
        name:pilot.responsible_name,cpfCnpj:pilot.cpf,email:pilot.email,
        notificationDisabled:true,externalReference:pilot.external_reference,
      });
      const customerId = small(customer.id,130);
      if (!/^cus_[A-Za-z0-9_-]{4,120}$/.test(customerId)) throw new Error('invalid_customer_response');
      await updatePilot(admin,pilot.id,{provider_customer_id:customerId,status:'creating_payment'});
      const tomorrow = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
      const payment = await asaasRequest(asaasKey,'POST','/payments',{
        customer:customerId,billingType:'PIX',value:LIVE_PIX_AMOUNT_BRL,dueDate:tomorrow,
        description:'Nexus CRM | teste real Pix avulso R$10, sem assinatura',
        externalReference:pilot.external_reference,
      });
      const paymentId = small(payment.id,130);
      const invoice = safeAsaasProductionInvoice(payment.invoiceUrl);
      if (!/^pay_[A-Za-z0-9_-]{4,120}$/.test(paymentId)
        || payment.customer !== customerId || payment.billingType !== 'PIX'
        || Number(payment.value) !== LIVE_PIX_AMOUNT_BRL
        || payment.externalReference !== pilot.external_reference || !invoice
        || payment.subscription || payment.installment)
        throw new Error('invalid_payment_response');
      const saved = await updatePilot(admin,pilot.id,{
        provider_payment_id:paymentId,invoice_url:invoice,status:'payment_pending',
        payment_due:tomorrow,
      });
      await audit(admin,'NEXUS_CRM_LIVE_PIX_PILOT_CHARGE_CREATED',user.id,pilot.id);
      return reply(safeView(saved,chargeEnabled),200,cors);
    } catch {
      await failReview(admin,pilot.id,'live_charge_unknown_check_asaas_before_retry');
      return reply({error:'Resultado do Asaas inconclusivo. Não tente criar outra cobrança; concilie no painel de produção.'},502,cors);
    }
  }

  if (!pilot.provider_payment_id || !pilot.provider_customer_id)
    return reply({error:'Nenhuma cobrança confirmada no registro. Verificação manual necessária.'},409,cors);
  if (!/^pay_[A-Za-z0-9_-]{4,120}$/.test(pilot.provider_payment_id)
    || !/^cus_[A-Za-z0-9_-]{4,120}$/.test(pilot.provider_customer_id))
    return reply({error:'Referência do provedor inválida.'},409,cors);
  if (!['payment_pending','paid','provision_pending','provisioned'].includes(pilot.status))
    return reply({error:'Operação em revisão. Nenhum retry de cobrança autorizado.'},409,cors);

  let received;
  try {
    const payment = await asaasRequest(asaasKey,'GET','/payments/'+pilot.provider_payment_id);
    const customer = await asaasRequest(asaasKey,'GET','/customers/'+pilot.provider_customer_id);
    const verified = assertLivePixPayment(payment,pilot);
    if (!assertLivePixCustomer(customer,pilot)
      || !verified.ok) return reply({
        ...safeView(pilot),verified:false,reason:verified.ok?'customer_mismatch':verified.reason,
      },409,cors);
    received = payment;
  } catch {
    return reply({error:'Não foi possível verificar a cobrança diretamente no Asaas.'},503,cors);
  }
  if (action === 'verify') {
    const verified = pilot.status === 'payment_pending'
      ? await updatePilot(admin,pilot.id,{status:'paid',received_at:new Date().toISOString()})
      : pilot;
    await audit(admin,'NEXUS_CRM_LIVE_PIX_PILOT_RECEIPT_VERIFIED',user.id,pilot.id);
    return reply({...safeView(verified,chargeEnabled),verified:true},200,cors);
  }

  if (action !== 'activate') return reply({error:'Ação inválida.'},400,cors);
  if (pilot.status === 'provisioned') return reply({...safeView(pilot,chargeEnabled),firstAccessUrl:null},200,cors);
  if (!['paid','provision_pending'].includes(pilot.status))
    return reply({error:'Verifique o recebimento antes da ativação.'},409,cors);

  // New business only: CRM user must not be adopted from a separate tenant.
  // A known partially provisioned record resumes from its own organization ID.
  const {data:check,error:preflightError} = pilot.organization_id ? {data:{eligible:true},error:null}
    : await admin.rpc('preflight_nexus_crm_public_identity',{
      p_document:pilot.cpf,p_email:pilot.email,
    });
  if (preflightError || check?.eligible !== true)
    return reply({error:'Identidade já vinculada. Revisão administrativa necessária.'},409,cors);

  const {data:product} = await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  const {data:plan} = await admin.from('nexus_plans')
    .select('id,product_id,code,name,included_user_limit,status').eq('id',pilot.plan_id).maybeSingle();
  if (!product?.id || plan?.product_id !== product.id || plan?.code !== 'start'
    || plan.status !== 'active' || !Number.isInteger(Number(plan.included_user_limit)))
    return reply({error:'Plano CRM incompatível.'},409,cors);

  // The provider was read again moments before provisioning; no webhook alone
  // or customer assertion is enough to authorize an account.
  try {
    let current = pilot;
    if (current.status === 'paid') current = await updatePilot(admin,pilot.id,{status:'provision_pending'});
    const slug = 'nexus-crm-live-pix-r10-'+String(pilot.id).slice(0,8);
    let organizationId = small(current.organization_id,80);
    if (!organizationId) {
      const {data:existingOrg} = await admin.from('organizations')
        .select('id,email,registration_number').eq('slug',slug).maybeSingle();
      if (existingOrg?.id) {
        if (existingOrg.email !== pilot.email || existingOrg.registration_number !== pilot.cpf)
          throw new Error('existing_organization_mismatch');
        organizationId = existingOrg.id;
      } else {
        const {data:newOrg,error:orgError} = await admin.from('organizations').insert({
          name:pilot.company_name,slug,status:'active',email:pilot.email,
          registration_type:'CPF',registration_number:pilot.cpf,
          legal_responsible_name:pilot.responsible_name,
        }).select('id').single();
        if (orgError || !newOrg?.id) throw new Error('organization_create_failed');
        organizationId = newOrg.id;
      }
      current = await updatePilot(admin,pilot.id,{organization_id:organizationId});
    }
    let accessId = small(current.access_id,80);
    if (!accessId) {
      const {data:existingAccess} = await admin.from('organization_product_access')
        .select('id,billing_provider,contracted_price_cents').eq('organization_id',organizationId)
        .eq('product_id',product.id).maybeSingle();
      if (existingAccess?.id) {
        if (existingAccess.billing_provider!=='asaas'
          || Number(existingAccess.contracted_price_cents)!==LIVE_PIX_AMOUNT_CENTS)
          throw new Error('existing_contract_mismatch');
        accessId = existingAccess.id;
      } else {
        const {data:access,error:accessError} = await admin.from('organization_product_access').insert({
          organization_id:organizationId,product_id:product.id,plan_id:plan.id,
          plan_name:plan.name+' · Pix avulso de homologação',
          access_status:'active',subscription_status:'active',commercial_condition:'standard',
          contracted_price_cents:LIVE_PIX_AMOUNT_CENTS,contracted_currency:'BRL',
          billing_provider:'asaas',provider_customer_id:pilot.provider_customer_id,
          provider_subscription_id:null,billing_mode:'prepaid',billing_cycle_months:1,
          starts_at:new Date().toISOString().slice(0,10),renews_at:inOneMonth(),
          base_user_limit_override:Number(plan.included_user_limit),additional_users:0,
          last_payment_at:new Date().toISOString(),
        }).select('id').single();
        if (accessError || !access?.id) throw new Error('access_create_failed');
        accessId = access.id;
      }
      current = await updatePilot(admin,pilot.id,{access_id:accessId});
    }
    const {data:priorPayment} = await admin.from('nexus_payments')
      .select('id,access_id,amount_cents').eq('provider_payment_id',pilot.provider_payment_id).maybeSingle();
    if (priorPayment?.id) {
      if (priorPayment.access_id !== accessId || Number(priorPayment.amount_cents)!==LIVE_PIX_AMOUNT_CENTS)
        throw new Error('existing_payment_mismatch');
    } else {
      const {error:paymentError} = await admin.from('nexus_payments').insert({
        organization_id:organizationId,access_id:accessId,provider:'asaas',
        provider_payment_id:pilot.provider_payment_id,
        provider_customer_id:pilot.provider_customer_id,provider_status:'RECEIVED',
        billing_type:'PIX',amount_cents:LIVE_PIX_AMOUNT_CENTS,currency:'BRL',
        received_at:new Date().toISOString(),external_reference:pilot.external_reference,
      });
      if (paymentError) throw new Error('payment_record_failed');
    }
    const delivery = await provisionCrmTenant(admin,{
      id:pilot.id,plan_id:plan.id,company_name:pilot.company_name,
      responsible_name:pilot.responsible_name,email:pilot.email,
    },{id:accessId},'administrative');
    if (delivery.error || !delivery.crmOrganizationId) throw new Error('crm_delivery_pending');
    const completed = await updatePilot(admin,pilot.id,{
      status:'provisioned',activated_at:new Date().toISOString(),access_ends_at:inOneMonth(),
    });
    const emailResult = await sendPilotFirstAccessEmail(
      pilot.email,pilot.responsible_name,pilot.company_name,delivery.firstAccessUrl,
    );
    if (emailResult.sent) {
      await updatePilot(admin,pilot.id,{
        access_email_sent_at:new Date().toISOString(),
      }).catch(() => { /* Do not roll back an activated contract for an audit-only update. */ });
    }
    await audit(admin,'NEXUS_CRM_LIVE_PIX_PILOT_EMAIL_'+
      (emailResult.sent?'ACCEPTED':'NOT_SENT'),user.id,pilot.id,{
      reason:emailResult.reason,
    }).catch(() => { /* Never fail provisioning due to diagnostic audit unavailability. */ });
    await audit(admin,'NEXUS_CRM_LIVE_PIX_PILOT_PROVISIONED',user.id,pilot.id,{
      organization_id:organizationId,access_id:accessId,crm_organization_id:delivery.crmOrganizationId,
    }).catch(() => { /* Provisioning is already confirmed. */ });
    return reply({...safeView(completed,chargeEnabled),onboardingEmailSent:emailResult.sent,firstAccessUrl:delivery.firstAccessUrl},200,cors);
  } catch {
    await updatePilot(admin,pilot.id,{status:'provision_pending',error_code:'crm_activation_needs_review'});
    return reply({error:'Pagamento confirmado, mas ativação requer revisão. Não crie outra cobrança.'},502,cors);
  }
});
