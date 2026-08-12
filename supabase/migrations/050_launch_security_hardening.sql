begin;

-- Funções usadas somente por triggers/validações internas não precisam ficar
-- expostas como RPC no schema público. Os triggers continuam executando-as
-- normalmente porque a revogação afeta apenas chamadas diretas por roles.
revoke all on function public.clear_qualitative_exam_evaluation_rule() from public, anon, authenticated;
revoke all on function public.enforce_control_matrix_rule_integrity() from public, anon, authenticated;
revoke all on function public.enforce_epi_catalog_integrity() from public, anon, authenticated;
revoke all on function public.enforce_epi_delivery_disposition() from public, anon, authenticated;
revoke all on function public.enforce_epi_delivery_integrity() from public, anon, authenticated;
revoke all on function public.enforce_epi_purchase_integrity() from public, anon, authenticated;
revoke all on function public.enforce_epi_stock_with_disposal() from public, anon, authenticated;
revoke all on function public.enforce_exam_record_integrity_and_snapshot() from public, anon, authenticated;
revoke all on function public.enforce_occurrence_type_integrity() from public, anon, authenticated;
revoke all on function public.enforce_qualitative_exam_evaluation_rule() from public, anon, authenticated;
revoke all on function public.enforce_sector_exam_requirement_integrity() from public, anon, authenticated;
revoke all on function public.nexus_sync_paid_sale_to_crm() from public, anon, authenticated;
revoke all on function public.set_control_matrix_rules_updated_at() from public, anon, authenticated;
revoke all on function public.set_employees_updated_at() from public, anon, authenticated;
revoke all on function public.set_epi_catalog_updated_at() from public, anon, authenticated;
revoke all on function public.set_epi_purchases_updated_at() from public, anon, authenticated;
revoke all on function public.set_exam_catalog_updated_at() from public, anon, authenticated;
revoke all on function public.set_exam_evaluation_rules_updated_at() from public, anon, authenticated;
revoke all on function public.set_exam_records_updated_at() from public, anon, authenticated;
revoke all on function public.set_organizations_updated_at() from public, anon, authenticated;
revoke all on function public.set_sector_exam_requirements_updated_at() from public, anon, authenticated;
revoke all on function public.set_units_updated_at() from public, anon, authenticated;

comment on function public.nexus_sync_paid_sale_to_crm() is 'Trigger interno de sincronização comercial; sem execução direta por clientes.';

commit;
