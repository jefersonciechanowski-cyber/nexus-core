begin;

alter table public.nexus_sales
  add column if not exists lead_stage text,
  add column if not exists lead_notes text,
  add column if not exists contacted_at timestamptz,
  add column if not exists demo_scheduled_at timestamptz;

update public.nexus_sales
set lead_stage = case
  when sale_status in ('paid','provisioned') then 'won'
  when sale_status in ('expired','canceled','failed') then 'lost'
  when sale_status in ('checkout_created','manual_review') then 'contacted'
  else 'new'
end
where lead_stage is null;

alter table public.nexus_sales
  alter column lead_stage set default 'new',
  alter column lead_stage set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'nexus_sales_lead_stage_check'
      and conrelid = 'public.nexus_sales'::regclass
  ) then
    alter table public.nexus_sales
      add constraint nexus_sales_lead_stage_check
      check (lead_stage in ('new','contacted','demo_scheduled','proposal','won','lost'));
  end if;
end;
$$;

create index if not exists nexus_sales_lead_stage_idx
  on public.nexus_sales (lead_stage, created_at desc);

comment on column public.nexus_sales.lead_stage is 'Etapa comercial administrada pela Central Nexus para leads e demonstrações.';
comment on column public.nexus_sales.lead_notes is 'Anotações internas de acompanhamento comercial, visíveis apenas à administração Nexus.';
comment on column public.nexus_sales.contacted_at is 'Data do primeiro contato comercial registrado pela administração Nexus.';
comment on column public.nexus_sales.demo_scheduled_at is 'Data e hora prevista para demonstração do produto.';

commit;
