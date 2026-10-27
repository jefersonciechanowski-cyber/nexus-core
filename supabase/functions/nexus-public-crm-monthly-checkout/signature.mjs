// Shared verification of the server-to-server CRM checkout bridge.
// Stateless and usable by Deno, Node tests and workers; never exposed in browser.
export async function verifyCheckoutBridgeSignature(raw, timestamp, signature, secret, now = Date.now()) {
  if (typeof raw !== 'string' || typeof secret !== 'string' || secret.length < 32) return false;
  if (typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp)) return false;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const moment = Number(timestamp);
  if (!Number.isSafeInteger(moment) || Math.abs(now - moment) > 300_000) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const provided = Uint8Array.from(signature.match(/../g) || [], byte => Number.parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, provided, encoder.encode(timestamp + '.' + raw));
}
