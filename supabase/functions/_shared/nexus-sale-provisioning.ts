// Shared sale-to-access provisioning. Extracted byte-for-byte in structure from
// stripe-webhook/index.ts (26 Oct 2026) to reuse already-proven user/company,
// CRM tenant and entitlement safeguards with a trusted provider parameter.
// DO NOT CALL THIS DIRECTLY from a public endpoint or webhook payload.
// Only use after a durable, verified settlement and authorized orchestration.
import { provisionCrmTenant, sendCrmAccessEmail } from '../stripe-webhook/crm-provisioning.ts';

export async function provisionSaleForProvider(
  admin: any, saleInput: any,
  context: { customerId?: string | null; subscriptionId?: string | null; renewsAt?: string | null; eventType?: string | null } = {},
  deps: {
    provider: 'stripe' | 'asaas',
    clean: (value: unknown, size?: number) => string,
    slugify: (value: unknown) => string,
    addMonthsDate: (months: number) => string,
    sendFirstAccessEmail: (admin: any, sale: any, plan: any) => Promise<unknown>,
    sendPilotConversionEmail: (admin: any, sale: any, plan: any) => Promise<unknown>,
  },
) {
  const { provider, clean, slugify, addMonthsDate, sendFirstAccessEmail, sendPilotConversionEmail } = deps;
  if (provider !== 'stripe' && provider !== 'asaas') return { access: null, error: 'Provedor inválido.' };
  if (provider !== 'stripe') {
    // Asaas can only use the new sandbox path, and must not change an existing
    // courtesy or company merely because a payment has been generated.
    if (saleInput?.provider !== 'asaas' || saleInput?.environment !== 'sandbox'
      || saleInput?.source !== 'site-captacao' || saleInput?.billing_mode !== 'recurring'
      || saleInput?.billing_cycle_months !== 1 || saleInput?.sale_status !== 'paid'
      || !saleInput?.paid_at || !saleInput?.id || !context.subscriptionId) {
      return { access: null, error: 'Venda Asaas não elegível para provisionamento.' };
    }
    // Provisioning is forbidden until an independent atomic settlement step
    // advances an authenticated, provider-verified reservation to
    // "provision_ready" (not done by the public checkout or webhook inbox).
    const { data: reserved, error: reservedError } = await admin
      .from('nexus_crm_asaas_verified_payments')
      .select('sale_id,provider_subscription_id,decision')
      .eq('sale_id', saleInput.id)
      .eq('provider_subscription_id', context.subscriptionId)
      .eq('decision', 'provision_ready')
      .limit(1).maybeSingle();
    if (reservedError || !reserved?.sale_id) {
      return { access: null, error: 'Pagamento Asaas ainda não liberado pela conciliação.' };
    }
    const { data: linkedOrg, error: linkedOrgError } = await admin
      .from('organizations').select('id')
      .eq('registration_number', saleInput.registration_number).limit(1).maybeSingle();
    if (linkedOrgError || linkedOrg?.id) {
      return { access: null, error: 'Empresa já cadastrada; vinculação exige revisão manual.' };
    }
  }
  let sale = saleInput;
  if (!sale?.id) return { access: null, error: 'Venda não encontrada.' };

  const providerPatch: Record<string, unknown> = {};
  if (context.customerId) providerPatch.provider_customer_id = context.customerId;
  if (context.subscriptionId) providerPatch.provider_subscription_id = context.subscriptionId;
  if (Object.keys(providerPatch).length) {
    await admin.from('nexus_sales').update(providerPatch).eq('id', sale.id);
    sale = { ...sale, ...providerPatch };
  }

  const { data: plan } = await admin.from('nexus_plans').select('id,product_id,name,price_cents,currency,billing_interval_months,employee_limit,status').eq('id', sale.plan_id).maybeSingle();
  if (!plan?.id || plan.status !== 'active') {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Plano comercial não encontrado no provisionamento.' }).eq('id', sale.id);
    return { access: null, error: 'Plano inválido.' };
  }

  let userId = sale.user_id as string | null;
  if (userId) {
    const { data: userData } = await admin.auth.admin.getUserById(userId);
    const registeredEmail = clean(userData?.user?.email, 180).toLowerCase();
    if (!registeredEmail || registeredEmail !== clean(sale.email, 180).toLowerCase()) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'O usuário autenticado não corresponde ao e-mail da contratação.' }).eq('id', sale.id);
      return { access: null, error: 'Usuário incompatível.' };
    }
  }
  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email: sale.email, email_confirm: true, user_metadata: { full_name: sale.responsible_name } });
    if (createError || !created?.user?.id) {
      // Asaas public-site contracts are NEW companies only. An existing
      // authentication email must go through an independently authenticated
      // account-linking workflow, NEVER be adopted by an automated payment.
      if (provider === 'asaas') {
        await admin.from('nexus_sales').update({
          sale_status: 'manual_review',
          last_error: 'E-mail existente ou falha de criação de usuário no checkout Asaas.',
        }).eq('id', sale.id);
        return { access: null, error: 'E-mail já cadastrado; requer vinculação manual.' };
      }
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
  let pilotConversion = false;
  let pilotAccessId: string | null = null;
  const { data: existingProfile } = await admin.from('profiles').select('organization_id').eq('id', userId).maybeSingle();
  if (existingProfile?.organization_id) {
    const { data: existingOrg } = await admin.from('organizations').select('id,registration_number').eq('id', existingProfile.organization_id).maybeSingle();
    const { data: existingAccess } = await admin
      .from('organization_product_access')
      .select('id,plan_id,subscription_status,access_status,plan:nexus_plans(code,status)')
      .eq('organization_id', existingProfile.organization_id)
      .eq('product_id', plan.product_id)
      .maybeSingle();
    const existingPlan = Array.isArray(existingAccess?.plan) ? existingAccess.plan[0] : existingAccess?.plan;
    const trustedPilotSale = sale.source === 'portal-pilot-upgrade'
      && organizationId
      && organizationId === existingProfile.organization_id;
    const initialPilotAccess = existingAccess?.subscription_status === 'trial'
      && existingPlan?.code === 'piloto'
      && existingPlan?.status === 'active';
    const alreadyConvertedPilotAccess = existingAccess?.plan_id === plan.id
      && existingAccess?.subscription_status === 'active'
      && existingAccess?.access_status === 'active';
    pilotConversion = Boolean(trustedPilotSale && existingAccess?.id && (initialPilotAccess || alreadyConvertedPilotAccess));
    pilotAccessId = pilotConversion ? existingAccess.id : null;
    const registrationMatches = clean(existingOrg?.registration_number, 30) === clean(sale.registration_number, 30);
    if (!existingOrg?.id || (!registrationMatches && !pilotConversion)) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'O e-mail informado já pertence a outra organização Nexus.' }).eq('id', sale.id);
      return { access: null, error: 'E-mail já vinculado.' };
    }
    if (organizationId && organizationId !== existingOrg.id) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Usuário existente vinculado a outra empresa.' }).eq('id', sale.id);
      return { access: null, error: 'Perfil incompatível.' };
    }
    organizationId = existingOrg.id;
  }

  if (sale.organization_id && (!organizationId || sale.organization_id !== organizationId)) {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'A empresa autenticada não corresponde à empresa da contratação.' }).eq('id', sale.id);
    return { access: null, error: 'Empresa incompatível.' };
  }

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
  }

  if (pilotConversion) {
    const { count: activeEmployeeCount, error: employeeCountError } = await admin
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('active', true);
    if (employeeCountError || (plan.employee_limit && Number(activeEmployeeCount || 0) > Number(plan.employee_limit))) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: employeeCountError ? 'Não foi possível validar os colaboradores ativos do piloto.' : 'O piloto ultrapassou o limite de colaboradores do plano durante a confirmação.' }).eq('id', sale.id);
      return { access: null, error: 'Limite do plano exige revisão.' };
    }

    const { data: registrationConflict } = await admin
      .from('organizations')
      .select('id')
      .eq('registration_number', sale.registration_number)
      .neq('id', organizationId)
      .limit(1)
      .maybeSingle();
    if (registrationConflict?.id) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'O CPF/CNPJ informado já pertence a outra organização Nexus.' }).eq('id', sale.id);
      return { access: null, error: 'Documento já vinculado.' };
    }

    const { error: organizationUpdateError } = await admin.from('organizations').update({
      name: sale.company_name,
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
      updated_at: new Date().toISOString(),
    }).eq('id', organizationId);
    if (organizationUpdateError) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Pagamento confirmado, mas os dados cadastrais do piloto não puderam ser atualizados.' }).eq('id', sale.id);
      return { access: null, error: 'Empresa não atualizada.' };
    }
  }

  await admin.from('nexus_sales').update({ organization_id: organizationId }).eq('id', sale.id);
  sale.organization_id = organizationId;

  const { error: profileError } = await admin.from('profiles').upsert({ id: userId, organization_id: organizationId, full_name: sale.responsible_name, role: 'org_admin', active: true }, { onConflict: 'id' });
  if (profileError) {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Empresa criada, mas o perfil de acesso não pôde ser concluído.' }).eq('id', sale.id);
    return { access: null, error: 'Perfil não criado.' };
  }

  const billingMode = sale.billing_mode === 'prepaid' ? 'prepaid' : 'recurring';
  const billingCycleMonths = Math.max(1, Number(sale.billing_cycle_months || plan.billing_interval_months || 1));
  const contractedPrice = Math.max(0, Number(sale.checkout_amount_cents || plan.price_cents || 0));
  const renewsAt = context.renewsAt || (billingMode === 'prepaid' ? addMonthsDate(billingCycleMonths) : null);
  const planName = billingMode === 'prepaid' ? `${plan.name} · Anual à vista` : plan.name;

  let { data: access } = await admin.from('organization_product_access').select('id,organization_id,plan_id,renews_at').eq('organization_id', organizationId).eq('product_id', plan.product_id).maybeSingle();
  const accessPayload: Record<string, unknown> = {
    plan_id: plan.id,
    plan_name: planName,
    contracted_price_cents: contractedPrice,
    contracted_currency: plan.currency || 'BRL',
    billing_mode: billingMode,
    billing_cycle_months: billingCycleMonths,
    subscription_status: 'active',
    access_status: 'active',
    billing_provider: provider,
    provider_customer_id: sale.provider_customer_id || context.customerId || null,
    provider_subscription_id: billingMode === 'prepaid' ? null : (sale.provider_subscription_id || context.subscriptionId || null),
    last_payment_status: context.eventType || 'checkout.session.completed',
    last_payment_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (renewsAt) accessPayload.renews_at = renewsAt;

  if (!access?.id) {
    const { data: createdAccess, error: accessError } = await admin.from('organization_product_access').insert({ organization_id: organizationId, product_id: plan.product_id, starts_at: new Date().toISOString().slice(0, 10), ...accessPayload }).select('id,organization_id,plan_id,renews_at').single();
    if (accessError || !createdAccess?.id) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Empresa e usuário criados, mas o produto não pôde ser liberado.' }).eq('id', sale.id);
      return { access: null, error: 'Acesso não criado.' };
    }
    access = createdAccess;
  } else {
    if (provider === 'asaas') {
      // Never overwrite a courtesy, founder or another organization's
      // entitlement after an unexpected concurrency collision.
      await admin.from('nexus_sales').update({
        sale_status: 'manual_review',
        last_error: 'A empresa já tem acesso ao produto. Requer vinculação manual.',
      }).eq('id', sale.id);
      return { access: null, error: 'Contrato CRM existente; nenhuma alteração realizada.' };
    }
    const { error: accessUpdateError } = await admin.from('organization_product_access').update(accessPayload).eq('id', access.id);
    if (accessUpdateError) {
      await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: 'Pagamento confirmado, mas o plano existente não pôde ser atualizado.' }).eq('id', sale.id);
      return { access: null, error: 'Acesso não atualizado.' };
    }
  }

  const crmProvision = await provisionCrmTenant(admin, sale, access);
  if (crmProvision.isCrm && crmProvision.error) {
    await admin.from('nexus_sales').update({ sale_status: 'manual_review', last_error: crmProvision.error }).eq('id', sale.id);
    return { access: null, error: crmProvision.error };
  }

  if (sale.provider_checkout_id) {
    const { data: existingCheckout } = await admin.from('nexus_payment_checkouts').select('id').eq('provider', provider).eq('provider_checkout_id', sale.provider_checkout_id).maybeSingle();
    if (!existingCheckout?.id) {
      await admin.from('nexus_payment_checkouts').insert({
        organization_id: organizationId,
        access_id: access.id,
        plan_id: plan.id,
        provider: provider,
        environment: sale.environment || 'sandbox',
        external_reference: sale.external_reference || `nexus-sale-${sale.id}`,
        provider_checkout_id: sale.provider_checkout_id,
        provider_checkout_url: sale.provider_checkout_url,
        provider_customer_id: sale.provider_customer_id || context.customerId || null,
        provider_subscription_id: billingMode === 'prepaid' ? null : (sale.provider_subscription_id || context.subscriptionId || null),
        status: 'paid',
        amount_cents: contractedPrice,
        currency: plan.currency || 'BRL',
        billing_interval_months: billingCycleMonths,
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
    provider_subscription_id: billingMode === 'prepaid' ? null : (sale.provider_subscription_id || context.subscriptionId || null),
    paid_at: sale.paid_at || provisionedAt,
    provisioned_at: sale.provisioned_at || provisionedAt,
    last_error: null,
  }).eq('id', sale.id);

  sale.organization_id = organizationId;
  sale.user_id = userId;
  await admin.from('audit_logs').insert({ organization_id: organizationId, user_id: userId, action: 'NEXUS_SALE_PROVISIONED', entity: 'nexus_sales', entity_id: sale.id, metadata: { plan_id: plan.id, product_id: plan.product_id, provider: provider, billing_mode: billingMode, billing_cycle_months: billingCycleMonths } });
  if (crmProvision.isCrm) {
    await sendCrmAccessEmail(admin, sale, plan, crmProvision.firstAccessUrl, provider);
  } else if (pilotConversion) {
    const { data: previousConversion } = await admin.from('audit_logs')
      .select('id')
      .eq('action', 'NEXUS_PILOT_CONVERTED')
      .eq('entity', 'organization_product_access')
      .eq('entity_id', access.id)
      .contains('metadata', { sale_id: sale.id })
      .limit(1)
      .maybeSingle();
    if (!previousConversion?.id) {
      await admin.from('audit_logs').insert({
        organization_id: organizationId,
        user_id: userId,
        action: 'NEXUS_PILOT_CONVERTED',
        entity: 'organization_product_access',
        entity_id: access.id,
        metadata: {
          sale_id: sale.id,
          previous_access_id: pilotAccessId,
          target_plan_id: plan.id,
          provider: provider,
          billing_mode: billingMode,
          billing_cycle_months: billingCycleMonths,
        },
      });
    }
    await sendPilotConversionEmail(admin, sale, plan);
  } else {
    await sendFirstAccessEmail(admin, sale, plan);
  }
  return { access, error: null };
}
