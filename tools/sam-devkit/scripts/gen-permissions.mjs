// Regenerate lib/permissions-snapshot.json from the SAM sources (read-only).
// Run whenever web/ permission code changes:  node scripts/gen-permissions.mjs
// Paths can be overridden:  node scripts/gen-permissions.mjs <permissions.ts> <Program.cs>
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { parsePermissionsTs, parsePolicies } from '../lib/org-lookup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..'); // sam-workspace

const permsPath = process.argv[2] ?? join(ROOT, 'web', 'web', 'frontend', 'src', 'shared', 'constants', 'permissions.ts');
const programPath = process.argv[3] ?? join(ROOT, 'web', 'web', 'backend', 'SamApp.WebApi', 'Program.cs');

const { permissions, redirects } = parsePermissionsTs(await readFile(permsPath, 'utf8'));
const policies = parsePolicies(await readFile(programPath, 'utf8'));

if (!Object.keys(permissions).length) throw new Error('no ROLE_PERMISSIONS parsed — check permissions.ts path/shape');
if (!Object.keys(policies).length) throw new Error('no AddPolicy parsed — check Program.cs path/shape');

let commit = 'unknown';
try { commit = execSync('git -C "' + dirname(permsPath) + '" rev-parse --short HEAD').toString().trim(); } catch { /* no repo */ }

const snapshot = {
  generatedAt: new Date().toISOString(),
  sourceCommit: commit,
  permissions,
  redirects,
  policies,
};

const out = join(HERE, '..', 'lib', 'permissions-snapshot.json');
await writeFile(out, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`snapshot → ${out}`);
console.log(`  roles: ${Object.keys(permissions).join(', ')}`);
console.log(`  policies: ${Object.keys(policies).length} · source commit ${commit}`);
