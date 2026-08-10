import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Alert = {
  id: string;
  type: 'Exame' | 'Treinamento' | 'EPI';
  item: string;
  employeeName: string;
  unitName: string;
  sectorName: string;
  due: string;
  status: 'OVERDUE' | 'DUE_7' | 'DUE_15' | 'DUE_30';
};

const allowedRoles = new Set(['nexus_admin', 'org_admin', 'sst_manager', 'sst_technician']);
const allowedTypes = new Set(['Exame', 'Treinamento', 'EPI']);
const allowedStatuses = new Set(['OVERDUE', 'DUE_7', 'DUE_15', 'DUE_30']);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const clean = (value: unknown, size = 180) => String(value ?? '').trim().slice(0, size);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character));
const formatDate = (value: string) => { const [year, month, day] = value.slice(0, 10).split('-'); return year && month && day ? `${day}/${month}/${year}` : value; };
const statusLabel = (status: string) => ({ OVERDUE: 'Vencido', DUE_7: 'Vence em até 7 dias', DUE_15: 'Vence em até 15 dias', DUE_30: 'Vence em até 30 dias' }[status] || 'Prazo próximo');

function normalizeAlerts(input: unknown): Alert[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).flatMap(raw => {
    const alert = raw as Record<string, unknown>;
    const normalized = {
      id: clean(alert.id, 300), type: clean(alert.type, 20), item: clean(alert.item),
      employeeName: clean(alert.employeeName), unitName: clean(alert.unitName),
      sectorName: clean(alert.sectorName), due: clean(alert.due, 10), status: clean(alert.status, 20),
    };
    if (!normalized.id || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.due) || !allowedTypes.has(normalized.type) || !allowedStatuses.has(normalized.status)) return [];
    return [normalized as Alert];
  });
}

function emailHtml(organizationName: string, alerts: Alert[]) {
  const rows = alerts.map(alert => `<tr><td style="padding:10px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(alert.item)}</strong><br><small>${escapeHtml(alert.type)}</small></td><td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(alert.employeeName)}<br><small>${escapeHtml(alert.unitName)} / ${escapeHtml(alert.sectorName)}</small></td><td style="padding:10px;border-bottom:1px solid #e5e7eb">${formatDate(alert.due)}<br><small>${statusLabel(alert.status)}</small></td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;color:#172026;max-width:760px;margin:auto"><div style="padding:20px;background:#111827;color:#e0b84a"><h1 style="margin:0;font-size:22px">Nexus Core · SST Controle</h1></div><div style="padding:22px"><h2>Alertas preventivos de ${escapeHtml(organizationName)}</h2><p>Encontramos ${alerts.length} obrigação(ões) que exigem atenção.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th style="padding:10px;text-align:left">Obrigação</th><th style="padding:10px;text-align:left">Colaborador</th><th style="padding:10px;text-align:left">Prazo</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:22px;color:#6b7280;font-size:12px">Mensagem automática enviada pela Central de Alertas do SST Controle.</p></div></div>`;
}

function testEmailHtml(organizationName: string) {
  return `<div style="font-family:Arial,sans-serif;color:#172026;max-width:620px;margin:auto"><div style="padding:20px;background:#111827;color:#e0b84a"><h1 style="margin:0;font-size:22px">Nexus Core · SST Controle</h1></div><div style="padding:24px"><h2>Teste de envio concluído</h2><p>A integração de e-mail da empresa <strong>${escapeHtml(organizationName)}</strong> está funcionando.</p><p>Esta mensagem é somente um teste da Central de Alertas. Nenhum colaborador, obrigação ou vencimento foi criado ou alterado.</p><p style="margin-top:22px;color:#6b7280;font-size:12px">Mensagem de teste enviada pelo SST Controle.</p></div></div>`;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESEND_FROM_EMAIL');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: 'Integração não configurada.' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await userClient.from('profiles').select('organization_id,role,organizations(name)').eq('id', user.id).single();
  if (profileError || !profile?.organization_id || !allowedRoles.has(profile.role)) return json({ error: 'Usuário sem permissão para enviar alertas.' }, 403);

  const { data: preferences, error: preferencesError } = await userClient.from('notification_email_preferences').select('enabled,recipients,deadline_statuses').eq('organization_id', profile.organization_id).maybeSingle();
  if (preferencesError) return json({ error: 'Não foi possível carregar as preferências.' }, 500);
  if (!preferences?.enabled || !preferences.recipients?.length) return json({ error: 'O envio por e-mail está desativado ou sem destinatários.' }, 409);
  if (!resendApiKey || !from) return json({ error: 'Configure RESEND_API_KEY e RESEND_FROM_EMAIL na Edge Function.' }, 503);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: 'Corpo da requisição inválido.' }, 400); }

  const recipients = [...new Set((preferences.recipients as string[]).map(recipient => recipient.trim().toLowerCase()))].slice(0, 10);
  const organization = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations;
  const organizationName = clean(organization?.name || 'sua empresa');

  if (body.test === true) {
    let sent = 0, failed = 0;
    const errors: string[] = [];
    for (const recipient of recipients) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [recipient], subject: '[SST Controle] Teste de integração de e-mail', html: testEmailHtml(organizationName) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(clean(result?.message || 'Falha no provedor de e-mail.', 500));
        sent += 1;
      } catch (error) {
        failed += 1;
        errors.push(clean(error instanceof Error ? error.message : error, 500));
      }
    }
    return json({ test: true, sent, failed, error: sent ? null : (errors[0] || 'Não foi possível enviar o e-mail de teste.') });
  }

  const selectedStatuses = new Set(preferences.deadline_statuses || []);
  const alerts = normalizeAlerts(body.alerts).filter(alert => selectedStatuses.has(alert.status));
  if (!alerts.length) return json({ sent: 0, skipped: 0, failed: 0, message: 'Nenhum alerta atende às preferências.' });

  const keys = alerts.map(alert => alert.id);
  const { data: previous } = await adminClient.from('notification_delivery_logs').select('alert_key,due_date,recipient,status').eq('organization_id', profile.organization_id).eq('channel', 'email').eq('status', 'sent').in('alert_key', keys);
  const sentKeys = new Set((previous || []).map(row => `${row.recipient}|${row.alert_key}|${row.due_date}`));
  let sent = 0, skipped = 0, failed = 0;

  for (const recipient of recipients) {
    const pending = alerts.filter(alert => !sentKeys.has(`${recipient}|${alert.id}|${alert.due}`));
    skipped += alerts.length - pending.length;
    if (!pending.length) continue;
    let status = 'failed', providerMessageId: string | null = null, errorMessage: string | null = null;
    try {
      const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [recipient], subject: `[SST Controle] ${pending.length} alerta(s) preventivo(s)`, html: emailHtml(organizationName, pending) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(clean(result?.message || 'Falha no provedor de e-mail.', 500));
      status = 'sent'; providerMessageId = clean(result?.id, 300); sent += pending.length;
    } catch (error) { errorMessage = clean(error instanceof Error ? error.message : error, 500); failed += pending.length; }

    const timestamp = new Date().toISOString();
    await adminClient.from('notification_delivery_logs').upsert(pending.map(alert => ({ organization_id: profile.organization_id, alert_key: alert.id, due_date: alert.due, channel: 'email', recipient, status, provider_message_id: providerMessageId, error_message: errorMessage, sent_at: status === 'sent' ? timestamp : null, updated_at: timestamp })), { onConflict: 'organization_id,alert_key,due_date,channel,recipient' });
    if (status === 'sent') await adminClient.from('notification_alert_states').upsert(pending.map(alert => ({ organization_id: profile.organization_id, alert_key: alert.id, category: alert.type, due_date: alert.due, last_seen_at: timestamp, email_sent_at: timestamp, updated_at: timestamp })), { onConflict: 'organization_id,alert_key' });
  }

  return json({ sent, skipped, failed });
});
