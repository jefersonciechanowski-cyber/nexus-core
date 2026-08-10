import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);
const paymentSuccessEvents = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const paymentPastDueEvents = new Set(['PAYMENT_OVERDUE', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED', 'PAYMENT_REPROVED_BY_RISK_ANALYSIS']);

function cents(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : 0;
}

function addMonths(dateValue: unknown, months: number) {
  const raw = clean(dateValue, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !months) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN');
  if (!supabaseUrl || !serviceRoleKey || !webhookToken) return json({ error: 'Webhook não configurado.' }, 500);

  const receivedToken = request.headers.get('asaas-access-token') || '';
  if (!receivedToken || receivedToken !== webhookToken) return json({ error: 'Token inválido.' }, 401);

  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido.' }, 400); }

  const eventId = clean(body.id, 255);
  const eventType = clean(body.event, 120);
  if (!eventId || !eventType) return json({ error: 'Evento sem identificador ou tipo.' }, 400);

  const checkout = body.checkout && typeof body.checkout === 'object' ? body.checkout : null;
  const subscription = body.subscription && typeof body.subscription === 'object' ? body.subscription : null;
  const payment = body.payment && typeof body.payment === 'object' ? body.payment : null;
  const resourceId = clean(checkout?.id || subscription?.id || payment?.id, 255) || null;
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: previous } = await admin.from('nexus_payment_webhook_events').select('processed_at').eq('provider_event_id', eventId).maybeSingle();
  if (previous?.processed_at) return json({ ok: true, duplicate: true });
  if (!previous) {
    const { error: insertEventError } = await admin.from('nexus_payment_webhook_events').insert({
      provider_event_id: eventId,
      provider: 'asaas',
      event_type: eventType,
      resource_id: resourceId,
      payload: body,
    });
    if (insertEventError && insertEventError.code !== '23505') return json({ error: 'Não foi possível registrar o evento.' }, 500);
  }

  try {
    if (eventType.startsWith('CHECKOUT_') && checkout?.id) {
      const checkoutStatus = eventType === 'CHECKOUT_PAID' ? 'paid'
        : eventType === 'CHECKOUT_CANCELED' ? 'canceled'
        : eventType === 'CHECKOUT_EXPIRED' ? 'expired'
        : 'active';
      const { data: internalCheckout } = await admin
        .from('nexus_payment_checkouts')
        .select('id,access_id,organization_id')
        .eq('provider_checkout_id', clean(checkout.id, 255))
        .maybeSingle();

      if (internalCheckout) {
        await admin.from('nexus_payment_checkouts').update({
          status: checkoutStatus,
          provider_checkout_url: clean(checkout.link, 1000) || undefined,
          provider_customer_id: clean(checkout.customer, 255) || undefined,
          completed_at: checkoutStatus === 'paid' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('id', internalCheckout.id);

        if (checkoutStatus === 'paid') {
          await admin.from('organization_product_access').update({
            subscription_status: 'active',
            access_status: 'active',
            asaas_customer_id: clean(checkout.customer, 255) || null,
            last_payment_status: eventType,
            last_payment_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', internalCheckout.access_id);
        }
      }
    }

    if (eventType.startsWith('SUBSCRIPTION_') && subscription?.id) {
      const subscriptionId = clean(subscription.id, 255);
      const customerId = clean(subscription.customer, 255) || null;
      const externalReference = clean(subscription.externalReference, 255) || null;
      let accessId: string | null = null;
      let checkoutId: string | null = null;

      const { data: directAccess } = await admin.from('organization_product_access').select('id').eq('asaas_subscription_id', subscriptionId).maybeSingle();
      if (directAccess?.id) accessId = directAccess.id;

      if (!accessId && externalReference) {
        const { data: byReference } = await admin.from('nexus_payment_checkouts').select('id,access_id').eq('external_reference', externalReference).maybeSingle();
        if (byReference) { accessId = byReference.access_id; checkoutId = byReference.id; }
      }

      if (!accessId && customerId) {
        const { data: byCustomer } = await admin.from('nexus_payment_checkouts')
          .select('id,access_id')
          .eq('provider_customer_id', customerId)
          .in('status', ['paid', 'active'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (byCustomer) { accessId = byCustomer.access_id; checkoutId = byCustomer.id; }
      }

      if (checkoutId) await admin.from('nexus_payment_checkouts').update({ provider_subscription_id: subscriptionId, updated_at: new Date().toISOString() }).eq('id', checkoutId);
      if (accessId) {
        const internalStatus = ['SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED'].includes(eventType) ? 'cancelled' : undefined;
        await admin.from('organization_product_access').update({
          asaas_subscription_id: subscriptionId,
          asaas_customer_id: customerId,
          renews_at: clean(subscription.nextDueDate, 10) || undefined,
          subscription_status: internalStatus,
          updated_at: new Date().toISOString(),
        }).eq('id', accessId);
      }
    }

    if (eventType.startsWith('PAYMENT_') && payment?.id) {
      const paymentId = clean(payment.id, 255);
      const subscriptionId = clean(payment.subscription, 255) || null;
      const customerId = clean(payment.customer, 255) || null;
      const externalReference = clean(payment.externalReference, 255) || null;
      let access: any = null;
      let checkoutRow: any = null;

      if (subscriptionId) {
        const { data } = await admin.from('organization_product_access')
          .select('id,organization_id,plan_id,renews_at,plan:nexus_plans(billing_interval_months)')
          .eq('asaas_subscription_id', subscriptionId)
          .maybeSingle();
        access = data;
      }

      if (!access && externalReference) {
        const { data } = await admin.from('nexus_payment_checkouts').select('id,access_id,organization_id').eq('external_reference', externalReference).maybeSingle();
        checkoutRow = data;
        if (data?.access_id) {
          const { data: linkedAccess } = await admin.from('organization_product_access')
            .select('id,organization_id,plan_id,renews_at,plan:nexus_plans(billing_interval_months)')
            .eq('id', data.access_id)
            .maybeSingle();
          access = linkedAccess;
        }
      }

      if (!access && customerId) {
        const { data } = await admin.from('nexus_payment_checkouts')
          .select('id,access_id,organization_id')
          .eq('provider_customer_id', customerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        checkoutRow = data;
        if (data?.access_id) {
          const { data: linkedAccess } = await admin.from('organization_product_access')
            .select('id,organization_id,plan_id,renews_at,plan:nexus_plans(billing_interval_months)')
            .eq('id', data.access_id)
            .maybeSingle();
          access = linkedAccess;
        }
      }

      if (access?.id) {
        if (!checkoutRow) {
          const { data } = await admin.from('nexus_payment_checkouts').select('id').eq('access_id', access.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
          checkoutRow = data;
        }

        const providerStatus = clean(payment.status || eventType, 120);
        const eventTime = new Date().toISOString();
        const paymentPayload = {
          organization_id: access.organization_id,
          access_id: access.id,
          checkout_id: checkoutRow?.id || null,
          provider: 'asaas',
          provider_payment_id: paymentId,
          provider_subscription_id: subscriptionId,
          provider_customer_id: customerId,
          billing_type: clean(payment.billingType, 80) || null,
          provider_status: providerStatus,
          amount_cents: cents(payment.value),
          net_amount_cents: payment.netValue === null || payment.netValue === undefined ? null : cents(payment.netValue),
          currency: 'BRL',
          due_date: clean(payment.dueDate, 10) || null,
          confirmed_at: eventType === 'PAYMENT_CONFIRMED' ? eventTime : null,
          received_at: eventType === 'PAYMENT_RECEIVED' ? eventTime : null,
          external_reference: externalReference,
          invoice_url: clean(payment.invoiceUrl || payment.bankSlipUrl, 1000) || null,
          updated_at: eventTime,
        };
        await admin.from('nexus_payments').upsert(paymentPayload, { onConflict: 'provider_payment_id' });

        const update: Record<string, unknown> = {
          asaas_subscription_id: subscriptionId || undefined,
          asaas_customer_id: customerId || undefined,
          last_payment_status: eventType,
          last_payment_due_date: clean(payment.dueDate, 10) || null,
          updated_at: eventTime,
        };

        if (paymentSuccessEvents.has(eventType)) {
          update.subscription_status = 'active';
          update.access_status = 'active';
          update.last_payment_at = eventTime;
          const plan = Array.isArray(access.plan) ? access.plan[0] : access.plan;
          const nextRenewal = addMonths(payment.dueDate, Number(plan?.billing_interval_months || 0));
          if (nextRenewal) update.renews_at = nextRenewal;
        } else if (paymentPastDueEvents.has(eventType)) {
          update.subscription_status = 'past_due';
        }
        await admin.from('organization_product_access').update(update).eq('id', access.id);
      }
    }

    await admin.from('nexus_payment_webhook_events').update({ processed_at: new Date().toISOString(), error_message: null }).eq('provider_event_id', eventId);
    return json({ ok: true });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 1000);
    await admin.from('nexus_payment_webhook_events').update({ error_message: message }).eq('provider_event_id', eventId);
    return json({ error: 'Falha ao processar evento.' }, 500);
  }
});
