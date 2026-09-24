import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const appFiles = await collectFiles(join(projectRoot, 'apps'));
const functionFiles = await collectFiles(join(projectRoot, 'supabase', 'functions'));
const migrationFiles = await collectFiles(join(projectRoot, 'supabase', 'migrations'));

for (const file of appFiles) {
  const extension = extname(file);
  if (!['.html', '.js'].includes(extension)) continue;
  const source = await readFile(file, 'utf8');
  const displayPath = relative(projectRoot, file);

  if (source.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js@2</script>')) {
    fail(`${displayPath}: Supabase JS sem versão fixa.`);
  }

  if (source.includes('cdn.sheetjs.com/')
    && (!source.includes('XLSX_INTEGRITY') || !source.includes("crossOrigin = 'anonymous'") && !source.includes("crossOrigin='anonymous'"))) {
    fail(`${displayPath}: SheetJS externo sem SRI/crossorigin.`);
  }

  if (extension === '.html') {
    const externalScripts = source.match(/<script\b[^>]*\bsrc="https:\/\/[^">]+"[^>]*><\/script>/g) || [];
    for (const tag of externalScripts) {
      const isTurnstileApi = tag.includes('src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=nexusTurnstileReady&amp;render=explicit"');
      if (!isTurnstileApi && (!tag.includes(' integrity="sha384-') || !tag.includes(' crossorigin="anonymous"'))) {
        fail(`${displayPath}: script externo sem SRI/crossorigin: ${tag.slice(0, 140)}`);
      }
    }
  }
}

for (const file of functionFiles) {
  if (extname(file) !== '.ts') continue;
  const source = await readFile(file, 'utf8');
  const displayPath = relative(projectRoot, file);
  if (/npm:@supabase\/supabase-js@2(?:['"])/.test(source)) {
    fail(`${displayPath}: dependência Supabase da Edge Function sem versão exata.`);
  }
  if (/\.payment_method_types\s*=/.test(source) || /(?:^|[{,]\s*)payment_method_types\s*:/m.test(source)) {
    fail(`${displayPath}: payment_method_types deve ser substituído por configuração dinâmica da Stripe.`);
  }
}

for (const paymentFunction of ['nexus-public-sales', 'stripe-create-checkout', 'stripe-webhook']) {
  const source = await readFile(join(projectRoot, 'supabase', 'functions', paymentFunction, 'index.ts'), 'utf8');
  if (!source.includes('NEXUS_PAYMENT_LIVE_ENABLED')) {
    fail(`supabase/functions/${paymentFunction}/index.ts: interruptor explícito de pagamentos live ausente.`);
  }
}

const publicSalesSource = await readFile(join(projectRoot, 'supabase', 'functions', 'nexus-public-sales', 'index.ts'), 'utf8');
for (const requiredPilotCheckoutGuard of [
  'admin.auth.getUser(match[1])',
  "currentPlan?.code !== 'piloto'",
  "access.subscription_status !== 'trial'",
  'body.pilotUpgrade === true && !pilotContext',
  "source: pilotContext ? 'portal-pilot-upgrade' : 'site-captacao'",
  'organization_id: pilotContext?.organizationId || null',
  'user_id: pilotContext?.userId || null',
]) {
  if (!publicSalesSource.includes(requiredPilotCheckoutGuard)) {
    fail(`nexus-public-sales: proteção da conversão autenticada do piloto ausente: ${requiredPilotCheckoutGuard}`);
  }
}

const stripeWebhookSource = await readFile(join(projectRoot, 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');
for (const requiredPilotProvisionGuard of [
  "sale.source === 'portal-pilot-upgrade'",
  "existingAccess?.subscription_status === 'trial'",
  "existingPlan?.code === 'piloto'",
  'alreadyConvertedPilotAccess',
  "plan.employee_limit && Number(activeEmployeeCount || 0) > Number(plan.employee_limit)",
  'NEXUS_PILOT_CONVERTED',
  'sendPilotConversionEmail',
  'Sua empresa, usuários e todos os registros do período piloto foram preservados.',
]) {
  if (!stripeWebhookSource.includes(requiredPilotProvisionGuard)) {
    fail(`stripe-webhook: proteção da conversão do piloto ausente: ${requiredPilotProvisionGuard}`);
  }
}

const portalSource = await readFile(join(projectRoot, 'apps', 'portal-cliente', 'index.html'), 'utf8');
if (!portalSource.includes('data-pilot-upgrade') || !portalSource.includes('?upgrade=pilot#planos')) {
  fail('apps/portal-cliente/index.html: ação autenticada para converter o piloto ausente.');
}

const finalHardeningMigrations = migrationFiles.filter(file => file.endsWith('_final_security_hardening.sql'));
if (finalHardeningMigrations.length !== 1) {
  fail('supabase/migrations: migration final de segurança ausente ou duplicada.');
} else {
  const source = await readFile(finalHardeningMigrations[0], 'utf8');
  const adminGuardCount = (source.match(/Apenas administradores podem/g) || []).length;
  if (adminGuardCount !== 4) {
    fail('migration final: funções privilegiadas sem verificação administrativa completa.');
  }
  if (!source.includes('drop extension if exists pg_net;')) {
    fail('migration final: pg_net temporário não foi removido com segurança.');
  }
  if (!source.includes('deny direct access to public request limits')) {
    fail('migration final: política deny-all explícita do rate limit ausente.');
  }
}

const authSource = await readFile(join(projectRoot, 'apps', 'sst-controle', 'supabase-auth.js'), 'utf8');
if (authSource.includes('select.innerHTML') || authSource.includes('panel.innerHTML')) {
  fail('apps/sst-controle/supabase-auth.js: dados de organização ainda entram por innerHTML.');
}
if (!authSource.includes('options: { captchaToken }')) {
  fail('apps/sst-controle/supabase-auth.js: token do CAPTCHA ausente no login.');
}

const recoverySource = await readFile(join(projectRoot, 'apps', 'portal-cliente', 'password-recovery.js'), 'utf8');
if (!recoverySource.includes('resetPasswordForEmail(value, { redirectTo, captchaToken })')) {
  fail('apps/portal-cliente/password-recovery.js: token do CAPTCHA ausente na recuperação de senha.');
}

for (const loginPage of [
  'apps/sst-controle/login.html',
  'apps/nexus-admin/login.html',
  'apps/portal-cliente/login.html',
  'apps/portal-cliente/recuperar-senha.html',
]) {
  const source = await readFile(join(projectRoot, loginPage), 'utf8');
  if (!source.includes('id="nexus-turnstile"') || !source.includes('https://challenges.cloudflare.com/turnstile/v0/api.js')) {
    fail(`${loginPage}: proteção Turnstile ausente.`);
  }
}

const headers = await readFile(join(projectRoot, '_headers'), 'utf8');
for (const requiredHeader of ['Content-Security-Policy:', 'Strict-Transport-Security:', 'X-Content-Type-Options:']) {
  if (!headers.includes(requiredHeader)) fail(`_headers: cabeçalho ausente: ${requiredHeader}`);
}
for (const policy of headers.split(/\r?\n/).filter(line => line.includes('Content-Security-Policy:'))) {
  if (!/script-src[^;]*https:\/\/challenges\.cloudflare\.com/.test(policy)) {
    fail('_headers: Turnstile ausente em script-src.');
  }
  if (!/frame-src[^;]*https:\/\/challenges\.cloudflare\.com/.test(policy)) {
    fail('_headers: Turnstile ausente em frame-src.');
  }
}

const nexusAiCoreSource = await readFile(join(projectRoot, 'supabase', 'functions', 'nexus-ai-core', 'index.ts'), 'utf8');
if (!nexusAiCoreSource.includes("rpc('is_nexus_admin_aal2')")) {
  fail('supabase/functions/nexus-ai-core/index.ts: Nexus AI administrativa precisa exigir AAL2.');
}
if (/rpc\(['"]is_nexus_admin['"]/.test(nexusAiCoreSource)) {
  fail('supabase/functions/nexus-ai-core/index.ts: checagem administrativa AAL1 não pode substituir AAL2.');
}

const adminAal2GuardMigration = migrationFiles.find(file => file.endsWith('20260923235000_enforce_admin_aal2_rpc_guards.sql'));
if (!adminAal2GuardMigration) {
  fail('supabase/migrations: migration dos guards AAL2 administrativos ausente.');
} else {
  const adminAal2Source = await readFile(adminAal2GuardMigration, 'utf8');
  for (const requiredGuard of [
    'public.admin_mfa_gate()',
    'public.configure_nexus_account(',
    'public.enforce_nexus_admin_recent_mfa_on_organization_create()',
    'public.enforce_nexus_admin_recent_mfa_on_profile_context_change()',
    'public.is_nexus_admin_aal2()',
  ]) {
    if (!adminAal2Source.includes(requiredGuard)) {
      fail(`migration AAL2 administrativa: proteção ausente: ${requiredGuard}`);
    }
  }
}

const crossTenantAal2Migration = migrationFiles.find(file => file.endsWith('20260924002000_harden_cross_tenant_admin_aal2.sql'));
if (!crossTenantAal2Migration) {
  fail('supabase/migrations: hardening AAL2 cross-tenant ausente.');
} else {
  const crossTenantAal2Source = await readFile(crossTenantAal2Migration, 'utf8');
  for (const sensitivePolicy of [
    'nexus admin read audit logs',
    'nexus admin read all profiles',
    'nexus admins read support requests',
    'nexus admins update support requests',
    'sst documents tenant select',
    'sst documents tenant insert',
    'sst documents tenant update',
    'sst documents tenant delete',
  ]) {
    if (!crossTenantAal2Source.includes(sensitivePolicy)) {
      fail(`migration AAL2 cross-tenant: policy sensível ausente: ${sensitivePolicy}`);
    }
  }
  if (!crossTenantAal2Source.includes('public.is_nexus_admin_aal2()')) {
    fail('migration AAL2 cross-tenant: bypass global ainda não exige AAL2.');
  }
}

const stripeCreateCheckoutSource = await readFile(join(projectRoot, 'supabase', 'functions', 'stripe-create-checkout', 'index.ts'), 'utf8');
for (const requiredCheckoutGuard of [
  "profile.role === 'nexus_admin' && access.organization_id !== profile.organization_id",
  "rpc('is_nexus_admin_aal2')",
  'Confirme a autenticação em duas etapas para gerar cobranças de outra empresa.',
]) {
  if (!stripeCreateCheckoutSource.includes(requiredCheckoutGuard)) {
    fail(`stripe-create-checkout: proteção AAL2 cross-tenant ausente: ${requiredCheckoutGuard}`);
  }
}

const smoothServiceSource = await readFile(join(projectRoot, 'supabase', 'functions', 'smooth-service', 'index.ts'), 'utf8');
if (!smoothServiceSource.includes('status: 410')) {
  fail('supabase/functions/smooth-service/index.ts: endpoint legado precisa permanecer desativado com 410.');
}

const sstCrossTenantMigration = migrationFiles.find(file => file.endsWith('20260924104500_require_aal2_for_sst_cross_tenant_admin.sql'));
if (!sstCrossTenantMigration) {
  fail('supabase/migrations: hardening AAL2 cross-tenant do SST ausente.');
} else {
  const sstCrossTenantSource = await readFile(sstCrossTenantMigration, 'utf8');
  for (const protectedTable of [
    'employees',
    'exam_catalog',
    'exam_records',
    'exam_evaluation_rules',
    'training_catalog',
    'training_records',
    'sectors',
    'sector_exam_requirements',
    'job_roles',
    'occurrences',
    'occurrence_types',
  ]) {
    if (!sstCrossTenantSource.includes(protectedTable)) {
      fail(`migration AAL2 SST: proteção cross-tenant ausente para ${protectedTable}.`);
    }
  }
  if (!sstCrossTenantSource.includes('as restrictive')
    || !sstCrossTenantSource.includes('public.is_nexus_admin_aal2()')) {
    fail('migration AAL2 SST: policies precisam ser RESTRICTIVE e exigir AAL2.');
  }
}

const smartProcessorSource = await readFile(join(projectRoot, 'supabase', 'functions', 'smart-processor', 'index.ts'), 'utf8');
if (!smartProcessorSource.includes('status: 410')) {
  fail('supabase/functions/smart-processor/index.ts: endpoint legado de provisionamento precisa permanecer desativado com 410.');
}

const commercialReadAal2Migration = migrationFiles.find(file => file.endsWith('20260924113000_require_aal2_for_commercial_read_access.sql'));
if (!commercialReadAal2Migration) {
  fail('supabase/migrations: hardening AAL2 de leitura comercial/financeira ausente.');
} else {
  const commercialReadSource = await readFile(commercialReadAal2Migration, 'utf8');
  for (const protectedTable of [
    'nexus_sales',
    'organization_product_access',
    'nexus_payment_checkouts',
    'nexus_payments',
    'nexus_payment_webhook_events',
  ]) {
    if (!commercialReadSource.includes(protectedTable)) {
      fail(`migration AAL2 comercial: proteção de leitura ausente para ${protectedTable}.`);
    }
  }
  if (!commercialReadSource.includes('as restrictive')
    || !commercialReadSource.includes('public.is_nexus_admin_aal2()')) {
    fail('migration AAL2 comercial: policies precisam ser RESTRICTIVE e exigir AAL2.');
  }
}

const legacyCrmLeadSource = await readFile(join(projectRoot, 'supabase', 'functions', 'nexus-public-crm-lead', 'index.ts'), 'utf8');
const legacyCrmSalesSource = await readFile(join(projectRoot, 'supabase', 'functions', 'nexus-public-crm-sales', 'index.ts'), 'utf8');
if (!legacyCrmLeadSource.includes('status: 410')) {
  fail('nexus-public-crm-lead precisa permanecer desativado com 410.');
}
if (!legacyCrmSalesSource.includes('status: 410')) {
  fail('nexus-public-crm-sales precisa permanecer desativado com 410.');
}

const remainingSensitiveReadMigration = migrationFiles.find(file => file.endsWith('20260924122000_require_aal2_for_remaining_sensitive_reads.sql'));
if (!remainingSensitiveReadMigration) {
  fail('supabase/migrations: hardening AAL2 das leituras sensíveis restantes ausente.');
} else {
  const remainingSensitiveReadSource = await readFile(remainingSensitiveReadMigration, 'utf8');
  for (const protectedTable of [
    'company_documents',
    'epi_deliveries',
    'epi_purchases',
    'notification_alert_states',
    'notification_delivery_logs',
    'notification_email_preferences',
    'regulatory_inspections',
    'regulatory_requirements',
    'units',
    'organizations',
    'organization_memberships',
    'nexus_ai_usage_events',
    'nexus_ai_user_access',
    'nexus_accounts',
    'nexus_account_organizations',
    'nexus_account_users',
  ]) {
    if (!remainingSensitiveReadSource.includes(protectedTable)) {
      fail(`migration AAL2 leituras sensíveis: proteção ausente para ${protectedTable}.`);
    }
  }
  if (!remainingSensitiveReadSource.includes('as restrictive')
    || !remainingSensitiveReadSource.includes('public.is_nexus_admin_aal2()')) {
    fail('migration AAL2 leituras sensíveis: policies precisam ser RESTRICTIVE e exigir AAL2.');
  }
}

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const supabaseVersion = packageJson.dependencies?.['@supabase/supabase-js'];
if (!/^\d+\.\d+\.\d+$/.test(supabaseVersion || '')) {
  fail('package.json: @supabase/supabase-js precisa usar versão exata.');
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Security checks passed.');
}
