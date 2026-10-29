# CRM Asaas — Sandbox E2E pilot with payment flow, no live billing

Asaas Pix and boleto have been confirmed MANUALLY on Asaas Sandbox, with webhook receipt. This release prepares the next stage: a sale created *by Central* with a signed HMAC bridge and full relationship to the generated provider link.

Only `nexus-public-crm-monthly-asaas` is eligible for sandbox-only execution when ALL of:
`NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED=true`,
`NEXUS_CRM_ASAAS_MONTHLY_ENABLED=true`,
`NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`,
`NEXUS_CRM_CHECKOUT_TEST_ALLOW_HIDDEN_PLANS=true` (only if the plan is hidden).
Existing `NEXUS_CRM_CHECKOUT_BRIDGE_SECRET` must match the signed Nexus CRM server request. New public checkout remains gated by the CRM frontend's `NEXUS_ASAAS_CHECKOUT_ENABLED`, and the site UI is not enabled by this PR.

Only the fake company name **exactly `Nexus CRM Sandbox E2E`** and an email using the reserved `@example.test` domain can pass. Test data must not identify a real customer. There is no production Asaas host or production API key in this handler. Provider URL returned must be on `sandbox.asaas.com`. No user account or tenant is provisioned by the checkout alone.

The other three Asaas functions `nexus-crm-asaas-monthly-events`, `nexus-crm-asaas-verify-event`, and `nexus-crm-asaas-provision` remain unconditionally disabled. One-off manual provider link and payment must not be confused with a Central-originating sale. Before testing entitlement, verify event capture, four independent provider GETs, provider identity and paid status, idempotent reservations, lease, then review first-access email.

**This code release is not permission to enable any live charges.** Verify CI and deploy this sandbox handler only with feature flags OFF until a private signed test request is ready. Any new methods exposed on the CRM site require separate Preview validation.
