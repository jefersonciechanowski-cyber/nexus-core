-- Generate replayable explicit ACLs for public sequences (read-only on source).
-- This SQL emits GRANT statements to a private, ephemeral runner file; NEVER print
-- its output in GitHub logs. Package inside the encrypted recovery archive.
-- Object and role identifiers are quoted by Postgres format('%I', ...).
SELECT format(
  'GRANT %s ON SEQUENCE %I.%I TO %s%s;',
  a.privilege_type,
  n.nspname,
  c.relname,
  CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE format('%I', grantee.rolname) END,
  CASE WHEN a.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
LEFT JOIN pg_roles grantee ON grantee.oid = a.grantee
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND a.privilege_type IN ('SELECT', 'UPDATE', 'USAGE')
ORDER BY n.nspname, c.relname, a.grantee, a.privilege_type, a.is_grantable;
