import { spawn } from 'node:child_process';
import readline from 'node:readline';

// No network or secret inputs. Only git patches already in this checkout are read.
// This intentionally prints only detection category, git revision and repository path.
// High-confidence patterns; not a substitute for GitHub Secret Scanning or key rotation.
const rules = [
  ['github-fine-grained-token', /github_pat_[A-Za-z0-9_]{40,}/],
  ['github-classic-token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['supabase-secret-key', /sb_secret_[A-Za-z0-9_-]{20,}/],
  ['openai-secret-key', /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/],
  ['stripe-live-secret', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['private-key-header', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['jwt-literal', /\beyJ[A-Za-z0-9_-]{25,}\.eyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{20,}\b/],
  ['hardcoded-provider-secret', /\b(?:ASAAS_API_KEY|GEMINI_API_KEY|NVIDIA_API_KEY|SUPABASE_SERVICE_ROLE_KEY|META_ACCESS_TOKEN|GOOGLE_CLIENT_SECRET)\s*[:=]\s*["'][A-Za-z0-9_~+=/.-]{25,}["']/]
];
const git = spawn('git', [
  'log', '--all', '--no-ext-diff', '--no-textconv',
  '--no-renames', '--format=COMMIT:%H', '--patch', '--unified=0',
  '--', '.'
], { stdio: ['ignore', 'pipe', 'pipe'] });
let gitError = false;
git.on('error', () => { gitError = true; });
git.stderr.on('data', () => { gitError = true; });
let commit = 'unknown';
let file = 'unknown';
let commits = 0;
let addedLines = 0;
const matches = new Map();
for await (const line of readline.createInterface({ input: git.stdout, crlfDelay: Infinity })) {
  if (line.startsWith('COMMIT:')) {
    commit = line.slice(7, 47);
    commits += 1;
  } else if (line.startsWith('+++ b/')) {
    file = line.slice(6);
  } else if (line.startsWith('+') && !line.startsWith('+++')) {
    addedLines += 1;
    const value = line.slice(1);
    for (const [name, regex] of rules) {
      if (!regex.test(value)) continue;
      const id = name + '|' + commit + '|' + file;
      if (!matches.has(id)) matches.set(id, { category: name, revision: commit.slice(0, 12), path: file });
    }
  }
}
const status = await new Promise(resolve => git.on('close', resolve));
if (status !== 0 || gitError || commits === 0) {
  console.error('Git history audit could not complete; no PASS claimed.');
  process.exit(2);
}
const findings = [...matches.values()];
console.log('Git history credential audit: ' + commits + ' revisions, ' + addedLines + ' added lines inspected.');
console.log('Coverage: textual patch additions across all locally fetched refs. Binary objects, encoded secrets and low-confidence values are outside scope.');
console.log('High-confidence potential credential findings: ' + findings.length);
for (const row of findings.slice(0, 50)) {
  console.log('FINDING category=' + row.category + ' revision=' + row.revision + ' path=' + row.path);
}
if (findings.length > 50) console.log('Additional findings omitted from output.');
if (findings.length) {
  console.error('Review and rotate any exposed real credentials. Deleting a file does not erase git history.');
  process.exitCode = 1;
}
