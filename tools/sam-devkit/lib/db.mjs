import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// Non-ASCII result data (e.g. Thai names) MUST go through -u (Unicode
// output) written to a FILE via -o, not captured from stdout/console.
// sqlcmd converts console-attached stdout through the OS ANSI codepage —
// any character that codepage can't represent (Thai isn't in the default
// English-Windows codepage) becomes a literal '?' before Node ever sees the
// bytes. This happens regardless of -f/-u when the output stays on
// stdout — confirmed by repeated, deterministic repro (0x3f... every time).
// Only -u -o <file> (true UTF-16LE file write, bypassing the console
// entirely) was reliable across 5+ repeated live-DB runs. Error text also
// gets redirected into the same file when -o is set (not stdout/stderr
// anymore), so the error path below reads it too.
async function readOutFile(path) {
  let buf;
  try {
    buf = await readFile(path);
  } catch {
    return '';
  }
  let text = buf.toString('utf16le');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  // rtrim each line (replaces the -W flag, which conflicts with -y/-Y)
  return text.split('\n').map((l) => l.replace(/[ \t\r]+$/, '')).join('\n');
}

async function invoke(args, exec) {
  const dir = await mkdtemp(join(tmpdir(), 'sam-devkit-'));
  const outFile = join(dir, 'out.txt');
  try {
    try {
      await exec('sqlcmd', [...args, '-u', '-o', outFile]);
    } catch (e) {
      if (e.code === 'ENOENT') throw new Error('sqlcmd not found on PATH — install SQL Server command-line tools');
      // sqlcmd sends T-SQL error text (invalid object, permission denied, ...)
      // into the -o file now, not stdout/stderr — check the file first, then
      // fall back to whatever the process itself reported, then Node's
      // generic "Command failed: <re-echoed command>" message.
      const fromFile = (await readOutFile(outFile)).trim();
      const stderr = e.stderr ? String(e.stderr).trim() : '';
      const stdout = e.stdout ? String(e.stdout).trim() : '';
      const detail = fromFile || stderr || stdout || e.message;
      const err = new Error(`sqlcmd failed: ${detail}`);
      err.code = e.code;
      throw err;
    }
    return await readOutFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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
