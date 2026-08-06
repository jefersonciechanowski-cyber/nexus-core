-- Permite verificar vínculos antes de excluir setores e funções.
-- As políticas RLS continuam limitando os registros à organização autorizada.
grant select on table
  public.control_matrix_rules,
  public.epi_deliveries
to authenticated;
