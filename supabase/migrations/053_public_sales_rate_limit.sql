begin;

-- Contador interno usado exclusivamente pela Edge Function pública de vendas.
-- O endereço do cliente nunca é persistido: somente um HMAC SHA-256 irreversível.
create table if not exists public.nexus_public_request_limits (
  fingerprint_hash text not null,
  action text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (fingerprint_hash, action, window_start),
  constraint nexus_public_request_limits_fingerprint_check
    check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  constraint nexus_public_request_limits_action_check
    check (action ~ '^[a-z0-9_-]{1,40}$'),
  constraint nexus_public_request_limits_count_check
    check (request_count > 0)
);

alter table public.nexus_public_request_limits enable row level security;
revoke all privileges on table public.nexus_public_request_limits
  from public, anon, authenticated;

create or replace function public.consume_nexus_public_request_limit(
  p_fingerprint_hash text,
  p_action text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_fingerprint_hash !~ '^[0-9a-f]{64}$'
    or p_action !~ '^[a-z0-9_-]{1,40}$'
    or p_window_seconds not between 10 and 86400
    or p_limit not between 1 and 1000 then
    return false;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  delete from public.nexus_public_request_limits
  where fingerprint_hash = p_fingerprint_hash
    and window_start < clock_timestamp() - interval '2 days';

  insert into public.nexus_public_request_limits (
    fingerprint_hash,
    action,
    window_start,
    request_count
  ) values (
    p_fingerprint_hash,
    p_action,
    v_window_start,
    1
  )
  on conflict (fingerprint_hash, action, window_start)
  do update
    set request_count = nexus_public_request_limits.request_count + 1,
        updated_at = clock_timestamp()
    where nexus_public_request_limits.request_count < p_limit
  returning request_count into v_count;

  return v_count is not null and v_count <= p_limit;
end;
$$;

revoke all on function public.consume_nexus_public_request_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_nexus_public_request_limit(text, text, integer, integer)
  to service_role;

comment on table public.nexus_public_request_limits is
  'Contadores efêmeros e irreversíveis de abuso da Edge Function nexus-public-sales.';
comment on function public.consume_nexus_public_request_limit(text, text, integer, integer) is
  'Consome atomicamente uma tentativa por HMAC de origem; acessível somente ao backend service_role.';

commit;
