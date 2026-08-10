begin;

alter table public.nexus_sales
  add column if not exists return_origin text;

comment on column public.nexus_sales.return_origin is
  'Origem web validada pela Edge Function para retorno do checkout e links de primeiro acesso.';

grant update (return_origin) on public.nexus_sales to service_role;

commit;
