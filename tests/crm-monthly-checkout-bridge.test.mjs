import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyCheckoutBridgeSignature } from '../supabase/functions/nexus-public-crm-monthly-checkout/signature.mjs';

const secret = 'stage4-security-test-only-not-a-real-secret-0123456789';
const samplePayload = { companyName: 'Empresa Teste', planCode: 'start', acceptedTerms: true };
const timestamp = '1792796400000'; // fixed timestamp for deterministic offline test
const now = Number(timestamp);
const body = JSON.stringify(samplePayload);
function sign(time, raw) {
  return createHmac('sha256', secret).update(time + '.' + raw).digest('hex');
}

test('Next.js Node HMAC signature is accepted by the Central WebCrypto verifier', async () => {
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), secret, now), true);
});

test('mutation of plan, company or accepted terms invalidates signature', async () => {
  for (const value of [
    JSON.stringify({ ...samplePayload, planCode: 'gestao' }),
    JSON.stringify({ ...samplePayload, companyName: 'Falsificado' }),
    JSON.stringify({ ...samplePayload, acceptedTerms: false }),
  ]) {
    assert.equal(await verifyCheckoutBridgeSignature(value, timestamp, sign(timestamp, body), secret, now), false);
  }
});

test('replayed, future, malformed and wrong-key signatures are rejected', async () => {
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), secret, now + 300_001), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), secret, now - 300_001), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), secret, now + 300_000), true);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), secret, now - 300_000), true);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), 'another-bridge-secret-012345678901234567890', now), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, 'bad', sign(timestamp, body), secret, now), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, 'invalid-signature', secret, now), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, timestamp, sign(timestamp, body), 'short', now), false);
});
