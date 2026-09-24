const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return bytesToHex(digest);
}

function crmRemoteStatus(accessStatus: unknown, subscriptionStatus: unknown) {
  const access = clean(accessStatus, 30);
  const subscription = clean(subscriptionStatus, 30);
  if (subscription === 'cancelled') return 'cancelled';
  if (access === 'suspended' || subscription === 'past_due') return 'suspended';
  return 'active';
}


type CrmSyncResult = {
  isCrm: boolean;
  synced: boolean;
  error: string | null;
  revision?: number;
};

function crmEventTypeForStatus(status: string) {
  if (status === 'cancelled') return 'entitlement.cancelled';
  if (status === 'suspended') return 'entitlement.suspended';
  return 'entitlement.reactivated';
}

async function reserveCrmDelivery(admin: any, accessId: string, eventType: string, forceRevision: boolean) {
  const { data, error } = await admin.rpc('ensure_crm_sync_delivery', {
    p_access_id: accessId,
    p_event_type: eventType,
    p_force: forceRevision,
  });
  if (error) throw new Error(`Não foi possível reservar a revisão de sincronização do CRM: ${clean(error.message, 500)}`);
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const revision = Number(result.revision ?? 0);
  const confirmedRevision = Number(result.confirmed_revision ?? 0);
  return {
    isCrm: result.is_crm !== false,
    revision,
    confirmedRevision,
    pending: result.pending === true || revision > confirmedRevision,
  };
}

async function confirmCrmDelivery(admin: any, accessId: string, revision: number) {
  const { error } = await admin.rpc('confirm_crm_sync_delivery', {
    p_access_id: accessId,
    p_revision: revision,
  });
  if (error) throw new Error(`O CRM confirmou a revisão, mas a Central não conseguiu registrar a confirmação: ${clean(error.message, 500)}`);
}

async function failCrmDelivery(admin: any, accessId: string, revision: number, errorMessage: string) {
  await admin.rpc('fail_crm_sync_delivery', {
    p_access_id: accessId,
    p_revision: revision,
    p_error: clean(errorMessage, 1000),
  });
}

export async function syncCrmEntitlement(
  admin: any,
  accessId: string,
  forcedStatus?: 'active' | 'suspended' | 'cancelled',
  occurredAt?: string,
  forceRevision = false,
): Promise<CrmSyncResult> {
  const { data: access, error: accessError } = await admin
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,access_status,subscription_status,contracted_price_cents,commercial_condition,additional_users,base_user_limit_override,starts_at,renews_at,external_tenant_id')
    .eq('id', accessId)
    .maybeSingle();

  if (accessError || !access?.id) {
    return { isCrm: true, synced: false, error: 'Contrato não encontrado para sincronização com o CRM.' };
  }

  const { data: product, error: productError } = await admin
    .from('nexus_products')
    .select('id,code')
    .eq('id', access.product_id)
    .maybeSingle();

  if (productError) {
    return { isCrm: true, synced: false, error: 'Não foi possível validar o produto do contrato.' };
  }
  if (product?.code !== 'crm') {
    return { isCrm: false, synced: true, error: null };
  }

  const { data: plan, error: planError } = await admin
    .from('nexus_plans')
    .select('id,code,price_cents,included_user_limit,status')
    .eq('id', access.plan_id)
    .maybeSingle();

  if (planError || !plan?.id || plan.status !== 'active') {
    return { isCrm: true, synced: false, error: 'Plano comercial do CRM inválido ou inativo.' };
  }

  const crmOrganizationId = clean(access.external_tenant_id, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(crmOrganizationId)) {
    return { isCrm: true, synced: false, error: 'Tenant do CRM não vinculado ao contrato.' };
  }

  const canonicalEntitlementUrl = 'https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-entitlement';
  const configuredEntitlementUrl = clean(Deno.env.get('NEXUS_CRM_ENTITLEMENT_URL'), 1000);
  const endpoint = configuredEntitlementUrl.startsWith('https://') && !configuredEntitlementUrl.includes('.vercel.app/')
    ? configuredEntitlementUrl
    : canonicalEntitlementUrl;
  const secret = clean(Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET'), 1000);
  if (!endpoint.startsWith('https://') || secret.length < 32) {
    return { isCrm: true, synced: false, error: 'Integração de entitlement do CRM não configurada.' };
  }

  const status = forcedStatus ?? crmRemoteStatus(access.access_status, access.subscription_status);
  const baseMaxUsers = Number(access.base_user_limit_override ?? plan.included_user_limit);
  const additionalUsers = Number(access.additional_users ?? 0);
  const basePriceCents = Number(access.contracted_price_cents ?? plan.price_cents);
  if (!Number.isInteger(baseMaxUsers) || baseMaxUsers < 1 || !Number.isInteger(additionalUsers) || additionalUsers < 0 || !Number.isInteger(basePriceCents) || basePriceCents < 0) {
    return { isCrm: true, synced: false, error: 'Snapshot comercial do CRM inválido.' };
  }

  const commercialCondition = ['founder', 'courtesy'].includes(clean(access.commercial_condition, 30))
    ? clean(access.commercial_condition, 30)
    : 'standard';
  const eventType = crmEventTypeForStatus(status);

  let delivery;
  try {
    delivery = await reserveCrmDelivery(admin, accessId, eventType, forceRevision);
  } catch (error) {
    return { isCrm: true, synced: false, error: clean((error as any)?.message, 700) };
  }
  if (!delivery.isCrm) return { isCrm: false, synced: true, error: null };
  if (!Number.isInteger(delivery.revision) || delivery.revision < 1) {
    return { isCrm: true, synced: false, error: 'Revisão de sincronização do CRM inválida.' };
  }
  if (!delivery.pending) {
    return { isCrm: true, synced: true, error: null, revision: delivery.revision };
  }

  const payload = {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    revision: delivery.revision,
    occurred_at: occurredAt || new Date().toISOString(),
    organization_id: crmOrganizationId,
    central_company_id: clean(access.organization_id, 80),
    contract_id: clean(access.id, 80),
    entitlement: {
      product_code: 'nexus_crm',
      plan_code: clean(plan.code, 40),
      status,
      commercial_condition: commercialCondition,
      base_price_cents: basePriceCents,
      base_max_users: baseMaxUsers,
      additional_users: additionalUsers,
      started_at: access.starts_at || null,
      next_renewal_at: access.renews_at || null,
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = await hmacHex(secret, rawBody);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nexus-signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = `Falha de rede ao sincronizar CRM: ${clean((error as any)?.message, 400)}`;
    await failCrmDelivery(admin, accessId, delivery.revision, detail);
    return { isCrm: true, synced: false, error: detail, revision: delivery.revision };
  }

  const responseText = await response.text();
  let body: Record<string, unknown> = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = {}; }

  const confirmedRevision = Number(body?.confirmed_revision ?? 0);
  if (!response.ok || body?.ok !== true || !Number.isInteger(confirmedRevision) || confirmedRevision < delivery.revision) {
    const detail = clean(body?.error || responseText || `HTTP ${response.status}`, 700)
      || 'O CRM não confirmou a revisão enviada.';
    await failCrmDelivery(admin, accessId, delivery.revision, detail);
    return { isCrm: true, synced: false, error: detail, revision: delivery.revision };
  }

  try {
    await confirmCrmDelivery(admin, accessId, delivery.revision);
  } catch (error) {
    return { isCrm: true, synced: false, error: clean((error as any)?.message, 700), revision: delivery.revision };
  }

  return { isCrm: true, synced: true, error: null, revision: delivery.revision };
}

type CrmProvisionResult = {
  isCrm: boolean;
  error: string | null;
  crmOrganizationId: string | null;
  firstAccessUrl: string | null;
};

export async function provisionCrmTenant(admin: any, sale: any, access: any): Promise<CrmProvisionResult> {
  const { data: plan, error: planError } = await admin
    .from('nexus_plans')
    .select('id,product_id,code,name,price_cents,included_user_limit,status')
    .eq('id', sale.plan_id)
    .maybeSingle();

  if (planError || !plan?.id) {
    return { isCrm: true, error: 'Não foi possível validar o plano antes do provisionamento.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const { data: product, error: productError } = await admin
    .from('nexus_products')
    .select('id,code,name,status')
    .eq('id', plan.product_id)
    .maybeSingle();

  if (productError) {
    return { isCrm: true, error: 'Não foi possível validar o produto antes do provisionamento.', crmOrganizationId: null, firstAccessUrl: null };
  }
  if (product?.code !== 'crm') {
    return { isCrm: false, error: null, crmOrganizationId: null, firstAccessUrl: null };
  }

  const provisionUrl = clean(
    Deno.env.get('NEXUS_CRM_PROVISION_URL') || 'https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-provision',
    1000,
  );
  const secret = clean(Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET'), 1000);
  if (!provisionUrl.startsWith('https://') || secret.length < 32) {
    return { isCrm: true, error: 'Integração de provisionamento do Nexus CRM não configurada.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const { data: accessRow, error: accessError } = await admin
    .from('organization_product_access')
    .select('id,organization_id,access_status,subscription_status,contracted_price_cents,commercial_condition,additional_users,base_user_limit_override,starts_at,renews_at,external_tenant_id')
    .eq('id', access.id)
    .maybeSingle();

  if (accessError || !accessRow?.id) {
    return { isCrm: true, error: 'Contrato do Nexus CRM não encontrado após o pagamento.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const existingTenantId = clean(accessRow.external_tenant_id, 80);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existingTenantId)) {
    return { isCrm: true, error: null, crmOrganizationId: existingTenantId, firstAccessUrl: null };
  }

  const baseMaxUsers = Number(accessRow.base_user_limit_override ?? plan.included_user_limit);
  const additionalUsers = Number(accessRow.additional_users ?? 0);
  const basePriceCents = Number(accessRow.contracted_price_cents ?? plan.price_cents);
  if (!Number.isInteger(baseMaxUsers) || baseMaxUsers < 1 || !Number.isInteger(additionalUsers) || additionalUsers < 0 || !Number.isInteger(basePriceCents) || basePriceCents < 0) {
    return { isCrm: true, error: 'Plano comercial do Nexus CRM possui limites inválidos.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const commercialCondition = ['founder', 'courtesy'].includes(clean(accessRow.commercial_condition, 30))
    ? clean(accessRow.commercial_condition, 30)
    : 'standard';

  let delivery;
  try {
    delivery = await reserveCrmDelivery(admin, accessRow.id, 'entitlement.activated', false);
  } catch (error) {
    return { isCrm: true, error: clean((error as any)?.message, 700), crmOrganizationId: null, firstAccessUrl: null };
  }
  if (!Number.isInteger(delivery.revision) || delivery.revision < 1) {
    return { isCrm: true, error: 'Revisão inicial do provisionamento CRM inválida.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const environment = clean(sale.environment, 30) === 'production' ? 'production' : 'administrative';
  const payload = {
    event_id: crypto.randomUUID(),
    revision: delivery.revision,
    occurred_at: new Date().toISOString(),
    environment,
    sale_id: clean(sale.id, 80),
    central_company_id: clean(accessRow.organization_id, 80),
    contract_id: clean(accessRow.id, 80),
    company_name: clean(sale.company_name, 140),
    owner_name: clean(sale.responsible_name, 140),
    owner_email: clean(sale.email, 180).toLowerCase(),
    entitlement: {
      plan_code: clean(plan.code, 40),
      status: crmRemoteStatus(accessRow.access_status, accessRow.subscription_status),
      commercial_condition: commercialCondition,
      base_price_cents: basePriceCents,
      base_max_users: baseMaxUsers,
      additional_users: additionalUsers,
      started_at: accessRow.starts_at || null,
      next_renewal_at: accessRow.renews_at || null,
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = await hmacHex(secret, rawBody);

  let response: Response;
  try {
    response = await fetch(provisionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nexus-signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = `Não foi possível comunicar com o Nexus CRM: ${clean((error as any)?.message, 400)}`;
    await failCrmDelivery(admin, accessRow.id, delivery.revision, detail);
    return { isCrm: true, error: detail, crmOrganizationId: null, firstAccessUrl: null };
  }

  const responseText = await response.text();
  let responseBody: Record<string, unknown> = {};
  try { responseBody = responseText ? JSON.parse(responseText) : {}; } catch { responseBody = {}; }

  const confirmedRevision = Number(responseBody.confirmed_revision ?? 0);
  if (!response.ok || responseBody?.ok !== true || !Number.isInteger(confirmedRevision) || confirmedRevision < delivery.revision) {
    const detail = clean(responseBody.error, 500) || `HTTP ${response.status}`;
    await failCrmDelivery(admin, accessRow.id, delivery.revision, detail);
    return { isCrm: true, error: `Nexus CRM não pôde ser provisionado: ${detail}`, crmOrganizationId: null, firstAccessUrl: null };
  }

  const crmOrganizationId = clean(responseBody.crmOrganizationId, 80);
  const firstAccessUrl = clean(responseBody.firstAccessUrl, 1500) || null;
  if (!crmOrganizationId) {
    const detail = 'Nexus CRM não retornou o identificador da organização criada.';
    await failCrmDelivery(admin, accessRow.id, delivery.revision, detail);
    return { isCrm: true, error: detail, crmOrganizationId: null, firstAccessUrl };
  }

  const { error: linkError } = await admin
    .from('organization_product_access')
    .update({ external_tenant_id: crmOrganizationId, updated_at: new Date().toISOString() })
    .eq('id', accessRow.id);

  if (linkError) {
    const detail = 'CRM criado, mas o vínculo com a Central não pôde ser salvo.';
    await failCrmDelivery(admin, accessRow.id, delivery.revision, detail);
    return { isCrm: true, error: detail, crmOrganizationId, firstAccessUrl };
  }

  try {
    await confirmCrmDelivery(admin, accessRow.id, delivery.revision);
  } catch (error) {
    return { isCrm: true, error: clean((error as any)?.message, 700), crmOrganizationId, firstAccessUrl };
  }

  return { isCrm: true, error: null, crmOrganizationId, firstAccessUrl };
}

async function auditCrmEmailFailure(admin: any, sale: any, reason: string) {
  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_CRM_ONBOARDING_EMAIL_FAILED',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, provider: 'brevo', reason: clean(reason, 700) },
  });
}

export async function sendCrmAccessEmail(admin: any, sale: any, plan: any, firstAccessUrl: string | null) {
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!brevoKey || !fromEmail || !sale?.email || !firstAccessUrl) {
    await auditCrmEmailFailure(admin, sale, !firstAccessUrl ? 'Link de primeiro acesso do CRM ausente.' : 'BREVO_API_KEY, BREVO_FROM_EMAIL ou e-mail do cliente ausente.');
    return false;
  }

  const { data: previous } = await admin.from('audit_logs')
    .select('id')
    .eq('action', 'NEXUS_CRM_ONBOARDING_EMAIL_SENT')
    .eq('entity', 'nexus_sales')
    .eq('entity_id', sale.id)
    .limit(1)
    .maybeSingle();
  if (previous?.id) return true;

  const escapeHtml = (value: unknown) => clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu acesso ao Nexus CRM está pronto</h2>
      <p>Olá, ${escapeHtml(sale.responsible_name)}.</p>
      <p>O pagamento da <strong>${escapeHtml(sale.company_name)}</strong> foi confirmado e o plano <strong>${escapeHtml(plan?.name || 'Nexus CRM')}</strong> já está ativo.</p>
      <p>Seu ambiente comercial foi criado automaticamente. Defina sua senha para entrar como administrador inicial.</p>
      <p style="margin:28px 0"><a href="${firstAccessUrl}" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Definir senha e acessar o Nexus CRM</a></p>
      <p style="font-size:13px;color:#68757b">Depois do primeiro acesso, sua equipe pode ser convidada em Equipe e Acessos, respeitando o limite do plano contratado.</p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core · ambiente criado automaticamente após confirmação financeira da Stripe.</p>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': brevoKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: sale.email, name: clean(sale.responsible_name, 140) || undefined }],
      subject: 'Seu acesso ao Nexus CRM está pronto',
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    await auditCrmEmailFailure(admin, sale, `Brevo ${response.status}: ${clean(await response.text(), 500)}`);
    return false;
  }

  let messageId: string | null = null;
  try { messageId = clean((await response.json())?.messageId, 255) || null; } catch { /* resposta sem JSON */ }

  await admin.from('audit_logs').insert({
    organization_id: sale.organization_id || null,
    user_id: sale.user_id || null,
    action: 'NEXUS_CRM_ONBOARDING_EMAIL_SENT',
    entity: 'nexus_sales',
    entity_id: sale.id,
    metadata: { email: sale.email, plan_id: sale.plan_id, provider: 'brevo', billing_provider: 'stripe', message_id: messageId },
  });
  return true;
}
