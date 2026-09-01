begin;

alter table public.nexus_products
  add column if not exists sales_url text;

alter table public.nexus_products
  drop constraint if exists nexus_products_sales_url_check;
alter table public.nexus_products
  add constraint nexus_products_sales_url_check
  check (
    sales_url is null
    or sales_url ~ '^https://'
    or sales_url like '/apps/%'
  );

update public.nexus_products
set sales_url = '/apps/site-captacao/', updated_at = now()
where code = 'sst'
  and sales_url is null;

comment on column public.nexus_products.sales_url is
  'Página comercial/renovação do produto. É independente da URL usada para abrir o sistema contratado.';

commit;
