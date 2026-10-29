-- 2026-10-29. One public recurring CRM subscription per identity and
-- environment, including concurrent Stripe and Asaas checkouts.
-- This is a non-destructive additive constraint. Courtesy/Agency/SST and
-- historical non-monthly sales remain out of scope.
-- sandbox and production are separate to avoid test records blocking live users.
CREATE UNIQUE INDEX IF NOT EXISTS nexus_crm_public_monthly_doc_by_env_idx
 ON public.nexus_sales (registration_number, environment)
 WHERE provider IN ('stripe','asaas')
   AND source = 'site-captacao'
   AND billing_mode = 'recurring'
   AND billing_cycle_months = 1
   AND sale_status IN ('lead','checkout_created','paid','provisioned')
   AND ((provider = 'stripe' AND external_reference LIKE 'crm-monthly-%')
      OR (provider = 'asaas' AND external_reference LIKE 'crm-asaas-monthly-%'));

CREATE UNIQUE INDEX IF NOT EXISTS nexus_crm_public_monthly_email_by_env_idx
 ON public.nexus_sales (lower(email), environment)
 WHERE provider IN ('stripe','asaas')
   AND source = 'site-captacao'
   AND billing_mode = 'recurring'
   AND billing_cycle_months = 1
   AND sale_status IN ('lead','checkout_created','paid','provisioned')
   AND ((provider = 'stripe' AND external_reference LIKE 'crm-monthly-%')
      OR (provider = 'asaas' AND external_reference LIKE 'crm-asaas-monthly-%'));
