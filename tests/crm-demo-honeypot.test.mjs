import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isHoneypotFilled, CRM_DEMO_HONEYPOT_KEYS } from '../supabase/functions/nexus-public-crm-intake/honeypot.mjs';

test('empty hidden fields do not block real demonstrations', () => {
  assert.deepEqual(CRM_DEMO_HONEYPOT_KEYS, ['website', 'crmHiddenSecurityField']);
  assert.equal(isHoneypotFilled({}), false);
  assert.equal(isHoneypotFilled({ website: '', crmHiddenSecurityField: '' }), false);
  assert.equal(isHoneypotFilled({ crmHiddenSecurityField: '   ' }), false);
});

test('legacy URL autofill and renamed hidden field are both rejected', () => {
  assert.equal(isHoneypotFilled({ website: 'https://example.test' }), true);
  assert.equal(isHoneypotFilled({ crmHiddenSecurityField: 'some autofill' }), true);
  assert.equal(isHoneypotFilled({ crmHiddenSecurityField: 5 }), true);
});

test('backend reports a rejection, never a false-positive success', () => {
  const source = requireSource();
  assert.match(source, /if \(isHoneypotFilled\(body\)\) \{/);
  assert.match(source, /crm_demo_intake_rejected_hidden_field/);
  assert.match(source, /422, origin/);
  assert.doesNotMatch(source, /if \(clean\(body\.website, 200\)\) return answer\(\{ ok: true \}, 200, origin\)/);
  assert.match(source, /if \(count && count > 0\) return answer\(\{ ok: true \}, 200, origin\)/);
  assert.match(source, /if \(insertError\.code === '23505'\) return answer\(\{ ok: true \}, 200, origin\)/);
});

function requireSource() {
  return import.meta.dirname
    ? readSource(new URL('../supabase/functions/nexus-public-crm-intake/index.ts', import.meta.url))
    : readSource(new URL('../supabase/functions/nexus-public-crm-intake/index.ts', import.meta.url));
}
function readSource(url) {
  return readFileSync(url, 'utf8');
}
