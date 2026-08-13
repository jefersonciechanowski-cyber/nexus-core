begin;

-- Políticas administrativas ALL também participam do SELECT e duplicam as
-- políticas de leitura. Separar escrita preserva as permissões e evita que o
-- PostgreSQL avalie duas políticas permissivas para cada consulta.
drop policy if exists "nexus admin manage payment checkouts" on public.nexus_payment_checkouts;
create policy "nexus admin insert payment checkouts" on public.nexus_payment_checkouts
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update payment checkouts" on public.nexus_payment_checkouts
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete payment checkouts" on public.nexus_payment_checkouts
  for delete to authenticated using ((select public.is_nexus_admin()));

drop policy if exists "nexus admin manage payments" on public.nexus_payments;
create policy "nexus admin insert payments" on public.nexus_payments
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update payments" on public.nexus_payments
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete payments" on public.nexus_payments
  for delete to authenticated using ((select public.is_nexus_admin()));

drop policy if exists "nexus admin manage plans" on public.nexus_plans;
create policy "nexus admin insert plans" on public.nexus_plans
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update plans" on public.nexus_plans
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete plans" on public.nexus_plans
  for delete to authenticated using ((select public.is_nexus_admin()));

drop policy if exists "nexus admin manage products" on public.nexus_products;
create policy "nexus admin insert products" on public.nexus_products
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update products" on public.nexus_products
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete products" on public.nexus_products
  for delete to authenticated using ((select public.is_nexus_admin()));

drop policy if exists "nexus admin manage sales" on public.nexus_sales;
create policy "nexus admin insert sales" on public.nexus_sales
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update sales" on public.nexus_sales
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete sales" on public.nexus_sales
  for delete to authenticated using ((select public.is_nexus_admin()));

drop policy if exists "nexus admin manage product access" on public.organization_product_access;
create policy "nexus admin insert product access" on public.organization_product_access
  for insert to authenticated with check ((select public.is_nexus_admin()));
create policy "nexus admin update product access" on public.organization_product_access
  for update to authenticated using ((select public.is_nexus_admin())) with check ((select public.is_nexus_admin()));
create policy "nexus admin delete product access" on public.organization_product_access
  for delete to authenticated using ((select public.is_nexus_admin()));

-- Índices de apoio para todas as FKs sinalizadas pelo advisor. Além de joins,
-- eles evitam varreduras integrais ao atualizar ou remover linhas pai.
create index if not exists audit_logs_organization_id_idx on public.audit_logs (organization_id);
create index if not exists audit_logs_user_id_idx on public.audit_logs (user_id);
create index if not exists company_documents_created_by_idx on public.company_documents (created_by);
create index if not exists company_documents_unit_id_idx on public.company_documents (unit_id);
create index if not exists control_matrix_rules_epi_id_idx on public.control_matrix_rules (epi_id);
create index if not exists control_matrix_rules_exam_id_idx on public.control_matrix_rules (exam_id);
create index if not exists control_matrix_rules_job_role_id_idx on public.control_matrix_rules (job_role_id);
create index if not exists control_matrix_rules_sector_id_idx on public.control_matrix_rules (sector_id);
create index if not exists control_matrix_rules_training_id_idx on public.control_matrix_rules (training_id);
create index if not exists control_matrix_rules_unit_id_idx on public.control_matrix_rules (unit_id);
create index if not exists employees_job_role_id_idx on public.employees (job_role_id);
create index if not exists employees_sector_id_idx on public.employees (sector_id);
create index if not exists employees_unit_id_idx on public.employees (unit_id);
create index if not exists epi_deliveries_employee_id_idx on public.epi_deliveries (employee_id);
create index if not exists epi_deliveries_epi_id_idx on public.epi_deliveries (epi_id);
create index if not exists epi_deliveries_job_role_id_idx on public.epi_deliveries (job_role_id);
create index if not exists epi_deliveries_matrix_rule_id_idx on public.epi_deliveries (matrix_rule_id);
create index if not exists epi_deliveries_purchase_id_idx on public.epi_deliveries (purchase_id);
create index if not exists epi_deliveries_sector_id_idx on public.epi_deliveries (sector_id);
create index if not exists epi_deliveries_unit_id_idx on public.epi_deliveries (unit_id);
create index if not exists epi_purchases_epi_id_idx on public.epi_purchases (epi_id);
create index if not exists exam_records_employee_id_idx on public.exam_records (employee_id);
create index if not exists exam_records_exam_id_idx on public.exam_records (exam_id);
create index if not exists job_roles_organization_id_idx on public.job_roles (organization_id);
create index if not exists nexus_payment_checkouts_plan_id_idx on public.nexus_payment_checkouts (plan_id);
create index if not exists nexus_payments_checkout_id_idx on public.nexus_payments (checkout_id);
create index if not exists nexus_sales_organization_id_idx on public.nexus_sales (organization_id);
create index if not exists nexus_sales_plan_id_idx on public.nexus_sales (plan_id);
create index if not exists nexus_sales_product_id_idx on public.nexus_sales (product_id);
create index if not exists nexus_sales_user_id_idx on public.nexus_sales (user_id);
create index if not exists occurrence_types_created_by_idx on public.occurrence_types (created_by);
create index if not exists occurrences_cancelled_by_idx on public.occurrences (cancelled_by);
create index if not exists occurrences_created_by_idx on public.occurrences (created_by);
create index if not exists occurrences_employee_id_idx on public.occurrences (employee_id);
create index if not exists occurrences_occurrence_type_id_idx on public.occurrences (occurrence_type_id);
create index if not exists occurrences_sector_id_idx on public.occurrences (sector_id);
create index if not exists occurrences_unit_id_idx on public.occurrences (unit_id);
create index if not exists organization_product_access_plan_product_idx on public.organization_product_access (plan_id, product_id);
create index if not exists profiles_organization_id_idx on public.profiles (organization_id);
create index if not exists regulatory_inspections_created_by_idx on public.regulatory_inspections (created_by);
create index if not exists regulatory_inspections_unit_id_idx on public.regulatory_inspections (unit_id);
create index if not exists regulatory_requirements_created_by_idx on public.regulatory_requirements (created_by);
create index if not exists sector_exam_requirements_exam_id_idx on public.sector_exam_requirements (exam_id);
create index if not exists sectors_organization_id_idx on public.sectors (organization_id);
create index if not exists sectors_unit_id_idx on public.sectors (unit_id);
create index if not exists training_records_cancelled_by_idx on public.training_records (cancelled_by);
create index if not exists training_records_created_by_idx on public.training_records (created_by);
create index if not exists training_records_employee_id_idx on public.training_records (employee_id);
create index if not exists training_records_job_role_id_idx on public.training_records (job_role_id);
create index if not exists training_records_matrix_rule_id_idx on public.training_records (matrix_rule_id);
create index if not exists training_records_sector_id_idx on public.training_records (sector_id);
create index if not exists training_records_training_type_id_idx on public.training_records (training_type_id);
create index if not exists training_records_unit_id_idx on public.training_records (unit_id);

commit;
