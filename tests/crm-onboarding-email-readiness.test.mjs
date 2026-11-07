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
test('Brevo CRM diagnosis authenticates via SMTP without sending a message',()=>{
 assert.match(source,/verifyCrmSmtp\(\)/);
 assert.match(source,/senderActive: false/);
 assert.match(source,/emailSent: false/);
 assert.doesNotMatch(source,/sendCrmSmtpMail\(|\/v3\/smtp\/email|\/v3\/senders/);
 assert.doesNotMatch(source,/console\.(log|warn|error)|token_hash/);
 assert.match(source,/profile\?\.role !== 'nexus_admin'/);
});
test('admin page displays diagnostic, not secrets, and does not send email from browser',()=>{
 assert.match(ui,/id="emailCheck"/);
 assert.match(ui,/id="emailCheckResult"/);
 assert.match(controls,/nexus-admin-crm-email-health/);
 assert.match(controls,/body:\{action:'check'\}/);
 assert.match(controls,/await checkEmailReadiness\(\)/);
 assert.match(controls,/Brevo|SMTP/);
 assert.match(controls,/Esta verificação não criou nova cobrança/);
 assert.doesNotMatch(ui,/BREVO_(?:CRM_)?API_KEY|SUPABASE_SERVICE_ROLE_KEY|token_hash/);
 // Secret *names* in safe guidance are okay, but the browser must not
 // access environment values, HTTP API keys, or first-access tokens.
 assert.doesNotMatch(controls,/Deno\.env\.get\(|api-key\s*:|token_hash|SUPABASE_SERVICE_ROLE_KEY/);
});
test('paid Pix pilot uses exclusive SMTP; no raw API key or email resend',()=>{
 assert.match(pilot,/sendCrmSmtpMail\(\{/);
 assert.doesNotMatch(pilot,/Deno\.env\.get\('BREVO_(?:CRM_)?API_KEY'\)/);
 assert.match(pilot,/NEXUS_CRM_LIVE_PIX_PILOT_EMAIL_/);
 assert.match(pilot,/emailResult\.sent/);
 assert.match(pilot,/onboardingEmailSent:emailResult\.sent/);
 assert.match(pilot,/access_link_unrecognized/);
 assert.doesNotMatch(pilot,/\/v3\/smtp\/email|console\.log\(.*firstAccessUrl/);
});
