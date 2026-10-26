import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';
import { provisionCrmTenant, sendCrmAccessEmail, syncCrmEntitlement } from './crm-provisioning.ts';
import { provisionSaleForProvider } from '../_shared/nexus-sale-provisioning.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);
const dateFromUnix = (value: unknown) => Number(value) > 0 ? new Date(Number(value) * 1000).toISOString().slice(0, 10) : null;

function livePaymentsEnabled() {
  return Deno.env.get('NEXUS_PAYMENT_LIVE_ENABLED') === 'true';
}

function addMonthsDate(months: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + Math.max(1, Number(months) || 1));
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: unknown) {
  return clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(value: unknown) {
  return clean(value, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'empresa';
}

function subscriptionPeriodEnd(subscription: any) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const values = items.map((item: any) => Number(item?.current_period_end || 0)).filter((value: number) => value > 0);
  if (values.length) return dateFromUnix(Math.min(...values));
  return dateFromUnix(subscription?.current_period_end);
}

function invoiceSubscriptionId(invoice: any) {
  if (invoice?.parent?.type === 'subscription_details') return clean(invoice.parent?.subscription_details?.subscription, 255) || null;
  return clean(invoice?.subscription, 255) || null;
}

function invoiceSaleId(invoice: any) {
  if (invoice?.parent?.type === 'subscription_details') return clean(invoice.parent?.subscription_details?.metadata?.nexus_sale_id, 80) || null;
  return clean(invoice?.subscription_details?.metadata?.nexus_sale_id, 80) || null;
}

function mapSubscriptionStatus(value: unknown) {
  const status = clean(value, 50).toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trial';
  if (status === 'canceled') return 'cancelled';
  if (['past_due','unpaid','incomplete','incomplete_expired','paused'].includes(status)) return 'past_due';
  return null;
}

function assertProviderBinding(row: any, criteria: { checkoutId?: string | null; subscriptionId?: string | null; customerId?: string | null }, label: string) {
  if (!row) return row;
  const storedCheckout = clean(row.provider_checkout_id, 255);
  const storedSubscription = clean(row.provider_subscription_id, 255);
  const storedCustomer = clean(row.provider_customer_id, 255);
  if (criteria.checkoutId && storedCheckout && storedCheckout !== criteria.checkoutId) {
    throw new Error(`${label}: checkout Stripe divergente do vínculo salvo.`);
  }
  if (criteria.subscriptionId && storedSubscription && storedSubscription !== criteria.subscriptionId) {
    throw new Error(`${label}: assinatura Stripe divergente do vínculo salvo.`);
  }
  if (criteria.customerId && storedCustomer && storedCustomer !== criteria.customerId) {
    throw new Error(`${label}: customer Stripe divergente do vínculo salvo.`);
  }
  return row;
}

async function singleOrThrow(query: any, label: string) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${label}: ${clean(error.message, 500)}`);
  return data;
}

async function findSale(admin: any, criteria: { saleId?: string | null; checkoutId?: string | null; subscriptionId?: string | null; customerId?: string | null }) {
  if (criteria.saleId) {
    const data = await singleOrThrow(
      admin.from('nexus_sales').select('*').eq('id', criteria.saleId).eq('provider', 'stripe'),
      'Falha ao localizar venda por ID',
    );
    if (data) return assertProviderBinding(data, criteria, 'Venda');
  }
  if (criteria.checkoutId) {
    const data = await singleOrThrow(
      admin.from('nexus_sales').select('*').eq('provider', 'stripe').eq('provider_checkout_id', criteria.checkoutId),
      'Falha ao localizar venda por checkout',
    );
    if (data) return assertProviderBinding(data, criteria, 'Venda');
  }
  if (criteria.subscriptionId) {
    const data = await singleOrThrow(
      admin.from('nexus_sales').select('*').eq('provider', 'stripe').eq('provider_subscription_id', criteria.subscriptionId),
      'Falha ao localizar venda por assinatura',
    );
    if (data) return assertProviderBinding(data, criteria, 'Venda');
  }
  return null;
}

async function findAccess(admin: any, criteria: { accessId?: string | null; subscriptionId?: string | null; customerId?: string | null }) {
  const columns = 'id,organization_id,product_id,plan_id,renews_at,contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months,provider_customer_id,provider_subscription_id,external_tenant_id,access_status,subscription_status,plan:nexus_plans(id,name,billing_interval_months,status)';
  if (criteria.accessId) {
    const data = await singleOrThrow(
      admin.from('organization_product_access').select(columns).eq('id', criteria.accessId),
      'Falha ao localizar contrato por ID',
    );
    if (data) return assertProviderBinding(data, criteria, 'Contrato');
  }
  if (criteria.subscriptionId) {
    const data = await singleOrThrow(
      admin.from('organization_product_access').select(columns).eq('billing_provider', 'stripe').eq('provider_subscription_id', criteria.subscriptionId),
      'Falha ao localizar contrato por assinatura',
    );
    if (data) return assertProviderBinding(data, criteria, 'Contrato');
  }
  return null;
}

async function resolveFinancialAccess(admin: any, stripe: Stripe, chargeInput: any) {
  const chargeId = clean(chargeInput?.id, 255);
  const customerId = clean(chargeInput?.customer, 255) || null;
  const paymentIntentId = clean(chargeInput?.payment_intent, 255) || null;
  const invoiceId = clean(chargeInput?.invoice, 255) || null;
  let subscriptionId: string | null = null;

  if (invoiceId) {
    try {
      const invoice: any = await stripe.invoices.retrieve(invoiceId);
      subscriptionId = invoiceSubscriptionId(invoice);
    } catch {
      // Payment/checkout linkage below remains a valid fallback.
    }
  }

  let access = subscriptionId ? await findAccess(admin, { subscriptionId, customerId }) : null;
  const paymentCandidates = [invoiceId, paymentIntentId, chargeId].filter(Boolean) as string[];

  if (!access?.id && paymentCandidates.length) {
    const { data: payments } = await admin
      .from('nexus_payments')
      .select('access_id,provider_payment_id')
      .eq('provider', 'stripe')
      .in('provider_payment_id', paymentCandidates)
      .order('created_at', { ascending: false })
      .limit(1);
    const accessId = clean(payments?.[0]?.access_id, 80);
    if (accessId) access = await findAccess(admin, { accessId, customerId });
  }

  if (!access?.id && customerId) {
    const { data: checkouts } = await admin
      .from('nexus_payment_checkouts')
      .select('access_id')
      .eq('provider', 'stripe')
      .eq('provider_customer_id', customerId)
      .eq('status', 'paid')
      .order('completed_at', { ascending: false })
      .limit(1);
    const accessId = clean(checkouts?.[0]?.access_id, 80);
    if (accessId) access = await findAccess(admin, { accessId, customerId });
  }

  return { access, customerId, subscriptionId, chargeId, invoiceId, paymentIntentId, paymentCandidates };
}

async function updatePaymentFinancialStatus(admin: any, providerPaymentIds: string[], status: string) {
  if (!providerPaymentIds.length) return;
  await admin
    .from('nexus_payments')
    .update({ provider_status: clean(status, 120), updated_at: new Date().toISOString() })
    .eq('provider', 'stripe')
    .in('provider_payment_id', providerPaymentIds);
}

async function syncCrmAccessOrThrow(
  admin: any,
  accessId: string,
  reason: string,
  forcedStatus?: 'active' | 'suspended' | 'cancelled',
  occurredAt?: string,
  forceRevision = false,
) {
  const result = await syncCrmEntitlement(admin, accessId, forcedStatus, occurredAt, forceRevision);
  if (result.isCrm && !result.synced) {
    throw new Error(`Nexus CRM não confirmou ${reason}: ${result.error || 'falha de sincronização'}`);
  }
}

async function applyStripeContractState(admin: any, input: {
  accessId: string;
  eventId: string;
  eventCreatedAt: string;
  eventType: string;
  subscriptionStatus: 'active' | 'trial' | 'past_due' | 'cancelled';
  accessStatus: 'active' | 'suspended';
  customerId?: string | null;
  subscriptionId?: string | null;
  lastPaymentStatus?: string | null;
  lastPaymentAt?: string | null;
  lastPaymentDueDate?: string | null;
  renewsAt?: string | null;
}) {
  const { data, error } = await admin.rpc('apply_stripe_contract_state', {
    p_access_id: input.accessId,
    p_event_id: input.eventId,
    p_event_created_at: input.eventCreatedAt,
    p_event_type: input.eventType,
    p_subscription_status: input.subscriptionStatus,
    p_access_status: input.accessStatus,
    p_provider_customer_id: input.customerId ?? null,
    p_provider_subscription_id: input.subscriptionId ?? null,
    p_last_payment_status: input.lastPaymentStatus ?? null,
    p_last_payment_at: input.lastPaymentAt ?? null,
    p_last_payment_due_date: input.lastPaymentDueDate ?? null,
    p_renews_at: input.renewsAt ?? null,
  });
  if (error) throw new Error(`Falha ao aplicar revisão financeira Stripe: ${clean(error.message, 700)}`);

  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  if (result.applied === true) return result;

  const safeIgnored = new Set([
    'duplicate',
    'stale_event',
    'same_timestamp_lower_or_equal_priority',
    'terminal_cancelled',
  ]);
  const reason = clean(result.reason, 120);
  if (safeIgnored.has(reason)) return result;
  throw new Error(`Evento Stripe não pôde ser associado ao contrato: ${reason || 'estado desconhecido'}`);
}

async function auditEmailFailure(admin: any, sale: any, reason: string, action = 'NEXUS_ONBOARDING_EMAIL_FAILED') {
  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action,
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, provider: 'brevo', reason: clean(reason, 700) },
  });
}

async function sendFirstAccessEmail(admin: any, sale: any, plan: any) {
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!brevoKey || !fromEmail || !sale?.email) {
    await auditEmailFailure(admin, sale, 'BREVO_API_KEY, BREVO_FROM_EMAIL ou e-mail do cliente ausente.');
    return false;
  }

  const { data: previous } = await admin.from('audit_logs')
    .select('id')
    .eq('action', 'NEXUS_ONBOARDING_EMAIL_SENT')
    .eq('entity', 'nexus_sales')
    .eq('entity_id', sale.id)
    .limit(1)
    .maybeSingle();
  if (previous?.id) return true;

  const publicUrl = (clean(sale.return_origin, 500) || Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexus-core.jefersonciechanowski.workers.dev').replace(/\/$/, '');
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email: sale.email });
  const tokenHash = clean(linkData?.properties?.hashed_token, 1000);
  const firstAccessLink = tokenHash ? `${publicUrl}/apps/portal-cliente/redefinir-senha.html?token_hash=${encodeURIComponent(tokenHash)}&type=recovery` : '';
  if (linkError || !firstAccessLink) {
    await auditEmailFailure(admin, sale, linkError?.message || 'Supabase não gerou o token de primeiro acesso.');
    return false;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu acesso ao Nexus SST está pronto</h2>
      <p>Olá, ${escapeHtml(sale.responsible_name)}.</p>
      <p>O pagamento da <strong>${escapeHtml(sale.company_name)}</strong> foi confirmado e o acesso ao <strong>${escapeHtml(plan?.name || 'Nexus SST')}</strong> já foi liberado.</p>
      <p>Defina sua senha pessoal para entrar na Minha Central Nexus.</p>
      <p style="margin:28px 0"><a href="${firstAccessLink}" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Definir minha senha</a></p>
      <p style="font-size:13px;color:#68757b">Depois da definição de senha, acesse: ${publicUrl}/apps/portal-cliente/</p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core · acesso criado automaticamente após confirmação financeira da Stripe.</p>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': brevoKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: sale.email, name: clean(sale.responsible_name, 140) || undefined }],
      subject: 'Seu acesso ao Nexus SST está pronto',
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    await auditEmailFailure(admin, sale, `Brevo ${response.status}: ${clean(await response.text(), 500)}`);
    return false;
  }

  let messageId: string | null = null;
  try { messageId = clean((await response.json())?.messageId, 255) || null; } catch { /* resposta sem JSON */ }

  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_ONBOARDING_EMAIL_SENT',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, plan_id: sale.plan_id, provider: 'brevo', billing_provider: 'stripe', message_id: messageId },
  });
  return true;
}

async function sendPilotConversionEmail(admin: any, sale: any, plan: any) {
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!brevoKey || !fromEmail || !sale?.email) {
    await auditEmailFailure(admin, sale, 'BREVO_API_KEY, BREVO_FROM_EMAIL ou e-mail do cliente ausente.', 'NEXUS_PILOT_CONVERSION_EMAIL_FAILED');
    return false;
  }

  const { data: previous } = await admin.from('audit_logs')
    .select('id')
    .eq('action', 'NEXUS_PILOT_CONVERSION_EMAIL_SENT')
    .eq('entity', 'nexus_sales')
    .eq('entity_id', sale.id)
    .limit(1)
    .maybeSingle();
  if (previous?.id) return true;

  const publicUrl = (clean(sale.return_origin, 500) || Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexus-core.jefersonciechanowski.workers.dev').replace(/\/$/, '');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu piloto foi convertido em plano pago</h2>
      <p>Olá, ${escapeHtml(sale.responsible_name)}.</p>
      <p>O pagamento da <strong>${escapeHtml(sale.company_name)}</strong> foi confirmado e o plano <strong>${escapeHtml(plan?.name || 'Nexus SST')}</strong> já está ativo.</p>
      <p>Sua empresa, usuários e todos os registros do período piloto foram preservados. Você continua usando a mesma senha e o mesmo acesso.</p>
      <p style="margin:28px 0"><a href="${publicUrl}/apps/portal-cliente/" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Acessar Minha Central</a></p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core · conversão confirmada automaticamente pela Stripe.</p>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': brevoKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: sale.email, name: clean(sale.responsible_name, 140) || undefined }],
      subject: 'Seu plano Nexus SST está ativo',
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    await auditEmailFailure(admin, sale, `Brevo ${response.status}: ${clean(await response.text(), 500)}`, 'NEXUS_PILOT_CONVERSION_EMAIL_FAILED');
    return false;
  }

  let messageId: string | null = null;
  try { messageId = clean((await response.json())?.messageId, 255) || null; } catch { /* resposta sem JSON */ }
  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_PILOT_CONVERSION_EMAIL_SENT',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, plan_id: sale.plan_id, provider: 'brevo', billing_provider: 'stripe', message_id: messageId },
  });
  return true;
}

async function provisionSale(admin: any, saleInput: any, context: { customerId?: string | null; subscriptionId?: string | null; renewsAt?: string | null; eventType?: string | null } = {}) {
  // Stripe legacy path is behavior-preserving. All provider-specific values
  // remain exactly 'stripe' in the shared module through this trusted argument.
  return provisionSaleForProvider(admin, saleInput, context, {
    provider: 'stripe',
    clean,
    slugify,
    addMonthsDate,
    sendFirstAccessEmail,
    sendPilotConversionEmail,
  });
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !webhookSecret) return json({ error: 'Webhook Stripe não configurado.' }, 503);

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Assinatura Stripe ausente.' }, 400);

  const rawBody = await request.text();
  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return json({ error: 'Assinatura Stripe inválida.' }, 400);
  }
  if (event.livemode && !livePaymentsEnabled()) {
    return json({ error: 'Processamento de pagamentos reais ainda não está habilitado.' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const eventId = clean(event.id, 255);
  const eventType = clean(event.type, 120);
  const eventCreatedAt = Number(event.created) > 0
    ? new Date(Number(event.created) * 1000).toISOString()
    : new Date().toISOString();
  const resource: any = event.data?.object || {};
  const resourceId = clean(resource?.id, 255) || null;

  const { data: previous } = await admin.from('nexus_payment_webhook_events').select('processed_at').eq('provider_event_id', eventId).maybeSingle();
  if (previous?.processed_at) return json({ ok: true, duplicate: true });
  if (!previous) {
    const { error: insertEventError } = await admin.from('nexus_payment_webhook_events').insert({ provider_event_id: eventId, provider: 'stripe', event_type: eventType, resource_id: resourceId, payload: event as any });
    if (insertEventError && insertEventError.code !== '23505') return json({ error: 'Não foi possível registrar o evento.' }, 500);
  }

  try {
    if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.expired') {
      const session: any = resource;
      const checkoutId = clean(session.id, 255);
      const customerId = clean(session.customer, 255) || null;
      const subscriptionId = clean(session.subscription, 255) || null;
      const saleId = clean(session.metadata?.nexus_sale_id, 80) || null;
      const accessId = clean(session.metadata?.nexus_access_id, 80) || null;
      const internalCheckoutId = clean(session.metadata?.nexus_checkout_id, 80) || null;
      const expired = eventType === 'checkout.session.expired';
      const paid = !expired && session.payment_status === 'paid';
      let renewsAt: string | null = null;

      if (subscriptionId && !expired) {
        try { renewsAt = subscriptionPeriodEnd(await stripe.subscriptions.retrieve(subscriptionId)); } catch { /* reconciliado pelos próximos eventos */ }
      }

      if (internalCheckoutId || checkoutId) {
        let query = admin.from('nexus_payment_checkouts').update({
          provider_checkout_id: checkoutId,
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId || undefined,
          provider_checkout_url: clean(session.url, 1000) || undefined,
          status: expired ? 'expired' : paid ? 'paid' : 'active',
          completed_at: paid ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        });
        query = internalCheckoutId ? query.eq('id', internalCheckoutId) : query.eq('provider', 'stripe').eq('provider_checkout_id', checkoutId);
        await query;
      }

      if (saleId) {
        const sale = await findSale(admin, { saleId, checkoutId, subscriptionId, customerId });
        if (sale?.id) {
          const patch: Record<string, unknown> = { provider_checkout_id: checkoutId, provider_customer_id: customerId || undefined, provider_subscription_id: subscriptionId || undefined, provider_checkout_url: clean(session.url, 1000) || undefined, last_error: null };
          if (expired) patch.sale_status = 'expired';
          else if (paid) { patch.sale_status = 'paid'; patch.paid_at = new Date().toISOString(); }
          await admin.from('nexus_sales').update(patch).eq('id', sale.id);
          if (paid) {
            const provisioned = await provisionSale(admin, { ...sale, ...patch }, { customerId, subscriptionId, renewsAt, eventType });
            if (provisioned.error) throw new Error(provisioned.error);
          }
        }
      } else if (accessId && paid) {
        const access = await findAccess(admin, { accessId, subscriptionId, customerId });
        if (access?.id) {
          const state = await applyStripeContractState(admin, {
            accessId: access.id,
            eventId,
            eventCreatedAt,
            eventType,
            subscriptionStatus: 'active',
            accessStatus: 'active',
            customerId,
            subscriptionId,
            lastPaymentStatus: eventType,
            lastPaymentAt: new Date().toISOString(),
            renewsAt,
          });
          await syncCrmAccessOrThrow(
            admin,
            access.id,
            'a ativação após o checkout',
            undefined,
            eventCreatedAt,
            state.applied === true,
          );
        }
      }
    }

    if (eventType === 'checkout.session.async_payment_succeeded' || eventType === 'checkout.session.async_payment_failed') {
      const session: any = resource;
      const checkoutId = clean(session.id, 255);
      const customerId = clean(session.customer, 255) || null;
      const subscriptionId = clean(session.subscription, 255) || null;
      const saleId = clean(session.metadata?.nexus_sale_id, 80) || null;
      const accessId = clean(session.metadata?.nexus_access_id, 80) || null;
      const internalCheckoutId = clean(session.metadata?.nexus_checkout_id, 80) || null;
      const succeeded = eventType === 'checkout.session.async_payment_succeeded';

      if (internalCheckoutId || checkoutId) {
        let query = admin.from('nexus_payment_checkouts').update({
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId || undefined,
          status: succeeded ? 'paid' : 'failed',
          completed_at: succeeded ? new Date().toISOString() : null,
          error_message: succeeded ? null : 'Pagamento por boleto não confirmado antes do vencimento.',
          updated_at: new Date().toISOString(),
        });
        query = internalCheckoutId ? query.eq('id', internalCheckoutId) : query.eq('provider', 'stripe').eq('provider_checkout_id', checkoutId);
        await query;
      }

      if (saleId) {
        let sale = await findSale(admin, { saleId, checkoutId, subscriptionId, customerId });
        if (sale?.id) {
          if (!succeeded) {
            await admin.from('nexus_sales').update({ sale_status: 'expired', last_error: 'Boleto vencido ou pagamento não concluído.' }).eq('id', sale.id);
          } else {
            const salePatch: Record<string, unknown> = { sale_status: 'paid', paid_at: new Date().toISOString(), provider_customer_id: customerId || undefined, provider_subscription_id: subscriptionId || undefined, last_error: null };
            await admin.from('nexus_sales').update(salePatch).eq('id', sale.id);
            sale = { ...sale, ...salePatch };
            let renewsAt: string | null = null;
            if (sale.billing_mode === 'prepaid') renewsAt = addMonthsDate(Number(sale.billing_cycle_months || 12));
            else if (subscriptionId) {
              try { renewsAt = subscriptionPeriodEnd(await stripe.subscriptions.retrieve(subscriptionId)); } catch { /* invoice/subscription event reconciles later */ }
            }
            const provisioned = await provisionSale(admin, sale, { customerId, subscriptionId, renewsAt, eventType });
            if (provisioned.error) throw new Error(provisioned.error);
            if (sale.billing_mode === 'prepaid' && provisioned.access?.id) {
              const eventTime = new Date().toISOString();
              const providerPaymentId = clean(session.payment_intent || session.id, 255);
              const { data: checkoutRow } = await admin.from('nexus_payment_checkouts').select('id').eq('provider', 'stripe').eq('provider_checkout_id', checkoutId).maybeSingle();
              await admin.from('nexus_payments').upsert({
                organization_id: provisioned.access.organization_id,
                access_id: provisioned.access.id,
                checkout_id: checkoutRow?.id || null,
                provider: 'stripe',
                provider_payment_id: providerPaymentId,
                provider_subscription_id: null,
                provider_customer_id: customerId,
                billing_type: 'boleto',
                provider_status: 'paid',
                amount_cents: Number(session.amount_total || sale.checkout_amount_cents || 0),
                net_amount_cents: null,
                currency: String(session.currency || 'brl').toUpperCase(),
                due_date: null,
                confirmed_at: eventTime,
                received_at: eventTime,
                external_reference: sale.external_reference || null,
                invoice_url: null,
                updated_at: eventTime,
              }, { onConflict: 'provider_payment_id' });
            }
          }
        }
      } else if (accessId) {
        const access = await findAccess(admin, { accessId, subscriptionId, customerId });
        if (access?.id) {
          const state = await applyStripeContractState(admin, {
            accessId: access.id,
            eventId,
            eventCreatedAt,
            eventType,
            subscriptionStatus: succeeded ? 'active' : 'past_due',
            accessStatus: succeeded ? 'active' : 'suspended',
            customerId,
            subscriptionId,
            lastPaymentStatus: eventType,
            lastPaymentAt: succeeded ? new Date().toISOString() : null,
          });
          await syncCrmAccessOrThrow(
            admin,
            access.id,
            succeeded ? 'a reativação após o pagamento' : 'a suspensão por falha de pagamento',
            undefined,
            eventCreatedAt,
            state.applied === true,
          );
        }
      }
    }

    if (eventType === 'charge.refunded' || eventType === 'refund.updated' || eventType === 'charge.dispute.created' || eventType === 'charge.dispute.closed') {
      let charge: any = resource;
      let refund: any = null;
      let dispute: any = null;

      if (eventType === 'refund.updated') {
        refund = resource;
        const chargeId = clean(refund.charge, 255);
        if (!chargeId) throw new Error('Reembolso Stripe sem charge associada.');
        charge = await stripe.charges.retrieve(chargeId);
      } else if (eventType.startsWith('charge.dispute.')) {
        dispute = resource;
        const chargeId = clean(dispute.charge, 255);
        if (!chargeId) throw new Error('Disputa Stripe sem charge associada.');
        charge = await stripe.charges.retrieve(chargeId);
      }

      const resolved = await resolveFinancialAccess(admin, stripe, charge);
      const access = resolved.access;
      const fullRefund = Number(charge?.amount || 0) > 0
        && Number(charge?.amount_refunded || 0) >= Number(charge?.amount || 0);
      const partialRefund = Number(charge?.amount_refunded || 0) > 0 && !fullRefund;

      await updatePaymentFinancialStatus(
        admin,
        resolved.paymentCandidates,
        dispute
          ? `dispute_${clean(dispute.status, 60) || 'updated'}`
          : fullRefund
          ? 'refunded'
          : partialRefund
          ? 'partially_refunded'
          : clean(refund?.status || eventType, 120),
      );

      if (access?.id) {
        let nextSubscriptionStatus: 'active' | 'trial' | 'past_due' | 'cancelled' | null = null;
        let nextAccessStatus: 'active' | 'suspended' | null = null;

        if ((eventType === 'charge.refunded' || eventType === 'refund.updated') && fullRefund) {
          nextSubscriptionStatus = 'past_due';
          nextAccessStatus = 'suspended';
        }

        if (eventType === 'charge.dispute.created') {
          nextSubscriptionStatus = 'past_due';
          nextAccessStatus = 'suspended';
        }

        if (eventType === 'charge.dispute.closed') {
          const disputeStatus = clean(dispute?.status, 60).toLowerCase();
          if (disputeStatus === 'won') {
            if (resolved.subscriptionId) {
              const subscription: any = await stripe.subscriptions.retrieve(resolved.subscriptionId);
              const mapped = mapSubscriptionStatus(subscription.status);
              if (!mapped) throw new Error(`Status Stripe não reconhecido após disputa: ${clean(subscription.status, 80)}`);
              nextSubscriptionStatus = mapped;
              nextAccessStatus = mapped === 'active' || mapped === 'trial' ? 'active' : 'suspended';
            } else {
              nextSubscriptionStatus = 'active';
              nextAccessStatus = 'active';
            }
          } else {
            nextSubscriptionStatus = 'past_due';
            nextAccessStatus = 'suspended';
          }
        }

        if (nextSubscriptionStatus && nextAccessStatus) {
          const state = await applyStripeContractState(admin, {
            accessId: access.id,
            eventId,
            eventCreatedAt,
            eventType,
            subscriptionStatus: nextSubscriptionStatus,
            accessStatus: nextAccessStatus,
            customerId: resolved.customerId,
            subscriptionId: resolved.subscriptionId,
            lastPaymentStatus: eventType,
            lastPaymentAt: null,
          });

          await syncCrmAccessOrThrow(
            admin,
            access.id,
            nextAccessStatus === 'active'
              ? 'a reativação após resolução financeira'
              : 'a suspensão após reembolso/disputa',
            undefined,
            eventCreatedAt,
            state.applied === true,
          );
        }
      }
    }

    if (eventType === 'invoice.paid' || eventType === 'invoice.payment_failed') {
      const invoice: any = resource;
      const subscriptionId = invoiceSubscriptionId(invoice);
      const customerId = clean(invoice.customer, 255) || null;
      const saleId = invoiceSaleId(invoice);
      let renewsAt: string | null = null;
      if (subscriptionId) {
        try { renewsAt = subscriptionPeriodEnd(await stripe.subscriptions.retrieve(subscriptionId)); } catch { /* reconciliado pelo evento da assinatura */ }
      }

      let sale = await findSale(admin, { saleId, subscriptionId, customerId });
      let access = await findAccess(admin, { subscriptionId, customerId });
      const paid = eventType === 'invoice.paid';

      if (sale?.id) {
        const salePatch: Record<string, unknown> = { provider_customer_id: customerId || undefined, provider_subscription_id: subscriptionId || undefined };
        if (paid) { salePatch.sale_status = sale.sale_status === 'provisioned' ? 'provisioned' : 'paid'; salePatch.paid_at = sale.paid_at || new Date().toISOString(); }
        await admin.from('nexus_sales').update(salePatch).eq('id', sale.id);
        sale = { ...sale, ...salePatch };
        if (paid && !access?.id) {
          const provisioned = await provisionSale(admin, sale, { customerId, subscriptionId, renewsAt, eventType });
          if (provisioned.error) throw new Error(provisioned.error);
          access = provisioned.access;
        }
      }

      if (access?.id) {
        const eventTime = new Date().toISOString();
        const amount = Number(invoice.amount_paid ?? invoice.amount_due ?? invoice.total ?? 0);
        const dueDate = dateFromUnix(invoice.due_date);
        const methods = Array.isArray(invoice.payment_settings?.payment_method_types) ? invoice.payment_settings.payment_method_types : [];
        const billingType = methods.includes('boleto') ? 'boleto' : 'card';
        await admin.from('nexus_payments').upsert({
          organization_id: access.organization_id,
          access_id: access.id,
          provider: 'stripe',
          provider_payment_id: clean(invoice.id, 255),
          provider_subscription_id: subscriptionId,
          provider_customer_id: customerId,
          billing_type: billingType,
          provider_status: clean(invoice.status || eventType, 120),
          amount_cents: Math.max(0, amount),
          net_amount_cents: null,
          currency: String(invoice.currency || 'brl').toUpperCase(),
          due_date: dueDate,
          confirmed_at: paid ? eventTime : null,
          received_at: paid ? eventTime : null,
          external_reference: sale?.external_reference || null,
          invoice_url: clean(invoice.hosted_invoice_url, 1000) || null,
          updated_at: eventTime,
        }, { onConflict: 'provider_payment_id' });

        const state = await applyStripeContractState(admin, {
          accessId: access.id,
          eventId,
          eventCreatedAt,
          eventType,
          subscriptionStatus: paid ? 'active' : 'past_due',
          accessStatus: paid ? 'active' : 'suspended',
          customerId,
          subscriptionId,
          lastPaymentStatus: eventType,
          lastPaymentAt: paid ? eventTime : null,
          lastPaymentDueDate: dueDate,
          renewsAt,
        });
        await syncCrmAccessOrThrow(
          admin,
          access.id,
          paid ? 'a reativação após a fatura paga' : 'a suspensão após falha da fatura',
          undefined,
          eventCreatedAt,
          state.applied === true,
        );
      }
    }

    if (eventType.startsWith('customer.subscription.')) {
      const subscription: any = resource;
      const subscriptionId = clean(subscription.id, 255);
      const customerId = clean(subscription.customer, 255) || null;
      const saleId = clean(subscription.metadata?.nexus_sale_id, 80) || null;
      const accessId = clean(subscription.metadata?.nexus_access_id, 80) || null;
      const renewsAt = subscriptionPeriodEnd(subscription);
      const internalStatus = mapSubscriptionStatus(subscription.status);

      const sale = await findSale(admin, { saleId, subscriptionId, customerId });
      if (sale?.id) await admin.from('nexus_sales').update({ provider_customer_id: customerId || undefined, provider_subscription_id: subscriptionId }).eq('id', sale.id);

      const access = await findAccess(admin, { accessId, subscriptionId, customerId });
      if (access?.id) {
        if (!internalStatus) {
          throw new Error(`Status Stripe não reconhecido para a assinatura: ${clean(subscription.status, 80)}`);
        }
        const restrictiveStatus = internalStatus === 'cancelled'
          ? 'cancelled'
          : internalStatus === 'past_due'
          ? 'suspended'
          : null;

        const state = await applyStripeContractState(admin, {
          accessId: access.id,
          eventId,
          eventCreatedAt,
          eventType,
          subscriptionStatus: internalStatus,
          accessStatus: internalStatus === 'active' || internalStatus === 'trial' ? 'active' : 'suspended',
          customerId,
          subscriptionId,
          renewsAt,
        });
        await syncCrmAccessOrThrow(
          admin,
          access.id,
          restrictiveStatus === 'cancelled'
            ? 'o cancelamento da assinatura'
            : restrictiveStatus === 'suspended'
            ? 'a suspensão da assinatura'
            : 'a atualização da assinatura',
          undefined,
          eventCreatedAt,
          state.applied === true,
        );
      }
    }

    await admin.from('nexus_payment_webhook_events').update({ processed_at: new Date().toISOString(), error_message: null }).eq('provider_event_id', eventId);
    return json({ ok: true });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000);
    await admin.from('nexus_payment_webhook_events').update({ error_message: message }).eq('provider_event_id', eventId);
    return json({ error: 'Falha ao processar evento Stripe.' }, 500);
  }
});
