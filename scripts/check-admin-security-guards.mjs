import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const read = (...parts) => readFile(join(root, ...parts), 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) failures.push(`${label}: proteção ausente: ${text}`);
}

const [pilot, ai, stripeWebhook, asaasWebhook, publicSales, migration, headers, auth] = await Promise.all([
  read('supabase', 'functions', 'nexus-admin-pilot', 'index.ts'),
  read('supabase', 'functions', 'nexus-ai-core', 'index.ts'),
  read('supabase', 'functions', 'stripe-webhook', 'index.ts'),
  read('supabase', 'functions', 'asaas-webhook', 'index.ts'),
  read('supabase', 'functions', 'nexus-public-sales', 'index.ts'),
  read('supabase', 'migrations', '20260821133649_security_wrap_privileged_rpcs_with_admin_mfa.sql'),
  read('_headers'),
  read('apps', 'sst-controle', 'supabase-auth.js'),
]);

for (const [source, label] of [[pilot, 'nexus-admin-pilot'], [ai, 'nexus-ai-core']]) {
  requireText(source, "userClient.rpc('is_nexus_admin')", label);
  requireText(source, 'adminMfa !== true', label);
}

requireText(ai, 'MAX_BODY_BYTES = 16_384', 'nexus-ai-core');
requireText(ai, "'Cache-Control': 'no-store'", 'nexus-ai-core');
requireText(ai, "profile.role !== 'nexus_admin'", 'nexus-ai-core');
requireText(pilot, "adminProfile.role !== 'nexus_admin'", 'nexus-admin-pilot');

for (const guard of [
  'ADMIN_MFA_MAX_AGE_SECONDS = 7200',
  'getAuthenticatorAssuranceLevel',
  "sessionStorage.getItem('nexus_admin_mfa_session')",
  'return enforceAdminMfaSession(session);',
  "sessionStorage.removeItem('nexus_admin_mfa_session')",
]) {
  requireText(auth, guard, 'supabase-auth admin MFA');
}

requireText(stripeWebhook, "request.headers.get('stripe-signature')", 'stripe-webhook');
requireText(stripeWebhook, 'constructEventAsync', 'stripe-webhook');
requireText(stripeWebhook, 'STRIPE_WEBHOOK_SECRET', 'stripe-webhook');
requireText(asaasWebhook, 'status: 410', 'asaas-webhook');

for (const guard of [
  'contentLength > 65_536',
  'consumeRateLimit',
  'originAllowed',
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
