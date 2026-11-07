import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const transport = readFileSync(
 new URL('../supabase/functions/stripe-webhook/crm-brevo-smtp.ts',import.meta.url),'utf8'
);

test('CRM SMTP transport is dedicated, TLS-verified, host-restricted and timed out',()=>{
 for(const secret of ['BREVO_CRM_SMTP_USER','BREVO_CRM_SMTP_KEY','BREVO_CRM_SMTP_HOST','BREVO_CRM_SMTP_PORT']){
  assert.ok(transport.includes(secret),secret);
 }
 assert.match(transport,/nodemailer@10\.3\.1/);
 assert.match(transport,/const HOST = 'smtp-relay\.brevo\.com'/);
 assert.match(transport,/const PORT = 2525/);
 assert.match(transport,/requireTLS: true/);
 assert.match(transport,/rejectUnauthorized: true/);
 assert.match(transport,/minVersion: 'TLSv1\.2'/);
 assert.match(transport,/host !== HOST \|\| port !== PORT/);
 assert.match(transport,/connectionTimeout: 7000/);
 assert.match(transport,/disableUrlAccess: true/);
 assert.match(transport,/disableFileAccess: true/);
 assert.doesNotMatch(transport,/BREVO_API_KEY|RESEND_API_KEY|STRIPE_SECRET_KEY/);
});

test('SMTP read-only verification cannot send mail or expose credentials',()=>{
 const start=transport.indexOf('export async function verifyCrmSmtp');
 const end=transport.indexOf('export async function sendCrmSmtpMail');
 assert.ok(start>=0 && end>start);
 const verify=transport.slice(start,end);
 assert.match(verify,/await client\.verify\(\)/);
 assert.doesNotMatch(verify,/sendMail\(|smtp\/email|MAIL FROM|from:/);
 assert.doesNotMatch(verify,/console\.|JSON\.stringify/);
 assert.match(verify,/client\.close\(\)/);
});
test('sending requires caller-provided recipient and only returns sanitized delivery metadata',()=>{
 assert.match(transport,/validEmail\(mail\.toEmail\)/);
 assert.match(transport,/await client\.sendMail\(/);
 assert.match(transport,/accepted\.some\(/);
 assert.match(transport,/client\.close\(\)/);
 assert.match(transport,/smtpErrorReason\(error\)/);
 assert.doesNotMatch(transport,/console\./);
 assert.doesNotMatch(transport,/return \{ sent: [^}]*\bpass\b/);
});
