-- Administrative summary of production Asaas evidence. No customer identifiers
-- or provider payloads leave the function beyond the existing access row ID.
create or replace function public.crm_admin_onboarding_status()
returns table(access_id uuid, payment_status text, due_on date, sale_linked boolean, email_status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.is_nexus_admin_aal2() is not true then
    raise exception 'Acesso administrativo com MFA obrigatório' using errcode='42501';
  end if;
  return query
  select a.id, p.provider_status::text, p.due_date::date, s.id is not null,
    case e.action when 'NEXUS_CRM_ONBOARDING_EMAIL_SENT' then 'sent'
                  when 'NEXUS_CRM_ONBOARDING_EMAIL_FAILED' then 'failed' end
  from public.organization_product_access a
  join public.nexus_products prod on prod.id=a.product_id and prod.code='crm'
  left join lateral (
    select n.provider_status,n.due_date,n.provider_payment_id,n.external_reference
    from public.nexus_payments n
    where n.access_id=a.id and n.organization_id=a.organization_id and n.provider='asaas'
    order by n.created_at desc,n.id desc limit 1
  ) p on true
  left join lateral (
    select v.id from public.nexus_sales v
    where v.organization_id=a.organization_id and v.product_id=a.product_id
      and v.provider='asaas' and v.environment='production' and (
        exists(select 1 from public.nexus_crm_asaas_production_verified_payments c
               where c.sale_id=v.id and c.provider_payment_id=p.provider_payment_id)
        or exists(select 1 from public.nexus_crm_asaas_production_annual_settlements c
               where c.sale_id=v.id and c.provider_payment_id=p.provider_payment_id))
    order by v.created_at desc,v.id limit 1
  ) s on true
  left join lateral (
    select l.action from public.audit_logs l where l.organization_id=a.organization_id
      and l.entity_id=s.id::text and l.action in ('NEXUS_CRM_ONBOARDING_EMAIL_SENT','NEXUS_CRM_ONBOARDING_EMAIL_FAILED')
    order by l.created_at desc,l.id desc limit 1
  ) e on true;
end;
$$;
revoke all on function public.crm_admin_onboarding_status() from public, anon;
grant execute on function public.crm_admin_onboarding_status() to authenticated;
