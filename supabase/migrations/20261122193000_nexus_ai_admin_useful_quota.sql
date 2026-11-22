-- Expand administrator Nexus AI trial usage without changing provider price/cost ceilings.
-- Applied idempotently: never overwrite a later custom entitlement.
update public.nexus_ai_entitlements
set monthly_request_limit=300,
    monthly_token_limit=500000,
    updated_at=now()
where product_code='nexus-core'
  and package_code='intelligence'
  and enabled=true
  and monthly_request_limit=10
  and monthly_token_limit=30000;
