-- Preserve advertising attribution from the already signed CRM checkout.
-- Nullable and additive on the existing RLS-protected nexus_sales table.
-- Legacy Stripe, SST and Agency operations are not changed.
ALTER TABLE public.nexus_sales
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS referrer_host text;

COMMENT ON COLUMN public.nexus_sales.utm_source IS 'Signed Nexus CRM checkout traffic origin, e.g. meta or google';
COMMENT ON COLUMN public.nexus_sales.utm_medium IS 'Signed Nexus CRM checkout traffic medium';
COMMENT ON COLUMN public.nexus_sales.utm_campaign IS 'Signed Nexus CRM checkout campaign identifier or name';
COMMENT ON COLUMN public.nexus_sales.utm_content IS 'Signed Nexus CRM checkout ad or creative UTM content';
COMMENT ON COLUMN public.nexus_sales.utm_term IS 'Signed Nexus CRM checkout UTM term';
COMMENT ON COLUMN public.nexus_sales.referrer_host IS 'Hostname only, without path, query or personal information';
