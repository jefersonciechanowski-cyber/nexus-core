import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/nexus-public-crm-intake/index.ts', import.meta.url), 'utf8');

test('CRM demo intake is off by default and never creates checkout', () => {
  assert.match(source, /NEXUS_CRM_DEMO_INTAKE_ENABLED/);
  assert.match(source, /=== 'true'/);
  assert.match(source, /sale_status: 'lead'/);
  assert.doesNotMatch(source, /checkout\.sessions\.create|createSubscription/);
});

test('CRM demo intake restricts origin and request content', () => {
  assert.match(source, /https:\/\/crm\.nexuscore\.app\.br/);
  assert.match(source, /allowedOrigins\(\)\.has\(origin\)/);
  assert.match(source, /total > 16_384/);
  assert.match(source, /'application\/json'/);
  assert.match(source, /body\.website/);
});

test('CRM demo intake is product-scoped with rate limit and duplicate protection', () => {
  assert.match(source, /\.eq\('code', 'crm'\)/);
  assert.match(source, /consume_nexus_public_request_limit/);
  assert.match(source, /p_limit: 5/);
  assert.match(source, /\.eq\('email', email\)\.gte\('created_at', recent\)/);
  assert.match(source, /employee_count: null/);
});

test('CRM demo intake saves campaign metadata, not fake advertisement identifiers', () => {
  assert.match(source, /campaign_name: campaign \|\| null/);
  assert.match(source, /utmSource/);
  assert.match(source, /utmMedium/);
  assert.match(source, /utmContent/);
  assert.match(source, /referrer/);
  assert.doesNotMatch(source, /ad_name: clean\(body\.utmContent/);
});
