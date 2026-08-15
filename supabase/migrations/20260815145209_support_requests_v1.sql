create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique,
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  source text not null,
  product_code text,
  page_url text,
  page_title text,
  message text not null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_requests_protocol_check check (protocol ~ '^SUP-[A-Z0-9-]{8,40}$'),
  constraint support_requests_requester_name_check check (char_length(requester_name) between 2 and 180),
  constraint support_requests_requester_email_check check (char_length(requester_email) between 3 and 254),
  constraint support_requests_source_check check (char_length(source) between 2 and 80),
  constraint support_requests_product_code_check check (product_code is null or char_length(product_code) between 2 and 80),
  constraint support_requests_page_url_check check (page_url is null or char_length(page_url) <= 1500),
  constraint support_requests_page_title_check check (page_title is null or char_length(page_title) <= 300),
  constraint support_requests_message_check check (char_length(message) between 5 and 4000),
  constraint support_requests_status_check check (status in ('open','in_progress','resolved','closed')),
  constraint support_requests_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index support_requests_created_at_idx on public.support_requests (created_at desc);
create index support_requests_status_created_at_idx on public.support_requests (status, created_at desc);
create index support_requests_organization_created_at_idx on public.support_requests (organization_id, created_at desc) where organization_id is not null;
create index support_requests_user_created_at_idx on public.support_requests (user_id, created_at desc) where user_id is not null;

alter table public.support_requests enable row level security;

revoke all on table public.support_requests from public;
revoke all on table public.support_requests from anon;
grant select, update on table public.support_requests to authenticated;
grant all on table public.support_requests to service_role;

create policy "nexus admins read support requests"
on public.support_requests
for select
to authenticated
using ((select public.is_nexus_admin()));

create policy "nexus admins update support requests"
on public.support_requests
for update
to authenticated
using ((select public.is_nexus_admin()))
with check ((select public.is_nexus_admin()));

comment on table public.support_requests is 'Central de chamados de suporte da Nexus Core para site, portal e produtos.';
