begin;

-- The Asaas Edge Functions use the Supabase service_role to persist
-- checkouts, payments and webhook events. RLS bypass alone does not grant
-- table privileges, so the backend role must explicitly receive DML access.
grant select, insert, update, delete
on table
  public.nexus_payment_checkouts,
  public.nexus_payments,
  public.nexus_payment_webhook_events
to service_role;

comment on table public.nexus_payment_checkouts is
  'Jornadas de checkout hospedado criadas no Asaas para assinaturas Nexus. Escrita reservada ao backend service_role.';
comment on table public.nexus_payments is
  'Cobranças e recebimentos reconciliados por webhook do Asaas. Escrita reservada ao backend service_role.';
comment on table public.nexus_payment_webhook_events is
  'Eventos do Asaas persistidos para idempotência e auditoria. Escrita reservada ao backend service_role.';

commit;
