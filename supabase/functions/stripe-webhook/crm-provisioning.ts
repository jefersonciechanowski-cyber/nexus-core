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
    return { isCrm: false, error: null, crmOrganizationId: null, firstAccessUrl: null };
  }

  const { data: product } = await admin
    .from('nexus_products')
    .select('id,code,name,status')
    .eq('id', plan.product_id)
    .maybeSingle();

  if (product?.code !== 'crm') {
    return { isCrm: false, error: null, crmOrganizationId: null, firstAccessUrl: null };
  }

  const provisionUrl = clean(
    Deno.env.get('NEXUS_CRM_PROVISION_URL') || 'https://ngxqtzfotkpdvynstae.supabase.co/functions/v1/nexus-central-provision',
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

  const baseMaxUsers = Number(accessRow.base_user_limit_override ?? plan.included_user_limit);
  const additionalUsers = Number(accessRow.additional_users ?? 0);
  const basePriceCents = Number(accessRow.contracted_price_cents ?? plan.price_cents);
  if (!Number.isInteger(baseMaxUsers) || baseMaxUsers < 1 || !Number.isInteger(additionalUsers) || additionalUsers < 0 || !Number.isInteger(basePriceCents) || basePriceCents < 0) {
    return { isCrm: true, error: 'Plano comercial do Nexus CRM possui limites inválidos.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const payload = {
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    sale_id: clean(sale.id, 80),
    central_company_id: clean(accessRow.organization_id, 80),
    contract_id: clean(accessRow.id, 80),
    company_name: clean(sale.company_name, 140),
    owner_name: clean(sale.responsible_name, 140),
    owner_email: clean(sale.email, 180).toLowerCase(),
    entitlement: {
      plan_code: clean(plan.code, 40),
      status: crmRemoteStatus(accessRow.access_status, accessRow.subscription_status),
      commercial_condition: accessRow.commercial_condition === 'founder' ? 'founder' : 'standard',
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
    });
  } catch (error) {
    console.error('[Nexus CRM provision] Falha de rede:', error);
    return { isCrm: true, error: 'Não foi possível comunicar com o Nexus CRM.', crmOrganizationId: null, firstAccessUrl: null };
  }

  const responseText = await response.text();
  let responseBody: Record<string, unknown> = {};
  try { responseBody = responseText ? JSON.parse(responseText) : {}; } catch { responseBody = {}; }

  if (!response.ok) {
    const detail = clean(responseBody.error, 500) || `HTTP ${response.status}`;
    console.error('[Nexus CRM provision] Destino rejeitou:', response.status, detail);
    return { isCrm: true, error: `Nexus CRM não pôde ser provisionado: ${detail}`, crmOrganizationId: null, firstAccessUrl: null };
  }

  const crmOrganizationId = clean(responseBody.crmOrganizationId, 80);
  const firstAccessUrl = clean(responseBody.firstAccessUrl, 1500) || null;
  if (!crmOrganizationId) {
    return { isCrm: true, error: 'Nexus CRM não retornou o identificador da organização criada.', crmOrganizationId: null, firstAccessUrl };
  }

  const { error: linkError } = await admin
    .from('organization_product_access')
    .update({ external_tenant_id: crmOrganizationId, updated_at: new Date().toISOString() })
    .eq('id', accessRow.id);

  if (linkError) {
    return { isCrm: true, error: 'CRM criado, mas o vínculo com a Central não pôde ser salvo.', crmOrganizationId, firstAccessUrl };
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
