-- Nexus AI neural speech budget. Only a service_role Edge Function can reserve output.
-- No media or source text is persisted; only usage counters.
create table if not exists public.nexus_ai_voice_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_count integer not null check (character_count between 2 and 520),
  created_at timestamptz not null default now()
);
create index if not exists nexus_ai_voice_usage_scope_idx
on public.nexus_ai_voice_usage_events (organization_id, created_at desc);
alter table public.nexus_ai_voice_usage_events enable row level security;
revoke all on table public.nexus_ai_voice_usage_events from public, anon, authenticated;
grant select, insert on table public.nexus_ai_voice_usage_events to service_role;

create or replace function public.reserve_nexus_ai_voice_usage(
  p_organization_id uuid, p_user_id uuid, p_character_count integer
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_month_count bigint;
  v_month_characters bigint;
  v_today_count bigint;
  v_month_start timestamptz := date_trunc('month',now());
  v_day_start timestamptz := date_trunc('day',now());
begin
  if p_organization_id is null or p_user_id is null
     or p_character_count < 2 or p_character_count > 520 then
    raise exception 'Invalid Nexus AI voice request';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=p_user_id and organization_id=p_organization_id
      and role='nexus_admin'::public.app_role and active=true
  ) then
    raise exception 'Voice access denied' using errcode='42501';
  end if;
  -- Serialization ensures concurrent voice requests cannot race past the quota.
  perform pg_advisory_xact_lock(
    hashtextextended('nexus-ai-voice:'||p_organization_id::text||':'||
      to_char(v_month_start,'YYYY-MM'),0)
  );
  select count(*),coalesce(sum(character_count),0),
    count(*) filter(where created_at>=v_day_start)
  into v_month_count,v_month_characters,v_today_count
  from public.nexus_ai_voice_usage_events
  where organization_id=p_organization_id and created_at>=v_month_start;
  if v_month_count>=500 or v_today_count>=40
     or v_month_characters + p_character_count > 120000 then
    raise exception 'Nexus AI neural voice budget reached';
  end if;
  insert into public.nexus_ai_voice_usage_events
    (organization_id,user_id,character_count)
  values (p_organization_id,p_user_id,p_character_count)
  returning id into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.reserve_nexus_ai_voice_usage(uuid,uuid,integer)
from public,anon,authenticated;
grant execute on function public.reserve_nexus_ai_voice_usage(uuid,uuid,integer)
to service_role;

comment on table public.nexus_ai_voice_usage_events
  is 'Metadata only for bounded optional NVIDIA TTS calls; never store audio or text.';
