-- Permite operações CRUD do papel autenticado nas entidades centrais.
-- As políticas RLS continuam limitando os dados à organização autorizada.
grant select, insert, update, delete on table
  public.units,
  public.sectors,
  public.job_roles,
  public.employees
to authenticated;
