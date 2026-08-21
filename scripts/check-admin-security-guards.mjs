import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) failures.push(`${label}: proteção ausente: ${text}`);
}

const [pilot, ai, stripeWebhook, asaasWebhook, publicSales, migration, headers] = await Promise.all([
  read('supabase', 'functions', 'nexus-admin-pilot', 'index.ts'),
  read('supabase', 'functions', 'nexus-ai-core', 'index.ts'),
  read('supabase', 'functions', 'stripe-webhook', 'index.ts'),
  read('supabase', 'functions', 'asaas-webhook', 'index.ts'),
  read('supabase', 'functions', 'nexus-public-sales', 'index.ts'),
  read('supabase', 'migrations', '20260821_security_wrap_privileged_rpcs_with_admin_mfa.sql'),
  read('_headers'),
]);

for (const [source, label] of [[pilot, 'nexus-admin-pilot'], [ai, 'nexus-ai-core']]) {
  requireText(source, "userClient.rpc('is_nexus_admin')", label);
  requireText(source, 'adminMfa !== true', label);
}

requireText(ai, 'MAX_BODY_BYTES = 16_384', 'nexus-ai-core');
requireText(ai, "'Cache-Control': 'no-store'", 'nexus-ai-core');
requireText(ai, "profile.role !== 'nexus_admin'", 'nexus-ai-core');
requireText(pilot, "adminProfile.role !== 'nexus_admin'", 'nexus-admin-pilot');

requireText(stripeWebhook, "request.headers.get('stripe-signature')", 'stripe-webhook');
requireText(stripeWebhook, 'constructEventAsync', 'stripe-webhook');
requireText(stripeWebhook, 'STRIPE_WEBHOOK_SECRET', 'stripe-webhook');
requireText(asaasWebhook, 'status: 410', 'asaas-webhook');

for (const guard of [
  'MAX_BODY_BYTES',
  'consumePublicRateLimit',
  'allowedOrigin',
  'honeypot',
]) {
  requireText(publicSales, guard, 'nexus-public-sales');
}

for (const guard of [
  'admin_mfa_gate',
  'create_managed_organization_core',
  'switch_organization_core',
  'get_my_nexus_account_summary_core',
  'get_my_organizations_core',
  'revoke all on function public.create_managed_organization_core',
  'revoke all on function public.switch_organization_core',
]) {
  requireText(migration, guard, 'migration MFA');
}

for (const header of [
  'Content-Security-Policy:',
  'Strict-Transport-Security:',
  'X-Frame-Options: DENY',
  'X-Content-Type-Options: nosniff',
  'Referrer-Policy:',
  'Permissions-Policy:',
]) {
  requireText(headers, header, '_headers');
}

if (failures.length) {
  console.error(failures.map(item => `- ${item}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Admin security guard checks passed.');
}
