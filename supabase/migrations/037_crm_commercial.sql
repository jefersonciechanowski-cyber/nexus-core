begin;

alter table public.nexus_sales
  add column if not exists lead_owner text,
  add column if not exists next_contact_at timestamptz,
  add column if not exists campaign_name text,
  add column if not exists ad_name text,
  add column if not exists lost_reason text;

alter table public.nexus_sales
  alter column responsible_name drop not null,
  alter column email drop not null;

alter table public.nexus_sales
  drop constraint if exists nexus_sales_lead_stage_check;

alter table public.nexus_sales
  add constraint nexus_sales_lead_stage_check
  check (lead_stage in (
    'new',
    'attempt_contact',
    'contacted',
    'demo_scheduled',
    'proposal',
    'negotiation',
    'won',
    'lost'
  ));

alter table public.nexus_sales
  drop constraint if exists nexus_sales_lead_contact_check;

alter table public.nexus_sales
  add constraint nexus_sales_lead_contact_check
  check (
    sale_status <> 'lead'
    or nullif(btrim(coalesce(email, '')), '') is not null
    or nullif(btrim(coalesce(phone, '')), '') is not null
  );

create index if not exists nexus_sales_next_contact_idx
  on public.nexus_sales (next_contact_at)
  where next_contact_at is not null and lead_stage not in ('won','lost');

create index if not exists nexus_sales_source_idx
  on public.nexus_sales (source, created_at desc);

create or replace function public.nexus_sync_paid_sale_to_crm()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sale_status in ('paid','provisioned') then
    new.lead_stage := 'won';
  end if;
  return new;
end;
$$;

drop trigger if exists nexus_sales_sync_paid_crm on public.nexus_sales;
create trigger nexus_sales_sync_paid_crm
before insert or update of sale_status on public.nexus_sales
for each row execute function public.nexus_sync_paid_sale_to_crm();

comment on column public.nexus_sales.lead_owner is 'Responsável comercial pelo lead na Central Nexus.';
comment on column public.nexus_sales.next_contact_at is 'Próxima ação ou contato previsto no CRM comercial.';
comment on column public.nexus_sales.campaign_name is 'Nome da campanha de aquisição, preenchido manualmente ou por futura integração de mídia.';
comment on column public.nexus_sales.ad_name is 'Anúncio, criativo ou peça de origem do lead.';
comment on column public.nexus_sales.lost_reason is 'Motivo comercial registrado quando o lead é encerrado como perdido.';
comment on column public.nexus_sales.source is 'Origem comercial do lead, como site-captacao, cold_outbound, referral, meta_ads, google_ads ou organic.';

commit;
