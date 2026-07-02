import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// Common flags: -C trust cert · -b nonzero exit on SQL error.
// sqlcmd treats -y/-Y as mutually exclusive with BOTH -h and -W, so we never
// combine them:
//   BASE (scalars/writes): -h -1 (no headers) — clean single-value output.
//   WIDE (large reads):    -y 0  (untruncated var-width) — no -h; we strip the
//                          header + separator line ourselves.
// Trailing whitespace is trimmed per line in invoke() (replaces -W).
const COMMON = (server, database, user, password) =>
  ['-S', server, '-d', database, '-U', user, '-P', password, '-C', '-b'];
const BASE = (server, database, user, password) =>
  [...COMMON(server, database, user, password), '-h', '-1'];
const WIDE = (server, database, user, password) =>
  [...COMMON(server, database, user, password), '-y', '0'];

async function invoke(args, exec) {
  try {
    const { stdout } = await exec('sqlcmd', args);
    // rtrim each line (replaces the -W flag, which conflicts with -y/-Y)
    return String(stdout).split('\n').map((l) => l.replace(/[ \t\r]+$/, '')).join('\n');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('sqlcmd not found on PATH — install SQL Server command-line tools');
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    const err = new Error(`sqlcmd failed: ${detail}`);
    err.code = e.code;
    throw err;
  }
}

export async function runSql({ server, database, user, password, sql, exec = execFileP }) {
  return (await invoke([...BASE(server, database, user, password), '-Q', sql], exec)).trim();
}

export async function runSqlFile({ server, database, user, password, file, exec = execFileP }) {
  return (await invoke([...BASE(server, database, user, password), '-i', file], exec)).trim();
}

// Untruncated read of a single large value (e.g. NVARCHAR(MAX) JSON payload).
// Uses -y 0 (no -h, since they conflict) and strips the header + dashed
// separator line that sqlcmd prints, returning just the value body.
export async function runSqlWide({ server, database, user, password, sql, exec = execFileP }) {
  const text = await invoke([...WIDE(server, database, user, password), '-Q', sql], exec);
  const lines = text.split('\n');
  const sep = lines.findIndex((l) => /^-{2,}$/.test(l));
  return (sep >= 0 ? lines.slice(sep + 1).join('\n') : text).trim();
}
