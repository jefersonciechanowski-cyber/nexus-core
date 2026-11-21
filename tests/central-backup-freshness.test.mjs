import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('../scripts/check-central-backup-freshness.py', import.meta.url));
const now = '2026-11-21T16:00:00Z';
const backup = { id: 123, status: 'completed', conclusion: 'success', head_branch: 'main', updated_at: '2026-11-21T15:20:00Z' };
const restore = { id: 456, status: 'completed', conclusion: 'success', head_branch: 'main', updated_at: '2026-11-21T15:40:00Z' };
function run(b=backup, c=restore, artifacts=[{name:'central-validated-encrypted-backup-123',expired:false,size_in_bytes:2000}]) {
  const temp = mkdtempSync(join(tmpdir(), 'central-freshness-'));
  try {
    const files = ['backups.json','restores.json','artifacts.json'].map(x=>join(temp,x));
    writeFileSync(files[0], JSON.stringify({ workflow_runs: [b] }));
    writeFileSync(files[1], JSON.stringify({ workflow_runs: [c] }));
    writeFileSync(files[2], JSON.stringify({ artifacts }));
    return spawnSync('python3', [checker, ...files, now], { encoding:'utf8' });
  } finally { rmSync(temp, { recursive:true, force:true }); }
}

test('fresh encrypted backup and completed independent restore pass', () => {
  const x=run();
  assert.equal(x.status,0,x.stdout+x.stderr);
  assert.match(x.stdout,/PASS: Central backup/);
});
test('missing, expired, stale or incomplete evidence fails closed', () => {
  assert.equal(run(backup,restore,[]).status,1);
  assert.equal(run(backup,restore,[{name:'central-validated-encrypted-backup-123',expired:true,size_in_bytes:2000}]).status,1);
  assert.equal(run({...backup,updated_at:'2026-11-19T10:00:00Z'},restore).status,1);
  assert.equal(run(backup,{...restore,conclusion:'failure'}).status,1);
  assert.equal(run(backup,{...restore,updated_at:'2026-11-21T15:00:00Z'}).status,1);
});
