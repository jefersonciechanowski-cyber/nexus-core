import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyCheckoutBridgeSignature } from '../supabase/functions/nexus-crm-bridge-diagnostic/signature.mjs';

const handler = readFileSync(new URL('../supabase/functions/nexus-crm-bridge-diagnostic/index.ts', import.meta.url), 'utf8');
const key = 'fake-offline-only-key-with-at-least-32-characters';
const now = 1793178000000;
const body = JSON.stringify({ purpose: 'nexus-crm-central-hmac-diagnostic-v1', nonce: '0123456789abcdef0123456789abcdef' });
const sign = (raw = body, at = now, secret = key) => createHmac('sha256', secret).update(String(at) + '.' + raw).digest('hex');

test('the diagnostic verifies the same signed challenge as the CRM server without reading payment data', async () => {
  assert.equal(await verifyCheckoutBridgeSignature(body, String(now), sign(), key, now), true);
  assert.equal(await verifyCheckoutBridgeSignature(body, String(now), sign(), 'a-different-key-with-32-chars-abcdefgh', now), false);
  assert.equal(await verifyCheckoutBridgeSignature(body, String(now), sign(), key, now + 300001), false);
  assert.equal(await verifyCheckoutBridgeSignature(JSON.stringify({purpose:'other',nonce:'0123456789abcdef0123456789abcdef'}), String(now), sign(), key, now), false);
  assert.match(handler, /EXPECTED_PURPOSE = 'nexus-crm-central-hmac-diagnostic-v1'/);
  assert.match(handler, /EXPECTED_ORIGIN = 'https:\/\/crm[.]nexuscore[.]app[.]br'/);
  assert.match(handler, /verifyCheckoutBridgeSignature\(raw, timestamp, signature, secret\)/);
  assert.match(handler, /NEXUS_CRM_CHECKOUT_BRIDGE_SECRET/);
  assert.match(handler, /status: 'connected', nonce: data[.]nonce/);
  assert.match(handler, /Object[.]keys\(data\)[.]length !== 2/);
  assert.match(handler, /size > 256/);
  assert.doesNotMatch(handler, /stripe[.]checkout[.]sessions|from\(['"]nexus_sales['"]\)|createClient\(|grantTrial|provisionCrmTenant/);
});
