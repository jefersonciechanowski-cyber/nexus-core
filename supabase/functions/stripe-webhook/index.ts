import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@22.1.1';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);
const dateFromUnix = (value: unknown) => Number(value) > 0 ? new Date(Number(value) * 1000).toISOString().slice(0, 10) : null;

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

async function findSale(admin: any, criteria: { saleId?: string | null; checkoutId?: string | null; subscriptionId?: string | null; customerId?: string | null }) {
  if (criteria.saleId) {
    const { data } = await admin.from('nexus_sales').select('*').eq('id', criteria.saleId).eq('provider', 'stripe').maybeSingle();
    if (data) return data;
  }
  if (criteria.checkoutId) {
    const { data } = await admin.from('nexus_sales').select('*').eq('provider', 'stripe').eq('provider_checkout_id', criteria.checkoutId).maybeSingle();
    if (data) return data;
  }
  if (criteria.subscriptionId) {
    const { data } = await admin.from('nexus_sales').select('*').eq('provider', 'stripe').eq('provider_subscription_id', criteria.subscriptionId).maybeSingle();
    if (data) return data;
  }
  if (criteria.customerId) {
    const { data } = await admin.from('nexus_sales')
      .select('*')
      .eq('provider', 'stripe')
      .eq('provider_customer_id', criteria.customerId)
      .in('sale_status', ['checkout_created','paid','provisioned'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function findAccess(admin: any, criteria: { accessId?: string | null; subscriptionId?: string | null; customerId?: string | null }) {
  if (criteria.accessId) {
    const { data } = await admin.from('organization_product_access')
      .select('id,organization_id,product_id,plan_id,renews_at,contracted_price_cents,contracted_currency,plan:nexus_plans(id,name,billing_interval_months,status)')
      .eq('id', criteria.accessId)
      .maybeSingle();
    if (data) return data;
  }
  if (criteria.subscriptionId) {
    const { data } = await admin.from('organization_product_access')
      .select('id,organization_id,product_id,plan_id,renews_at,contracted_price_cents,contracted_currency,plan:nexus_plans(id,name,billing_interval_months,status)')
      .eq('billing_provider', 'stripe')
      .eq('provider_subscription_id', criteria.subscriptionId)
      .maybeSingle();
    if (data) return data;
  }
  if (criteria.customerId) {
    const { data } = await admin.from('organization_product_access')
      .select('id,organization_id,product_id,plan_id,renews_at,contracted_price_cents,contracted_currency,plan:nexus_plans(id,name,billing_interval_months,status)')
      .eq('billing_provider', 'stripe')
      .eq('provider_customer_id', criteria.customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  return null;
}

async function sendFirstAccessEmail(admin: any, sale: any, plan: any) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL');
  if (!resendKey || !fromEmail || !sale?.email) return false;

  const { data: previous } = await admin.from('audit_logs')
    .select('id')
    .eq('action', 'NEXUS_ONBOARDING_EMAIL_SENT')
    .eq('entity', 'nexus_sales')
    .eq('entity_id', sale.id)
    .limit(1)
    .maybeSingle();
  if (previous?.id) return true;

  const publicUrl = (clean(sale.return_origin, 500) || Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexus-core.jefersonciechanowski.workers.dev').replace(/\/$/, '');
  const redirectTo = `${publicUrl}/apps/portal-cliente/redefinir-senha.html`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: sale.email,
    options: { redirectTo },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) return false;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu acesso ao Nexus SST está pronto</h2>
      <p>Olá, ${escapeHtml(sale.responsible_name)}.</p>
      <p>O pagamento da <strong>${escapeHtml(sale.company_name)}</strong> foi confirmado e o acesso ao <strong>${escapeHtml(plan?.name || 'Nexus SST')}</strong> já foi liberado.</p>
      <p>Defina sua senha pessoal para entrar na Minha Central Nexus.</p>
      <p style="margin:28px 0"><a href="${actionLink}" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Definir minha senha</a></p>
      <p style="font-size:13px;color:#68757b">Depois da definição de senha, acesse: ${publicUrl}/apps/portal-cliente/</p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core Tecnologia LTDA · acesso criado automaticamente após confirmação financeira da Stripe.</p>
    </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [sale.email], subject: 'Seu acesso ao Nexus SST está pronto', html }),
  });
  if (!response.ok) return false;

  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_ONBOARDING_EMAIL_SENT',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, plan_id: sale.plan_id, provider: 'stripe' },
  });
  return true;
}

async function provisionSale(admin: any, saleInput: any, context: { customerId?: string | null; subscriptionId?: string | null; renewsAt?: string | null; eventType?: string | null } = {}) {
  let sale = saleInput;
  if (!sale?.id) return { access: null, error: 'Venda não encontrada.' };

  const providerPatch: Record<string, unknown> = {};
  if (context.customerId) providerPatch.provider_customer_id = context.customerId;
  if (context.subscriptionId) providerPatch.provider_subscription_id = context.subscriptionId;
  if (Object.keys(providerPatch).length) {
    await admin.from('nexus_sales').update(providerPatch).eq('id', sale.id);
    sale = { ...sale, ...providerPatch };
  }

  const { data: plan } = await admin.from('nexus_plans')
    .select('id,product_id,name,price_cents,currency,billing_interval_months,status')
    .eq('id', sale.plan_id)
    .maybeSingle();
  if (!plan?.id || plan.status !== 'active') {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Plano comercial não encontrado no provisionamento.' }).eq('id', sale.id);
    return { access: null, error: 'Plano inválido.' };
  }

  let userId = sale.user_id as string | null;
  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: sale.email,
      email_confirm: true,
      user_metadata: { full_name: sale.responsible_name },
    });

    if (createError || !created?.user?.id) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find((item: any) => String(item.email || '').toLowerCase() === String(sale.email || '').toLowerCase());
      if (!existing?.id) {
        await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Não foi possível criar o usuário responsável.' }).eq('id', sale.id);
        return { access: null, error: 'Usuário não criado.' };
      }
      userId = existing.id;
    } else {
      userId = created.user.id;
    }
    await admin.from('nexus_sales').update({ user_id: userId }).eq('id', sale.id);
    sale.user_id = userId;
  }

  let organizationId = sale.organization_id as string | null;
  if (!organizationId) {
    const { data: existingProfile } = await admin.from('profiles').select('organization_id').eq('id', userId).maybeSingle();
    if (existingProfile?.organization_id) {
      organizationId = existingProfile.organization_id;
    } else {
      const slug = `${slugify(sale.company_name)}-${String(sale.id).replace(/-/g, '').slice(0, 8)}`;
      const { data: organization, error: organizationError } = await admin.from('organizations').insert({
        name: sale.company_name,
        slug,
        status: 'active',
        legal_name: sale.company_name,
        trade_name: sale.company_name,
        registration_type: sale.registration_type,
        registration_number: sale.registration_number,
        email: sale.email,
        phone: sale.phone,
        postal_code: sale.postal_code,
        street: sale.street,
        street_number: sale.street_number,
        address_complement: sale.address_complement,
        district: sale.district,
        city: sale.city,
        state: sale.state,
        legal_responsible_name: sale.responsible_name,
      }).select('id').single();
      if (organizationError || !organization?.id) {
        await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Pagamento confirmado, mas a empresa não pôde ser criada automaticamente.' }).eq('id', sale.id);
        return { access: null, error: 'Empresa não criada.' };
      }
      organizationId = organization.id;
    }
    await admin.from('nexus_sales').update({ organization_id: organizationId }).eq('id', sale.id);
    sale.organization_id = organizationId;
  }

  const { data: profile } = await admin.from('profiles').select('organization_id').eq('id', userId).maybeSingle();
  if (profile?.organization_id && profile.organization_id !== organizationId) {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Usuário existente vinculado a outra empresa.' }).eq('id', sale.id);
    return { access: null, error: 'Perfil incompatível.' };
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: userId,
    organization_id: organizationId,
    full_name: sale.responsible_name,
    role: 'org_admin',
    active: true,
  }, { onConflict: 'id' });
  if (profileError) {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Empresa criada, mas o perfil de acesso não pôde ser concluído.' }).eq('id', sale.id);
    return { access: null, error: 'Perfil não criado.' };
  }

  let { data: access } = await admin.from('organization_product_access')
    .select('id,organization_id,plan_id,renews_at')
    .eq('organization_id', organizationId)
    .eq('product_id', plan.product_id)
    .maybeSingle();

  const accessPayload = {
    plan_id: plan.id,
    plan_name: plan.name,
    contracted_price_cents: plan.price_cents,
    contracted_currency: plan.currency || 'BRL',
    subscription_status: 'active',
    access_status: 'active',
    billing_provider: 'stripe',
    provider_customer_id: sale.provider_customer_id || context.customerId || null,
    provider_subscription_id: sale.provider_subscription_id || context.subscriptionId || null,
    last_payment_status: context.eventType || 'checkout.session.completed',
    last_payment_at: new Date().toISOString(),
    renews_at: context.renewsAt || null,
    updated_at: new Date().toISOString(),
  };

  if (!access?.id) {
    const { data: createdAccess, error: accessError } = await admin.from('organization_product_access').insert({
      organization_id: organizationId,
      product_id: plan.product_id,
      starts_at: new Date().toISOString().slice(0, 10),
      ...accessPayload,
    }).select('id,organization_id,plan_id,renews_at').single();
    if (accessError || !createdAccess?.id) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Empresa e usuário criados, mas o produto não pôde ser liberado.' }).eq('id', sale.id);
      return { access: null, error: 'Acesso não criado.' };
    }
    access = createdAccess;
  } else {
    const updatePayload: Record<string, unknown> = { ...accessPayload };
    if (!context.renewsAt) delete updatePayload.renews_at;
    await admin.from('organization_product_access').update(updatePayload).eq('id', access.id);
  }

  if (sale.provider_checkout_id) {
    const { data: existingCheckout } = await admin.from('nexus_payment_checkouts')
      .select('id')
      .eq('provider', 'stripe')
      .eq('provider_checkout_id', sale.provider_checkout_id)
      .maybeSingle();
    if (!existingCheckout?.id) {
      await admin.from('nexus_payment_checkouts').insert({
        organization_id: organizationId,
        access_id: access.id,
        plan_id: plan.id,
        provider: 'stripe',
        environment: sale.environment || 'sandbox',
        external_reference: sale.external_reference || `nexus-sale-${sale.id}`,
        provider_checkout_id: sale.provider_checkout_id,
        provider_checkout_url: sale.provider_checkout_url,
        provider_customer_id: sale.provider_customer_id || context.customerId || null,
        provider_subscription_id: sale.provider_subscription_id || context.subscriptionId || null,
        status: 'paid',
        amount_cents: plan.price_cents,
        currency: plan.currency || 'BRL',
        billing_interval_months: plan.billing_interval_months,
        completed_at: new Date().toISOString(),
      });
    }
  }

  const provisionedAt = new Date().toISOString();
  await admin.from('nexus_sales').update({
    sale_status: 'provisioned',
    organization_id: organizationId,
    user_id: userId,
    provider_customer_id: sale.provider_customer_id || context.customerId || null,
    provider_subscription_id: sale.provider_subscription_id || context.subscriptionId || null,
    paid_at: sale.paid_at || provisionedAt,
    provisioned_at: sale.provisioned_at || provisionedAt,
    last_error: null,
  }).eq('id', sale.id);

  sale.organization_id = organizationId;
  sale.user_id = userId;
  await admin.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: userId,
    action: 'NEXUS_SALE_PROVISIONED',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { plan_id: plan.id, product_id: plan.product_id, provider: 'stripe' },
  });

  await sendFirstAccessEmail(admin, sale, plan);
  return { access, error: null };
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

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const eventId = clean(event.id, 255);
  const eventType = clean(event.type, 120);
  const resource: any = event.data?.object || {};
  const resourceId = clean(resource?.id, 255) || null;

  const { data: previous } = await admin.from('nexus_payment_webhook_events').select('processed_at').eq('provider_event_id', eventId).maybeSingle();
  if (previous?.processed_at) return json({ ok: true, duplicate: true });
  if (!previous) {
    const { error: insertEventError } = await admin.from('nexus_payment_webhook_events').insert({
      provider_event_id: eventId,
      provider: 'stripe',
      event_type: eventType,
      resource_id: resourceId,
      payload: event as any,
    });
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
      let renewsAt: string | null = null;

      if (subscriptionId && !expired) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          renewsAt = subscriptionPeriodEnd(subscription);
        } catch { /* invoice/subscription webhooks will reconcile later */ }
      }

      if (internalCheckoutId || checkoutId) {
        let query = admin.from('nexus_payment_checkouts').update({
          provider_checkout_id: checkoutId,
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId || undefined,
          provider_checkout_url: clean(session.url, 1000) || undefined,
          status: expired ? 'expired' : 'paid',
          completed_at: expired ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        query = internalCheckoutId ? query.eq('id', internalCheckoutId) : query.eq('provider', 'stripe').eq('provider_checkout_id', checkoutId);
        await query;
      }

      if (saleId) {
        const sale = await findSale(admin, { saleId, checkoutId, subscriptionId, customerId });
        if (sale?.id) {
          const patch: Record<string, unknown> = {
            provider_checkout_id: checkoutId,
            provider_customer_id: customerId || undefined,
            provider_subscription_id: subscriptionId || undefined,
            provider_checkout_url: clean(session.url, 1000) || undefined,
            last_error: null,
          };
          if (expired) patch.sale_status = 'expired';
          else if (session.payment_status === 'paid') {
            patch.sale_status = 'paid';
            patch.paid_at = new Date().toISOString();
          }
          await admin.from('nexus_sales').update(patch).eq('id', sale.id);
          if (!expired && session.payment_status === 'paid') {
            await provisionSale(admin, { ...sale, ...patch }, { customerId, subscriptionId, renewsAt, eventType });
          }
        }
      } else if (accessId && !expired) {
        const access = await findAccess(admin, { accessId, subscriptionId, customerId });
        if (access?.id && session.payment_status === 'paid') {
          await admin.from('organization_product_access').update({
            billing_provider: 'stripe',
            provider_customer_id: customerId,
            provider_subscription_id: subscriptionId,
            subscription_status: 'active',
            access_status: 'active',
            last_payment_status: eventType,
            last_payment_at: new Date().toISOString(),
            renews_at: renewsAt || undefined,
            updated_at: new Date().toISOString(),
          }).eq('id', access.id);
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
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          renewsAt = subscriptionPeriodEnd(subscription);
        } catch { /* subscription event can reconcile renewal later */ }
      }

      let sale = await findSale(admin, { saleId, subscriptionId, customerId });
      let access = await findAccess(admin, { subscriptionId, customerId });
      const paid = eventType === 'invoice.paid';

      if (sale?.id) {
        const salePatch: Record<string, unknown> = {
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId || undefined,
        };
        if (paid) {
          salePatch.sale_status = sale.sale_status === 'provisioned' ? 'provisioned' : 'paid';
          salePatch.paid_at = sale.paid_at || new Date().toISOString();
        }
        await admin.from('nexus_sales').update(salePatch).eq('id', sale.id);
        sale = { ...sale, ...salePatch };
        if (paid && !access?.id) {
          const provisioned = await provisionSale(admin, sale, { customerId, subscriptionId, renewsAt, eventType });
          access = provisioned.access;
        }
      }

      if (access?.id) {
        const eventTime = new Date().toISOString();
        const amount = Number(invoice.amount_paid ?? invoice.amount_due ?? invoice.total ?? 0);
        const dueDate = dateFromUnix(invoice.due_date);
        await admin.from('nexus_payments').upsert({
          organization_id: access.organization_id,
          access_id: access.id,
          provider: 'stripe',
          provider_payment_id: clean(invoice.id, 255),
          provider_subscription_id: subscriptionId,
          provider_customer_id: customerId,
          billing_type: 'card',
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

        await admin.from('organization_product_access').update({
          billing_provider: 'stripe',
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId || undefined,
          subscription_status: paid ? 'active' : 'past_due',
          access_status: paid ? 'active' : undefined,
          last_payment_status: eventType,
          last_payment_due_date: dueDate,
          last_payment_at: paid ? eventTime : undefined,
          renews_at: renewsAt || undefined,
          updated_at: eventTime,
        }).eq('id', access.id);
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
      if (sale?.id) {
        await admin.from('nexus_sales').update({
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId,
        }).eq('id', sale.id);
      }

      const access = await findAccess(admin, { accessId, subscriptionId, customerId });
      if (access?.id) {
        const patch: Record<string, unknown> = {
          billing_provider: 'stripe',
          provider_customer_id: customerId || undefined,
          provider_subscription_id: subscriptionId,
          renews_at: renewsAt || undefined,
          updated_at: new Date().toISOString(),
        };
        if (internalStatus) patch.subscription_status = internalStatus;
        if (internalStatus === 'cancelled') patch.access_status = 'suspended';
        await admin.from('organization_product_access').update(patch).eq('id', access.id);
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
