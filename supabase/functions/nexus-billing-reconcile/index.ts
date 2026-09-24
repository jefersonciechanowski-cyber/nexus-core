import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';
import { syncCrmEntitlement } from '../stripe-webhook/crm-provisioning.ts';

const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function mapSubscriptionStatus(value: unknown) {
  const status = clean(value, 50).toLowerCase();
  if (status === 'active') return 'active';
  if (status === 'trialing') return 'trial';
  if (status === 'canceled') return 'cancelled';
  if (['past_due','unpaid','incomplete','incomplete_expired','paused'].includes(status)) return 'past_due';
  return null;
}

function subscriptionPeriodEnd(subscription: any) {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const values = items.map((item: any) => Number(item?.current_period_end || 0)).filter((value: number) => value > 0);
  const unix = values.length ? Math.min(...values) : Number(subscription?.current_period_end || 0);
  return unix > 0 ? new Date(unix * 1000).toISOString().slice(0, 10) : null;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), 5000);
  const stripeKey = clean(Deno.env.get('STRIPE_SECRET_KEY'), 5000);
  const authorization = clean(request.headers.get('authorization'), 6000);
  const bearer = authorization.replace(/^Bearer\s+/i, '');

  if (!supabaseUrl || serviceRoleKey.length < 32 || stripeKey.length < 32) {
    return json({ error: 'Reconciliação financeira não configurada.' }, 503);
  }
  if (!bearer || !safeEqual(bearer, serviceRoleKey)) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const summary = {
    prepaid_expired: 0,
    subscriptions_checked: 0,
    subscription_states_changed: 0,
    crm_pending_retried: 0,
    crm_pending_confirmed: 0,
    errors: [] as Array<{ access_id?: string; error: string }>,
  };

  const { data: prepaid, error: prepaidError } = await admin
    .from('organization_product_access')
    .select('id,subscription_status,access_status,renews_at')
    .eq('billing_provider', 'stripe')
    .eq('billing_mode', 'prepaid')
    .neq('subscription_status', 'cancelled')
    .lt('renews_at', today)
    .limit(200);

  if (prepaidError) {
    summary.errors.push({ error: `Falha ao carregar contratos pré-pagos: ${clean(prepaidError.message, 500)}` });
  } else {
    for (const access of prepaid || []) {
      try {
        const eventId = `reconcile:prepaid-expired:${access.id}:${access.renews_at || today}`;
        const { data: state, error } = await admin.rpc('apply_stripe_contract_state', {
          p_access_id: access.id,
          p_event_id: eventId,
          p_event_created_at: nowIso,
          p_event_type: 'reconcile.prepaid_expired',
          p_subscription_status: 'past_due',
          p_access_status: 'suspended',
          p_provider_customer_id: null,
          p_provider_subscription_id: null,
          p_last_payment_status: 'reconcile.prepaid_expired',
          p_last_payment_at: null,
          p_last_payment_due_date: access.renews_at || null,
          p_renews_at: access.renews_at || null,
        });
        if (error) throw error;
        const result = state && typeof state === 'object' ? state as Record<string, unknown> : {};
        if (result.applied === true) summary.prepaid_expired += 1;
        const crm = await syncCrmEntitlement(admin, access.id, undefined, nowIso, result.applied === true);
        if (crm.isCrm && !crm.synced) throw new Error(crm.error || 'CRM não confirmou expiração pré-paga.');
      } catch (error) {
        summary.errors.push({ access_id: access.id, error: clean((error as any)?.message, 700) });
      }
    }
  }

  const { data: recurring, error: recurringError } = await admin
    .from('organization_product_access')
    .select('id,provider_subscription_id,subscription_status,access_status,renews_at')
    .eq('billing_provider', 'stripe')
    .eq('billing_mode', 'recurring')
    .not('provider_subscription_id', 'is', null)
    .limit(200);

  if (recurringError) {
    summary.errors.push({ error: `Falha ao carregar assinaturas recorrentes: ${clean(recurringError.message, 500)}` });
  } else {
    for (const access of recurring || []) {
      try {
        const subscription: any = await stripe.subscriptions.retrieve(clean(access.provider_subscription_id, 255));
        summary.subscriptions_checked += 1;
        const mapped = mapSubscriptionStatus(subscription.status);
        if (!mapped) throw new Error(`Status Stripe desconhecido: ${clean(subscription.status, 80)}`);
        const nextAccessStatus = mapped === 'active' || mapped === 'trial' ? 'active' : 'suspended';
        const renewsAt = subscriptionPeriodEnd(subscription);
        const eventId = `reconcile:subscription:${subscription.id}:${mapped}:${renewsAt || 'none'}`;

        const { data: state, error } = await admin.rpc('apply_stripe_contract_state', {
          p_access_id: access.id,
          p_event_id: eventId,
          p_event_created_at: nowIso,
          p_event_type: 'reconcile.subscription',
          p_subscription_status: mapped,
          p_access_status: nextAccessStatus,
          p_provider_customer_id: clean(subscription.customer, 255) || null,
          p_provider_subscription_id: clean(subscription.id, 255),
          p_last_payment_status: 'reconcile.subscription',
          p_last_payment_at: null,
          p_last_payment_due_date: null,
          p_renews_at: renewsAt,
        });
        if (error) throw error;
        const result = state && typeof state === 'object' ? state as Record<string, unknown> : {};
        if (result.applied === true) summary.subscription_states_changed += 1;

        const crm = await syncCrmEntitlement(admin, access.id, undefined, nowIso, result.applied === true);
        if (crm.isCrm && !crm.synced) throw new Error(crm.error || 'CRM não confirmou reconciliação da assinatura.');
      } catch (error) {
        summary.errors.push({ access_id: access.id, error: clean((error as any)?.message, 700) });
      }
    }
  }

  const { data: pending, error: pendingError } = await admin
    .from('organization_product_access')
    .select('id,crm_sync_revision,crm_sync_confirmed_revision')
    .gt('crm_sync_revision', 0)
    .not('external_tenant_id', 'is', null)
    .limit(200);

  if (pendingError) {
    summary.errors.push({ error: `Falha ao carregar sincronizações CRM: ${clean(pendingError.message, 500)}` });
  } else {
    for (const access of pending || []) {
      if (Number(access.crm_sync_revision || 0) <= Number(access.crm_sync_confirmed_revision || 0)) continue;
      summary.crm_pending_retried += 1;
      try {
        const crm = await syncCrmEntitlement(admin, access.id, undefined, nowIso, false);
        if (!crm.synced) throw new Error(crm.error || 'CRM não confirmou revisão pendente.');
        summary.crm_pending_confirmed += 1;
      } catch (error) {
        summary.errors.push({ access_id: access.id, error: clean((error as any)?.message, 700) });
      }
    }
  }

  return json({
    ok: summary.errors.length === 0,
    reconciled_at: nowIso,
    ...summary,
  }, summary.errors.length === 0 ? 200 : 207);
});
