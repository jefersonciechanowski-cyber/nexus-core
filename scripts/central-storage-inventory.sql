-- Central private Storage metadata inventory; SOURCE or OFFLINE RESTORE only.
-- Only SELECT; never mutate storage.objects (Supabase's metadata catalog).
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH bucket AS (
  SELECT id, public FROM storage.buckets WHERE id = 'sst-documents'
), files AS (
  SELECT o.bucket_id, o.name, (o.metadata->>'size')::bigint AS bytes,
         o.updated_at::text AS updated_at
  FROM storage.objects o WHERE o.bucket_id = 'sst-documents'
)
SELECT jsonb_build_object(
  'version', 1,
  'bucket', 'sst-documents',
  'bucket_present', (SELECT count(*) FROM bucket),
  'bucket_private', (SELECT NOT public FROM bucket),
  'total_buckets', (SELECT count(*) FROM storage.buckets),
  'objects', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'name', name, 'bytes', bytes, 'updated_at', updated_at
  ) ORDER BY name) FROM files), '[]'::jsonb)
)::text;
COMMIT;
