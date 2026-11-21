# Nexus Central: real pg_dump -> offline PostgreSQL restore exercise.
# Use only on a trusted computer; requires Docker Desktop/Engine.
# The source URL is entered locally (or supplied via env) and never logged or stored in Git.
[CmdletBinding()]
param(
  [string]$SourceDbUrl = $env:CENTRAL_SOURCE_DATABASE_URL,
  [switch]$SyntheticFixture,
  [switch]$KeepBackup,
  [string]$PostgresImage = 'postgres:17'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$oldSource = $env:CENTRAL_SOURCE_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($SourceDbUrl)) {
  $protected = Read-Host 'Central PostgreSQL URI (hidden, local machine only)' -AsSecureString
  $SourceDbUrl = [System.Net.NetworkCredential]::new('', $protected).Password
}
$uri = $null
try { $uri = [uri]$SourceDbUrl } catch { throw 'Invalid database URI.' }
if ($uri.Scheme -notin @('postgresql', 'postgres')) { throw 'Expected a PostgreSQL connection URI.' }
if (-not $SyntheticFixture) {
  $expected = 'db.svphwbccqeoakpmcpvhy.supabase.co'
  if (($uri.Host -ne $expected) -and (-not $uri.Host.EndsWith('.pooler.supabase.com'))) {
    throw 'Safety gate: source host must be the Central Supabase project (direct or Supabase pooler).'
  }
  if ($uri.Host.EndsWith('.pooler.supabase.com') -and $uri.UserInfo -notmatch 'svphwbccqeoakpmcpvhy') {
    throw 'Safety gate: pooler username must identify the Central project.'
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop/Engine is required.' }
$env:CENTRAL_SOURCE_DATABASE_URL = $SourceDbUrl
$folder = Join-Path ([System.IO.Path]::GetTempPath()) ('central-recovery-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$archive = Join-Path $folder 'central-native-logical.dump'
$restoreName = 'central-recovery-' + ([guid]::NewGuid().ToString('N').Substring(0,12))
$restoreStarted = [System.Diagnostics.Stopwatch]::StartNew()
$stage = 'initialization'

# Only operational columns are compared; no names, addresses, e-mails, keys,
# WhatsApp content, hashed passwords or raw customer records appear in logs.
$compareSql = @'
SELECT md5(jsonb_build_object(
  'organizations', (SELECT coalesce(jsonb_agg(jsonb_build_array(id::text,status) ORDER BY id), '[]'::jsonb) FROM public.organizations),
  'memberships', (SELECT coalesce(jsonb_agg(jsonb_build_array(organization_id::text,user_id::text,role::text,active) ORDER BY organization_id,user_id), '[]'::jsonb) FROM public.organization_memberships),
  'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_array(id::text,status,billing_organization_id::text,plan_id::text) ORDER BY id), '[]'::jsonb) FROM public.nexus_accounts),
  'access', (SELECT coalesce(jsonb_agg(jsonb_build_array(id::text,organization_id::text,access_status,subscription_status) ORDER BY id), '[]'::jsonb) FROM public.organization_product_access),
  'profiles', (SELECT coalesce(jsonb_agg(jsonb_build_array(id::text,organization_id::text,role::text,active) ORDER BY id), '[]'::jsonb) FROM public.profiles),
  'account_orgs', (SELECT coalesce(jsonb_agg(jsonb_build_array(account_id::text,organization_id::text,active) ORDER BY account_id,organization_id), '[]'::jsonb) FROM public.nexus_account_organizations),
  'account_users', (SELECT coalesce(jsonb_agg(jsonb_build_array(account_id::text,user_id::text,active) ORDER BY account_id,user_id), '[]'::jsonb) FROM public.nexus_account_users),
  'checkouts', (SELECT count(*) FROM public.nexus_payment_checkouts),
  'payments', (SELECT coalesce(jsonb_agg(jsonb_build_array(id::text,access_id::text) ORDER BY id), '[]'::jsonb) FROM public.nexus_payments),
  'auth_users', (SELECT count(*) FROM auth.users)
)::text)::text;
'@
function Run-Docker([string[]]$Argv) {
  $result = & docker @Argv 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Docker failed during [$stage], exit code $LASTEXITCODE. No private output will be logged." }
  return ($result | Out-String).Trim()
}
function Source-Query([string]$Query) {
  return Run-Docker @('run','--rm','--network','bridge','--add-host','host.docker.internal:host-gateway',
    '--env','CENTRAL_SOURCE_DATABASE_URL',$PostgresImage,
    'sh','-c','exec psql "$CENTRAL_SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "$1"','sh',$Query)
}
function Target-Query([string]$Query) {
  return Run-Docker @('exec',$restoreName,'psql','-U','postgres','-d','central_restore',
    '-X','-A','-t','-v','ON_ERROR_STOP=1','-c',$Query)
}

try {
  $stage = 'image preparation'
  Run-Docker @('pull',$PostgresImage) | Out-Null
  $stage = 'read-only source snapshot'
  $sourceBefore = (Source-Query $compareSql).Trim()
  if ($sourceBefore -notmatch '^[0-9a-f]{32}$') { throw 'Source comparison did not produce an aggregate digest.' }
  $capturedAt = [DateTimeOffset]::UtcNow

  # pg_dump is READ ONLY on source. Docker receives the URL as an environment
  # variable, NEVER as a literal command argument or process log.
  $stage = 'read-only custom-format database dump'
  Run-Docker @('run','--rm','--network','bridge','--add-host','host.docker.internal:host-gateway',
    '--env','CENTRAL_SOURCE_DATABASE_URL','--volume',($folder + ':/backup'),
    $PostgresImage,'sh','-c',
    'exec pg_dump --dbname="$CENTRAL_SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage --file=/backup/central-native-logical.dump') | Out-Null

  if (-not (Test-Path -LiteralPath $archive)) { throw 'No dump was generated.' }
  $fs = [IO.File]::OpenRead($archive)
  try {
    $magic = New-Object byte[] 5
    if ($fs.Read($magic,0,5) -ne 5 -or [Text.Encoding]::ASCII.GetString($magic) -ne 'PGDMP') {
      throw 'Invalid pg_dump custom archive.'
    }
  } finally { $fs.Dispose() }

  $stage = 'source stability check'
  $sourceAfter = (Source-Query $compareSql).Trim()
  if ($sourceAfter -ne $sourceBefore) {
    throw 'Source changed while backup was taken; cannot certify equality to this aggregate checkpoint.'
  }

  $stage = 'offline restore container startup'
  Run-Docker @('run','--rm','--detach','--network','none','--name',$restoreName,
    '--env','POSTGRES_HOST_AUTH_METHOD=trust','--env','POSTGRES_DB=central_restore',
    '--tmpfs','/var/lib/postgresql/data:rw,size=268435456',
    $PostgresImage) | Out-Null
  $network = Run-Docker @('inspect','--format','{{.HostConfig.NetworkMode}}',$restoreName)
  if ($network -ne 'none') { throw 'Restore container must have network mode NONE.' }

  $ready = $false
  for ($i=0; $i -lt 50; $i++) {
    & docker exec $restoreName pg_isready -U postgres -d central_restore 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ready) { throw 'Offline PostgreSQL did not become ready.' }

  $stage = 'offline prerequisite database roles'
  foreach ($role in @('anon','authenticated','authenticator','service_role','supabase_auth_admin','supabase_storage_admin','supabase_admin','dashboard_user','supabase_read_only_user','supabase_realtime_admin','supabase_replication_admin')) {
    $statement = "DO " + '$$' + " BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname = '$role') THEN CREATE ROLE $role NOLOGIN; END IF; END " + '$$' + ";"
    Target-Query $statement | Out-Null
  }
  $stage = 'offline archive transfer'
  Run-Docker @('cp',$archive,($restoreName + ':/tmp/central-native-logical.dump')) | Out-Null

  $stage = 'offline pg_restore'
  Run-Docker @('exec',$restoreName,'pg_restore','--dbname=central_restore','--username=postgres',
    '--no-owner','--no-privileges','--single-transaction','--exit-on-error',
    '/tmp/central-native-logical.dump') | Out-Null

  $stage = 'offline count and permission integrity check'
  $restoredDigest = (Target-Query $compareSql).Trim()
  if ($restoredDigest -ne $sourceBefore) { throw 'Operational counts, roles or finance state differ in the recovered copy.' }
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $integritySql = Join-Path $scriptDir 'central-restore-integrity.sql'
  if (-not (Test-Path -LiteralPath $integritySql)) { throw 'Missing reviewed integrity verification script.' }
  Run-Docker @('cp',$integritySql,($restoreName + ':/tmp/central-restore-integrity.sql')) | Out-Null
  $csv = Run-Docker @('exec',$restoreName,'psql','-U','postgres','-d','central_restore',
    '-X','--csv','-v','ON_ERROR_STOP=1','-f','/tmp/central-restore-integrity.sql')
  $entries = @($csv | ConvertFrom-Csv)
  $badLinks = @($entries | Where-Object { $_.type -eq 'link_integrity' -and [int64]$_.total -gt 0 })
  if ($badLinks.Count -gt 0) { throw 'Recovered database contains broken organization, user or contract links.' }

  $restoreStarted.Stop()
  $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  # This is a measured test-lab elapsed time, NOT a promised production recovery SLA.
  $summary = [ordered]@{
    outcome = 'PASS'
    backup_kind = 'manual_postgres17_custom_logical'
    source = if ($SyntheticFixture) { 'synthetic' } else { 'central_supabase_production_read_only' }
    captured_utc = $capturedAt.ToString('o')
    backup_bytes = (Get-Item -LiteralPath $archive).Length
    backup_sha256 = $checksum
    output_digest_match = ($restoredDigest -eq $sourceBefore)
    checked_integrity_metrics = $entries.Count
    broken_relationships = $badLinks.Count
    recovery_lab_seconds = [math]::Round($restoreStarted.Elapsed.TotalSeconds,2)
    isolated_postgres = $PostgresImage
    isolated_network_mode = $network
    external_notifications_and_charges = 0
    stored_backup = [bool]$KeepBackup
    excludes = 'Storage object bytes, SMTP/provider secrets, production DNS/Edge, real login and billing effects'
  }
  # Do not print actual database contents or credential-bearing URLs.
  $summary | ConvertTo-Json -Depth 4
  if ($KeepBackup) { Write-Warning 'Sensitive backup retained locally; store only in an encrypted private location.' }
} finally {
  $env:CENTRAL_SOURCE_DATABASE_URL = $oldSource
  & docker rm -f $restoreName 2>$null | Out-Null
  if (-not $KeepBackup) {
    if (Test-Path -LiteralPath $folder) { Remove-Item -LiteralPath $folder -Force -Recurse -ErrorAction SilentlyContinue }
  } else {
    Write-Warning ('Dump retained at local path: ' + $archive)
  }
}
