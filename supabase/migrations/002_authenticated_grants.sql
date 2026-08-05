-- Permite que o papel autenticado use objetos do schema público.
grant usage on schema public to authenticated;

-- Permite leitura de perfis e organizações, respeitando as políticas RLS.
grant select on table
  public.profiles,
  public.organizations
to authenticated;

-- Permite que as políticas RLS resolvam a organização e o papel do usuário.
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_nexus_admin() to authenticated;
