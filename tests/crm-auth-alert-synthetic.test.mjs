import test from 'node:test';
import assert from 'node:assert/strict';

// Exact interpretation of the running CRM auth monitor's aggregate-only rule.
// Inputs below are entirely synthetic; no Supabase project is contacted.
const monitoredPaths = new Set(['/auth/v1/token', '/auth/v1/recover', '/auth/v1/verify']);
const refusalStatuses = new Set([400, 401, 403, 422]);
const SYNTHETIC_MARKER = 'TESTE SINTÉTICO — NÃO É INCIDENTE REAL';

function matchingAlerts(entries) {
  const byRoute = new Map();
  for (const { path, status } of entries) {
    if (!monitoredPaths.has(path)) continue;
    const row = byRoute.get(path) ?? { route: path, rateLimited: 0, refused: 0 };
    if (status === 429) row.rateLimited += 1;
    if (refusalStatuses.has(status)) row.refused += 1;
    byRoute.set(path, row);
  }
  return [...byRoute.values()].filter(row => row.rateLimited >= 3 || row.refused >= 20);
}
const events = (path, status, n) => Array.from({ length: n }, () => ({ path, status }));

test('exact threshold: three 429 responses on the same route trigger alert', () => {
  assert.deepEqual(matchingAlerts(events('/auth/v1/token', 429, 3)), [
    { route: '/auth/v1/token', rateLimited: 3, refused: 0 }
  ]);
  assert.deepEqual(matchingAlerts(events('/auth/v1/token', 429, 2)), []);
});

test('exact threshold: twenty selected refusals trigger; nineteen do not', () => {
  assert.deepEqual(matchingAlerts(events('/auth/v1/recover', 401, 20)), [
    { route: '/auth/v1/recover', rateLimited: 0, refused: 20 }
  ]);
  assert.deepEqual(matchingAlerts(events('/auth/v1/recover', 401, 19)), []);
});

test('routes are independent and cannot be combined to manufacture an alert', () => {
  assert.deepEqual(matchingAlerts([
    ...events('/auth/v1/token', 429, 2),
    ...events('/auth/v1/verify', 429, 2),
    ...events('/auth/v1/recover', 403, 19),
    ...events('/billing', 429, 10),
  ]), []);
});

test('429 and refusal count are separate criteria, not an additive threshold', () => {
  assert.deepEqual(matchingAlerts([
    ...events('/auth/v1/token', 429, 2),
    ...events('/auth/v1/token', 403, 19)
  ]), []);
});

test('both limits produce only aggregated route and count, with no personal data', () => {
  const alerts = matchingAlerts([
    ...events('/auth/v1/verify', 429, 3),
    ...events('/auth/v1/token', 400, 20),
  ]);
  assert.equal(alerts.length, 2);
  for (const alert of alerts) {
    assert.deepEqual(Object.keys(alert).sort(), ['rateLimited', 'refused', 'route']);
    assert.ok(monitoredPaths.has(alert.route));
  }
  assert.ok(SYNTHETIC_MARKER.includes('NÃO É INCIDENTE REAL'));
});
