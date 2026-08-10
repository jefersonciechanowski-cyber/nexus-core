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

function slugify(value: unknown) {
  return clean(value, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'empresa';
}

function escapeHtml(value: unknown) {
  return clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function findSale(admin: any, criteria: { externalReference?: string | null; checkoutId?: string | null; subscriptionId?: string | null; customerId?: string | null }) {
  if (criteria.externalReference?.startsWith('nexus-sale-')) {
    const { data } = await admin.from('nexus_sales').select('*').eq('external_reference', criteria.externalReference).maybeSingle();
    if (data) return data;
  }
  if (criteria.checkoutId) {
    const { data } = await admin.from('nexus_sales').select('*').eq('asaas_checkout_id', criteria.checkoutId).maybeSingle();
    if (data) return data;
  }
  if (criteria.subscriptionId) {
    const { data } = await admin.from('nexus_sales').select('*').eq('asaas_subscription_id', criteria.subscriptionId).maybeSingle();
    if (data) return data;
  }
  if (criteria.customerId) {
    const { data } = await admin.from('nexus_sales')
      .select('*')
      .eq('asaas_customer_id', criteria.customerId)
      .in('sale_status', ['checkout_created', 'paid', 'provisioned'])
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

  const publicUrl = (clean(sale?.return_origin, 500) || Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexus-core.jefersonciechanowski.workers.dev').replace(/\/$/, '');
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
      <p style="font-size:12px;color:#7b858a">Nexus Core Tecnologia LTDA · acesso criado automaticamente após confirmação financeira do Asaas.</p>
    </div>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [sale.email],
      subject: 'Seu acesso ao Nexus SST está pronto',
      html,
    }),
  });
  if (!response.ok) return false;

  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_ONBOARDING_EMAIL_SENT',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, plan_id: sale.plan_id },
  });
  return true;
}

async function provisionSale(admin: any, saleInput: any, context: { customerId?: string | null; subscriptionId?: string | null; dueDate?: string | null; eventType?: string | null } = {}) {
  let sale = saleInput;
  if (!sale?.id) return { access: null, error: 'Venda não encontrada.' };

  if (context.customerId || context.subscriptionId) {
    const patch: Record<string, unknown> = {};
    if (context.customerId) patch.asaas_customer_id = context.customerId;
    if (context.subscriptionId) patch.asaas_subscription_id = context.subscriptionId;
    if (Object.keys(patch).length) {
      await admin.from('nexus_sales').update(patch).eq('id', sale.id);
      sale = { ...sale, ...patch };
    }
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
      const { data: existingProfile } = await admin.from('profiles').select('organization_id').eq('id', existing.id).maybeSingle();
      if (existingProfile?.organization_id && existingProfile.organization_id !== sale.organization_id) {
        await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'O e-mail já pertence a outra organização Nexus.' }).eq('id', sale.id);
        return { access: null, error: 'E-mail já vinculado.' };
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

  const nextRenewal = context.dueDate ? addMonths(context.dueDate, Number(plan.billing_interval_months || 1)) : null;
  let { data: access } = await admin.from('organization_product_access')
    .select('id,organization_id,plan_id,renews_at,plan:nexus_plans(billing_interval_months)')
    .eq('organization_id', organizationId)
    .eq('product_id', plan.product_id)
    .maybeSingle();

  if (!access?.id) {
    const { data: createdAccess, error: accessError } = await admin.from('organization_product_access').insert({
      organization_id: organizationId,
      product_id: plan.product_id,
      plan_id: plan.id,
      access_status: 'active',
      subscription_status: 'active',
      plan_name: plan.name,
      contracted_price_cents: plan.price_cents,
      contracted_currency: plan.currency || 'BRL',
      starts_at: new Date().toISOString().slice(0, 10),
      renews_at: nextRenewal,
      asaas_customer_id: sale.asaas_customer_id || context.customerId || null,
      asaas_subscription_id: sale.asaas_subscription_id || context.subscriptionId || null,
      last_payment_status: context.eventType || 'CHECKOUT_PAID',
      last_payment_due_date: context.dueDate || null,
      last_payment_at: new Date().toISOString(),
    }).select('id,organization_id,plan_id,renews_at,plan:nexus_plans(billing_interval_months)').single();
    if (accessError || !createdAccess?.id) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Empresa e usuário criados, mas o produto não pôde ser liberado.' }).eq('id', sale.id);
      return { access: null, error: 'Acesso não criado.' };
    }
    access = createdAccess;
  } else {
    await admin.from('organization_product_access').update({
      plan_id: plan.id,
      plan_name: plan.name,
      contracted_price_cents: plan.price_cents,
      contracted_currency: plan.currency || 'BRL',
      subscription_status: 'active',
      access_status: 'active',
      asaas_customer_id: sale.asaas_customer_id || context.customerId || undefined,
      asaas_subscription_id: sale.asaas_subscription_id || context.subscriptionId || undefined,
      last_payment_status: context.eventType || 'CHECKOUT_PAID',
      last_payment_due_date: context.dueDate || undefined,
      last_payment_at: new Date().toISOString(),
      renews_at: nextRenewal || undefined,
      updated_at: new Date().toISOString(),
    }).eq('id', access.id);
  }

  if (sale.asaas_checkout_id) {
    const { data: existingCheckout } = await admin.from('nexus_payment_checkouts').select('id').eq('provider_checkout_id', sale.asaas_checkout_id).maybeSingle();
    if (!existingCheckout?.id) {
      await admin.from('nexus_payment_checkouts').insert({
        organization_id: organizationId,
        access_id: access.id,
        plan_id: plan.id,
        provider: 'asaas',
        environment: sale.environment || 'sandbox',
        external_reference: sale.external_reference,
        provider_checkout_id: sale.asaas_checkout_id,
        provider_checkout_url: sale.asaas_checkout_url,
        provider_customer_id: sale.asaas_customer_id || context.customerId || null,
        provider_subscription_id: sale.asaas_subscription_id || context.subscriptionId || null,
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
    asaas_customer_id: sale.asaas_customer_id || context.customerId || undefined,
    asaas_subscription_id: sale.asaas_subscription_id || context.subscriptionId || undefined,
    paid_at: sale.paid_at || provisionedAt,
    provisioned_at: provisionedAt,
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
    metadata: { plan_id: plan.id, product_id: plan.product_id, provider: 'asaas' },
  });

  await sendFirstAccessEmail(admin, sale, plan);
  return { access, error: null };
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
      const checkoutId = clean(checkout.id, 255);
      const customerId = clean(checkout.customer, 255) || null;
      const externalReference = clean(checkout.externalReference, 255) || null;

      const { data: internalCheckout } = await admin
        .from('nexus_payment_checkouts')
        .select('id,access_id,organization_id')
        .eq('provider_checkout_id', checkoutId)
        .maybeSingle();

      if (internalCheckout) {
        await admin.from('nexus_payment_checkouts').update({
          status: checkoutStatus,
          provider_checkout_url: clean(checkout.link, 1000) || undefined,
          provider_customer_id: customerId || undefined,
          completed_at: checkoutStatus === 'paid' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq('id', internalCheckout.id);

        if (checkoutStatus === 'paid') {
          await admin.from('organization_product_access').update({
            subscription_status: 'active',
            access_status: 'active',
            asaas_customer_id: customerId,
            last_payment_status: eventType,
            last_payment_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', internalCheckout.access_id);
        }
      }

      const sale = await findSale(admin, { checkoutId, externalReference, customerId });
      if (sale?.id) {
        const saleUpdate: Record<string, unknown> = {
          asaas_checkout_id: checkoutId,
          asaas_customer_id: customerId || undefined,
          asaas_checkout_url: clean(checkout.link, 1000) || undefined,
          last_error: null,
        };
        if (checkoutStatus === 'paid') {
          saleUpdate.sale_status = 'paid';
          saleUpdate.paid_at = new Date().toISOString();
        } else if (checkoutStatus === 'canceled') saleUpdate.sale_status = 'canceled';
        else if (checkoutStatus === 'expired') saleUpdate.sale_status = 'expired';
        else if (sale.sale_status === 'lead') saleUpdate.sale_status = 'checkout_created';
        await admin.from('nexus_sales').update(saleUpdate).eq('id', sale.id);
        if (checkoutStatus === 'paid') {
          await provisionSale(admin, { ...sale, ...saleUpdate }, { customerId, eventType });
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

      const sale = await findSale(admin, { externalReference, subscriptionId, customerId });
      if (sale?.id) {
        await admin.from('nexus_sales').update({
          asaas_subscription_id: subscriptionId,
          asaas_customer_id: customerId || undefined,
        }).eq('id', sale.id);
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
      const dueDate = clean(payment.dueDate, 10) || null;
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

      if (!access) {
        const sale = await findSale(admin, { externalReference, subscriptionId, customerId });
        if (sale?.id) {
          const salePatch: Record<string, unknown> = {
            asaas_customer_id: customerId || undefined,
            asaas_subscription_id: subscriptionId || undefined,
          };
          if (paymentSuccessEvents.has(eventType)) {
            salePatch.sale_status = 'paid';
            salePatch.paid_at = new Date().toISOString();
          }
          await admin.from('nexus_sales').update(salePatch).eq('id', sale.id);
          if (paymentSuccessEvents.has(eventType)) {
            const provisioned = await provisionSale(admin, { ...sale, ...salePatch }, { customerId, subscriptionId, dueDate, eventType });
            access = provisioned.access;
          }
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
          due_date: dueDate,
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
          last_payment_due_date: dueDate,
          updated_at: eventTime,
        };

        if (paymentSuccessEvents.has(eventType)) {
          update.subscription_status = 'active';
          update.access_status = 'active';
          update.last_payment_at = eventTime;
          const plan = Array.isArray(access.plan) ? access.plan[0] : access.plan;
          const nextRenewal = addMonths(dueDate, Number(plan?.billing_interval_months || 0));
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