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
      if (!tag.includes(' integrity="sha384-') || !tag.includes(' crossorigin="anonymous"')) {
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

const reportHardeningMigrations = migrationFiles.filter(file => file.endsWith('_security_report_hardening.sql'));
if (reportHardeningMigrations.length !== 1) {
  fail('supabase/migrations: migration de hardening do relatório externo ausente ou duplicada.');
} else {
  const source = await readFile(reportHardeningMigrations[0], 'utf8');
  for (const requiredGuard of [
    'revoke usage on schema public from anon;',
    'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;',
    'alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;',
    'has_recent_nexus_admin_mfa_session',
    'nexus_accounts_require_recent_admin_mfa',
    'nexus_ai_usage_require_recent_admin_mfa',
    'profiles_require_recent_admin_mfa',
    'organizations_require_recent_admin_mfa',
    'drop policy if exists "tenant delete" on public.exam_records;',
  ]) {
    if (!source.includes(requiredGuard)) {
      fail(`migration do relatório externo: proteção ausente: ${requiredGuard}`);
    }
  }
}

const authSource = await readFile(join(projectRoot, 'apps', 'sst-controle', 'supabase-auth.js'), 'utf8');
if (authSource.includes('select.innerHTML') || authSource.includes('panel.innerHTML')) {
  fail('apps/sst-controle/supabase-auth.js: dados de organização ainda entram por innerHTML.');
}

for (const passwordPage of [
  join(projectRoot, 'apps', 'portal-cliente', 'redefinir-senha.html'),
  join(projectRoot, 'apps', 'sst-controle', 'alterar-senha.html'),
]) {
  const source = await readFile(passwordPage, 'utf8');
  if (!source.includes('minlength="14"') || !/length\s*<\s*14/.test(source)) {
    fail(`${relative(projectRoot, passwordPage)}: senha mínima de 14 caracteres não está aplicada no formulário e na validação.`);
  }
}

const privacySource = await readFile(join(projectRoot, 'apps', 'site-captacao', 'privacidade.html'), 'utf8');
for (const requiredPrivacySection of ['Bases legais', 'Papéis no tratamento de dados', 'Direitos dos titulares', 'Retenção e eliminação']) {
  if (!privacySource.includes(requiredPrivacySection)) {
    fail(`privacidade.html: seção LGPD ausente: ${requiredPrivacySection}.`);
  }
}

const headers = await readFile(join(projectRoot, '_headers'), 'utf8');
for (const requiredHeader of ['Content-Security-Policy:', 'Strict-Transport-Security:', 'X-Content-Type-Options:']) {
  if (!headers.includes(requiredHeader)) fail(`_headers: cabeçalho ausente: ${requiredHeader}`);
}
for (const sensitivePath of ['/apps/nexus-admin/*', '/apps/portal-cliente/*', '/apps/sst-controle/login.html', '/apps/sst-controle/alterar-senha.html']) {
  const start = headers.indexOf(sensitivePath);
  if (start < 0) {
    fail(`_headers: regra sensível ausente: ${sensitivePath}`);
    continue;
  }
  const nextSection = headers.indexOf('\n/', start + sensitivePath.length);
  const block = headers.slice(start, nextSection > start ? nextSection : headers.length);
  if (!block.includes('Cache-Control: no-store, private')) {
    fail(`_headers: página sensível sem no-store: ${sensitivePath}`);
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
