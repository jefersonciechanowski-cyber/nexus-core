import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/central-integrity-safe-diagnostics.py', import.meta.url));
test('reports only predefined metric names, never counts or status contents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-metrics-test-'));
  try {
    const src = join(dir, 'src.csv'), dst = join(dir, 'dst.csv');
    writeFileSync(src, ['count|organizations|13', 'state|access_status:private-customer-metadata|5', 'link_integrity|account_user_link_missing|0'].join('\n'));
    writeFileSync(dst, ['count|organizations|12', 'state|access_status:private-customer-metadata|4', 'link_integrity|account_user_link_missing|0'].join('\n'));
    const p = spawnSync('python3', [script, src, dst], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /integrity_mismatch_groups=count,state/);
    assert.match(p.stdout, /integrity_changed_count_metrics=organizations/);
    assert.match(p.stdout, /integrity_changed_state_metric_count=1/);
    assert.doesNotMatch(p.stdout, /private-customer-metadata/);
    assert.doesNotMatch(p.stdout, /\b12\b|\b13\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strict semantic comparison accepts psql ordering/line ending differences only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-metrics-verify-'));
  try {
    const src = join(dir, 'src.csv'), dst = join(dir, 'dst.csv');
    writeFileSync(src, 'count|organizations|13\ncount|accounts|8\n');
    writeFileSync(dst, 'count|accounts|8\r\ncount|organizations|13\r\n');
    const good = spawnSync('python3', [script, 'verify', src, dst], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /PASS: all structured operational metrics are equal/);
    writeFileSync(dst, 'count|accounts|8\ncount|organizations|12\n');
    const bad = spawnSync('python3', [script, 'verify', src, dst], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.doesNotMatch(bad.stdout, /organizations|\b12\b|\b13\b/);
    writeFileSync(dst, 'not a valid metric');
    const malformed = spawnSync('python3', [script, 'verify', src, dst], { encoding: 'utf8' });
    assert.equal(malformed.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
