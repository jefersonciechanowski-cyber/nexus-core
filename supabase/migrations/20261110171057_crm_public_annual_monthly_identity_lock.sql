-- Serialize public CRM identity across annual and monthly checkout attempts.
-- Different plan, method, day or provider must not create another live charge.
-- Keep ambiguous provider outcomes (manual_review) reserved until reconciled.
-- No customer, contract or payment rows are changed.
CREATE UNIQUE INDEX nexus_crm_public_checkout_document_env_uidx
ON public.nexus_sales (registration_number, environment)
WHERE source='site-captacao' AND provider IN ('asaas','stripe')
  AND external_reference LIKE 'crm-%'
  AND sale_status IN ('lead','checkout_created','paid','provisioned','manual_review');
CREATE UNIQUE INDEX nexus_crm_public_checkout_email_env_uidx
ON public.nexus_sales (lower(email), environment)
WHERE source='site-captacao' AND provider IN ('asaas','stripe')
  AND external_reference LIKE 'crm-%'
  AND sale_status IN ('lead','checkout_created','paid','provisioned','manual_review');
