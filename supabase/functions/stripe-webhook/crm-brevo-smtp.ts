// CRM-only SMTP transport. Never expose credentials or send from the browser.
// Port 2525 avoids blocked SMTP ports; enforce STARTTLS and the Brevo hostname.
// This helper never creates customers, tokens, subscriptions, or invoices.
import nodemailer from 'npm:nodemailer@10.3.1';

const HOST = 'smtp-relay.brevo.com';
const PORT = 2525;
type MailInput = {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent: string;
};
type MailResult = { sent: boolean; reason: string; messageId: string | null };
type SMTPStatus = 'missing_configuration' | 'smtp_authenticated'
  | 'smtp_invalid_credentials' | 'smtp_connection_failed' | 'smtp_unavailable';

function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readConfiguration() {
  const user = (Deno.env.get('BREVO_CRM_SMTP_USER') || '').trim();
  const pass = Deno.env.get('BREVO_CRM_SMTP_KEY') || '';
  const host = (Deno.env.get('BREVO_CRM_SMTP_HOST') || '').trim().toLowerCase();
  const port = Number(Deno.env.get('BREVO_CRM_SMTP_PORT') || '');
  const from = (Deno.env.get('BREVO_FROM_EMAIL') || '').trim();
  if (!validEmail(user) || pass.length < 12 || host !== HOST || port !== PORT
    || !validEmail(from) || /[\r\n]/.test(pass)) return null;
  return { user, pass, from };
}

function transport(config: NonNullable<ReturnType<typeof readConfiguration>>) {
  return nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: false,
    requireTLS: true,
    tls: {
      servername: HOST,
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 10000,
    pool: false,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

function smtpErrorReason(error: unknown): SMTPStatus {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; responseCode?: unknown }
    : {};
  if (candidate.code === 'EAUTH' || candidate.responseCode === 535) {
    return 'smtp_invalid_credentials';
  }
  if (['ETIMEDOUT','ECONNECTION','ESOCKET','ECONNREFUSED','ENOTFOUND'].includes(String(candidate.code))) {
    return 'smtp_connection_failed';
  }
  return 'smtp_unavailable';
}

// Establishes a TLS-authenticated SMTP session only. DOES NOT send MAIL FROM,
// RCPT TO or DATA, create a first-access link, or expose account credentials.
export async function verifyCrmSmtp(): Promise<{
  status: SMTPStatus; credentialsConfigured: boolean; senderConfigured: boolean;
}> {
  const config = readConfiguration();
  if (!config) return {
    status: 'missing_configuration', credentialsConfigured: false,
    senderConfigured: validEmail((Deno.env.get('BREVO_FROM_EMAIL') || '').trim()),
  };
  const client = transport(config);
  try {
    await client.verify();
    return { status: 'smtp_authenticated', credentialsConfigured: true, senderConfigured: true };
  } catch (error) {
    return { status: smtpErrorReason(error), credentialsConfigured: true, senderConfigured: true };
  } finally {
    client.close();
  }
}

// Sends only from the existing server-side CRM provisioning flows.
// Caller must already have verified payment and allocated the correct tenant.
export async function sendCrmSmtpMail(mail: MailInput): Promise<MailResult> {
  const config = readConfiguration();
  if (!config) return { sent: false, reason: 'smtp_configuration_missing', messageId: null };
  if (!validEmail(mail.toEmail) || !mail.subject.trim() || !mail.htmlContent.trim()) {
    return { sent: false, reason: 'smtp_message_invalid', messageId: null };
  }
  const client = transport(config);
  try {
    const result = await client.sendMail({
      from: { name: 'Nexus Core', address: config.from },
      to: { name: (mail.toName || '').slice(0, 140), address: mail.toEmail },
      subject: mail.subject.slice(0, 180),
      html: mail.htmlContent,
      text: 'Seu acesso ao Nexus CRM foi criado. Abra esta mensagem em um cliente de e-mail compatível com HTML.',
    });
    const accepted = Array.isArray(result.accepted) ? result.accepted : [];
    const sent = accepted.some(value => typeof value === 'string'
      && value.trim().toLowerCase() === mail.toEmail.trim().toLowerCase());
    return {
      sent, reason: sent ? 'smtp_accepted' : 'smtp_recipient_not_accepted',
      messageId: sent ? String(result.messageId || '').slice(0, 255) || null : null,
    };
  } catch (error) {
    return { sent: false, reason: smtpErrorReason(error), messageId: null };
  } finally {
    client.close();
  }
}
