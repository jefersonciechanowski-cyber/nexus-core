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

function crmStatus(accessStatus: unknown, subscriptionStatus: unknown) {
  const access = clean(accessStatus, 30);
  const subscription = clean(subscriptionStatus, 30);
  if (subscription === 'cancelled') return 'cancelled';
  if (access === 'suspended' || subscription === 'past_due') return 'suspended';
  return 'active';
}

function crmEventType(status: string) {
  if (status === 'cancelled') return 'entitlement.cancelled';
  if (status === 'suspended') return 'entitlement.suspended';
  return 'entitlement.reactivated';
}

function commercialCondition(value: unknown) {
  const condition = clean(value, 30);
  if (condition === 'founder') return 'founder';
  if (condition === 'courtesy') return 'courtesy';
  return 'standard';
}

export async function syncCrmEntitlement(admin: any, accessId: string) {
  const { data: access, error: accessError } = await admin
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,access_status,subscription_status,contracted_price_cents,commercial_condition,additional_users,base_user_limit_override,starts_at,renews_at,external_tenant_id')
    .eq('id', accessId)
    .maybeSingle();

  if (accessError) throw new Error('Não foi possível carregar o contrato para sincronização com o CRM.');
  if (!access?.id || !access.external_tenant_id) return { skipped: true, reason: 'crm_not_provisioned' };

  const { data: product, error: productError } = await admin
    .from('nexus_products')
    .select('code')
    .eq('id', access.product_id)
    .maybeSingle();
  if (productError) throw new Error('Não foi possível validar o produto durante a sincronização com o CRM.');
  if (product?.code !== 'crm') return { skipped: true, reason: 'not_crm' };

  const { data: plan, error: planError } = await admin
    .from('nexus_plans')
    .select('code,price_cents,included_user_limit')
    .eq('id', access.plan_id)
    .maybeSingle();
  if (planError || !plan?.code) throw new Error('Plano do CRM não encontrado durante a sincronização comercial.');

  const baseMaxUsers = Number(access.base_user_limit_override ?? plan.included_user_limit);
  const additionalUsers = Number(access.additional_users ?? 0);
  const basePriceCents = Number(access.contracted_price_cents ?? plan.price_cents ?? 0);
  if (!Number.isInteger(baseMaxUsers) || baseMaxUsers < 1 || !Number.isInteger(additionalUsers) || additionalUsers < 0 || !Number.isInteger(basePriceCents) || basePriceCents < 0) {
    throw new Error('Snapshot comercial do CRM inválido para sincronização.');
  }

  const status = crmStatus(access.access_status, access.subscription_status);
  const payload = {
    event_id: crypto.randomUUID(),
    event_type: crmEventType(status),
    occurred_at: new Date().toISOString(),
    organization_id: clean(access.external_tenant_id, 80),
    central_company_id: clean(access.organization_id, 80),
    contract_id: clean(access.id, 80),
    entitlement: {
      product_code: 'nexus_crm',
      plan_code: clean(plan.code, 40),
      status,
      commercial_condition: commercialCondition(access.commercial_condition),
      base_price_cents: basePriceCents,
      base_max_users: baseMaxUsers,
      additional_users: additionalUsers,
      started_at: access.starts_at || null,
      next_renewal_at: access.renews_at || null,
    },
  };

  const endpoint = clean(
    Deno.env.get('NEXUS_CRM_ENTITLEMENT_URL') || 'https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-entitlement',
    1000,
  );
  const secret = clean(Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET'), 1000);
  if (!endpoint.startsWith('https://') || secret.length < 32) {
    throw new Error('Sincronização comercial do Nexus CRM não configurada.');
  }

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
  } catch {
    throw new Error('Nexus CRM indisponível durante a sincronização do contrato.');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = clean(body?.error, 300);
    } catch {
      detail = '';
    }
    throw new Error(`Nexus CRM recusou a sincronização comercial${detail ? `: ${detail}` : ` (HTTP ${response.status})`}.`);
  }

  return { skipped: false, status };
}
