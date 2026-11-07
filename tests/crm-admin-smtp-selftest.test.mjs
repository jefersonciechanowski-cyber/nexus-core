import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const fn=readFileSync(new URL('../supabase/functions/nexus-admin-crm-email-send-test/index.ts',import.meta.url),'utf8');
const health=readFileSync(new URL('../supabase/functions/nexus-admin-crm-email-health/index.ts',import.meta.url),'utf8');
const transport=readFileSync(new URL('../supabase/functions/stripe-webhook/crm-brevo-smtp.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.html',import.meta.url),'utf8');
const client=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.js',import.meta.url),'utf8');

test('sending test is separate from read-only SMTP verification',()=>{
 assert.match(health,/verifyCrmSmtp\(\)/);
 assert.doesNotMatch(health,/sendCrmSmtpMail\(|send_self_test/);
 assert.match(fn,/sendCrmSmtpMail\(\{/);
 assert.match(fn,/send_self_test/);
 assert.match(fn,/emailSent:sent\.sent/);
 assert.match(fn,/delivered:false/);
});

test('privileged admin must actively authorize own-email test with MFA2',()=>{
 assert.match(fn,/ORIGINS\.has\(origin\)/);
 assert.match(fn,/userClient\.auth\.getUser\(\)/);
 assert.match(fn,/getAuthenticatorAssuranceLevel\(accessToken\)/);
 assert.match(fn,/level\?\.currentLevel !== 'aal2'/);
 assert.match(fn,/profile\?\.role !== 'nexus_admin'/);
 assert.match(fn,/profile\.active !== true/);
 assert.match(fn,/const recipient = String\(user\.email \|\| ''\)/);
 assert.match(fn,/toEmail:recipient/);
 assert.doesNotMatch(fn,/body\.toEmail|body\.email|body\.recipient|body\.to/);
 assert.match(client,/confirm\('Confirma enviar UM e-mail de teste/);
 assert.match(client,/body:\{action:'send_self_test'\}/);
 assert.match(ui,/id="emailSendTest"/);
 assert.match(ui,/id="emailSendTestResult"/);
 assert.match(ui,/type="button" disabled/);
});

test('test cannot create billing, CRM accounts, access links or repeat automatically',()=>{
 assert.match(fn,/INTERVAL_MS = 24 \* 60 \* 60 \* 1000/);
 assert.match(fn,/NEXUS_CRM_SMTP_SELF_TEST_ATTEMPT/);
 assert.match(fn,/\.gte\('created_at',since\)\.limit\(1\)/);
 assert.match(fn,/if \(recent\?\.length\)/);
 assert.ok(fn.indexOf("action:ATTEMPT_ACTION")<fn.indexOf("await sendCrmSmtpMail("));
 assert.doesNotMatch(fn,/firstAccessUrl|generateLink\(|createUser\(|\/payments|\/subscriptions|ASAAS_API_KEY|STRIPE_SECRET_KEY/);
 assert.doesNotMatch(fn,/console\.(log|warn|error)|JSON\.stringify\(user\)|metadata:\{.*recipient/);
 assert.match(fn,/Nenhuma cobrança, assinatura, usuário ou link de acesso foi criado/);
 assert.match(client,/dataset\.attempted='true'/);
 assert.doesNotMatch(client,/setInterval\(|setTimeout\(/);
});
test('dedicated sender supports non-misleading plain text test mail',()=>{
 assert.match(transport,/textContent\?: string/);
 assert.match(transport,/mail\.textContent \|\|/);
 assert.match(fn,/textContent:'Teste de e-mail do Nexus CRM/);
});
