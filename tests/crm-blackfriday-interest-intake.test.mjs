import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const intake = readFileSync(new URL("../supabase/functions/nexus-public-crm-intake/index.ts", import.meta.url), "utf8");
const honeypot = readFileSync(new URL("../supabase/functions/nexus-public-crm-intake/honeypot.mjs", import.meta.url), "utf8");

test("Black Friday interest intake is authenticated by origin + rate limits, but cannot charge", () => {
  assert.match(intake, /const ORIGIN = 'https:\/\/crm\.nexuscore\.app\.br'/);
  assert.match(intake, /allowedOrigins\(\)\.has\(origin\)/);
  assert.match(intake, /if \(total > 16_384\) return null/);
  assert.match(intake, /consume_nexus_public_request_limit/);
  assert.match(intake, /isHoneypotFilled\(body\)/);
  assert.match(intake, /if \(annualInterest && \(body\.acceptedContact !== true \|\| !planCode\)\)/);
  assert.match(intake, /sale_status: 'lead'/);
  assert.match(intake, /lead_stage: 'new'/);
  assert.match(intake, /provider: 'asaas'/);
  assert.doesNotMatch(intake, /provider: 'stripe'/);
  assert.doesNotMatch(intake, /\/v3\/paymentLinks|\/v3\/payments|checkout\.sessions|provisionCrm/);
  assert.match(honeypot, /isHoneypotFilled/);
});

test("Black Friday annual interest is differentiated from normal demo and tracks campaigns", () => {
  assert.match(intake, /offerKind === 'black_friday_annual'/);
  assert.match(intake, /plan\.public_visible !== true/);
  assert.match(intake, /plan\.billing_interval_months !== 1/);
  assert.match(intake, /annualInterest \? 'prepaid' : 'recurring'/);
  assert.match(intake, /annualInterest \? 12 : 1/);
  assert.match(intake, /crm-bf-interest-/);
  assert.match(intake, /crm-demo-/);
  assert.match(intake, /\['Interesse', annualInterest \? 'Black Friday Nexus CRM - plano anual'/);
  assert.match(intake, /utmCampaign/);
  assert.match(intake, /utmSource/);
  assert.match(intake, /utmMedium/);
  assert.match(intake, /utmContent/);
  assert.match(intake, /utmTerm/);
  assert.match(intake, /return answer\(\{ ok: true \}, 200, origin\)/);
});
