-- REVIEW ONLY — do not apply to Supabase production automatically.
-- Stripe-first public checkout: prevent charging an existing Nexus identity
-- or creating two public CRM sales from one email/document in a race.
-- The public endpoint authenticates to these RPCs exclusively via service_role.
-- IMPORTANT: site-captacao is also used for legacy CRM lead intake.
-- Unique indexes MUST target ONLY external_reference prefix crm-monthly-;
-- otherwise existing forms and paid sandbox sales would be disrupted.
-- Validate against existing historical CRM sales before migration (index builds
-- may fail if legacy duplicate public sales already exist).

create or replace function public.preflight_nexus_crm_public_identity(
  p_document text,p_email text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_doc text := pg_catalog.regexp_replace(coalesce(p_document,''),'[^0-9]','','g');
 v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
begin
  if v_doc !~ '^[0-9]{11}$' and v_doc !~ '^[0-9]{14}$'
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or pg_catalog.length(v_email)>254 then
    return pg_catalog.jsonb_build_object('eligible',false,'reason','invalid_identity');
  end if;
  -- Deny an already linked company, agency courtesy, Founder or paid account.
  if exists(select 1 from public.organizations o
      where pg_catalog.regexp_replace(coalesce(o.registration_number,''),'[^0-9]','','g')=v_doc
        or pg_catalog.lower(pg_catalog.btrim(o.email))=v_email)
     or exists(select 1 from auth.users u
      where pg_catalog.lower(u.email)=v_email) then
    return pg_catalog.jsonb_build_object('eligible',false,'reason','existing_identity');
  end if;
  return pg_catalog.jsonb_build_object('eligible',true,'reason','new_identity');
end; $$;
revoke all on function public.preflight_nexus_crm_public_identity(text,text)
  from PUBLIC,anon,authenticated;
grant execute on function public.preflight_nexus_crm_public_identity(text,text)
  to service_role;

-- Atomic race protection across two separate sales using the same email OR
-- same document, even if client sends different plan/email values in parallel.
-- Includes pending 'lead' rows to lock the identity BEFORE creating a Stripe
-- Checkout session. This is intentionally fail-closed until manual review.
create unique index if not exists nexus_crm_stripe_public_unique_doc_idx
  on public.nexus_sales(registration_number)
  where provider='stripe' and source='site-captacao'
    and external_reference like 'crm-monthly-%'
    and billing_mode='recurring' and billing_cycle_months=1
    and sale_status in ('lead','checkout_created','paid','provisioned');
create unique index if not exists nexus_crm_stripe_public_unique_email_idx
  on public.nexus_sales(pg_catalog.lower(email))
  where provider='stripe' and source='site-captacao'
    and external_reference like 'crm-monthly-%'
    and billing_mode='recurring' and billing_cycle_months=1
    and sale_status in ('lead','checkout_created','paid','provisioned');

-- This migration does not touch organization_product_access, payments,
-- existing courtesies or customers. An existing checkout cannot be
-- automatically re-linked to a different identity or charged again.
