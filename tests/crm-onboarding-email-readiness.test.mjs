import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/nexus-admin-crm-email-health/index.ts',import.meta.url),'utf8');
const pilot=readFileSync(new URL('../supabase/functions/nexus-admin-crm-live-pix-pilot/index.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.html',import.meta.url),'utf8');
const controls=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.js',import.meta.url),'utf8');

test('only active Nexus admin with AAL2 can read email configuration',()=>{
 assert.match(source,/userClient\.auth\.getUser\(\)/);
 assert.match(source,/getAuthenticatorAssuranceLevel\(accessToken\)/);
 assert.match(source,/level\?\.currentLevel !== 'aal2'/);
 assert.match(source,/profile\?\.role !== 'nexus_admin'/);
 assert.match(source,/profile\.active !== true/);
 assert.match(source,/ORIGINS\.has\(origin\)/);
 assert.match(source,/request\.method !== 'POST'/);
 assert.match(source,/Object\.keys\(body\)\.length !== 1/);
 assert.match(source,/body as Record<string,unknown>\)\.action !== 'check'/);
});
test('Brevo check is read-only; no emails, no payment and no credentials leaked',()=>{
 assert.match(source,/https:\/\/api\.brevo\.com\/v3\/senders/);
 assert.match(source,/method:'GET'/);
 assert.match(source,/Deno\.env\.get\('BREVO_API_KEY'\)/);
 assert.match(source,/Deno\.env\.get\('BREVO_FROM_EMAIL'\)/);
 assert.match(source,/status:match\?\.active===true/);
 assert.match(source,/emailSent:false/);
 assert.doesNotMatch(source,/\/smtp\/email|\/payments|\/customers|createUser|insert\(|upsert\(|update\(|delete\(/);
 assert.doesNotMatch(source,/console\.(log|warn|error)|JSON\.stringify\(data\)/);
 assert.doesNotMatch(source,/return reply\(\{\s*sender[,}]/);
});
test('admin page displays diagnostic, not secrets, and does not send email from browser',()=>{
 assert.match(ui,/id="emailCheck"/);
 assert.match(ui,/id="emailCheckResult"/);
 assert.match(controls,/nexus-admin-crm-email-health/);
 assert.match(controls,/body:\{action:'check'\}/);
 assert.match(controls,/await checkEmailReadiness\(\)/);
 assert.match(controls,/Brevo/);
 assert.match(controls,/Esta verificação não criou nova cobrança/);
 assert.doesNotMatch(ui,/BREVO_API_KEY|SUPABASE_SERVICE_ROLE_KEY|token_hash/);
 assert.doesNotMatch(controls,/BREVO_API_KEY|SUPABASE_SERVICE_ROLE_KEY|token_hash/);
});
test('successful provisioning is not rolled back for email transport failures',()=>{
 assert.match(pilot,/type PilotEmailResult = \{ sent:boolean; reason:string \}/);
 assert.match(pilot,/brevo_configuration_missing/);
 assert.match(pilot,/brevo_http_/);
 assert.match(pilot,/brevo_request_failed/);
 assert.match(pilot,/NEXUS_CRM_LIVE_PIX_PILOT_EMAIL_/);
 assert.match(pilot,/emailResult\.sent/);
 assert.match(pilot,/\.catch\(\(\) => \{ \/\* Never fail provisioning due to diagnostic audit unavailability/);
 assert.match(pilot,/onboardingEmailSent:emailResult\.sent/);
 assert.doesNotMatch(pilot,/console\.log\(.*firstAccessUrl/);
});
