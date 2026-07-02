import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// -C trust cert · -b nonzero exit on SQL error · -h -1 no headers · -y 0 untruncated var-width
// NOTE: -W (trim) is mutually exclusive with -y/-Y in sqlcmd, so we trim trailing
// whitespace per line ourselves in invoke() instead of passing -W.
const BASE = (server, database, user, password) =>
  ['-S', server, '-d', database, '-U', user, '-P', password, '-C', '-b', '-h', '-1', '-y', '0'];

async function invoke(args, exec) {
  try {
    const { stdout } = await exec('sqlcmd', args);
    return String(stdout).split('\n').map((l) => l.replace(/[ \t\r]+$/, '')).join('\n').trim();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('sqlcmd not found on PATH — install SQL Server command-line tools');
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    const err = new Error(`sqlcmd failed: ${detail}`);
    err.code = e.code;
    throw err;
  }
}

export async function runSql({ server, database, user, password, sql, exec = execFileP }) {
  return invoke([...BASE(server, database, user, password), '-Q', sql], exec);
}

export async function runSqlFile({ server, database, user, password, file, exec = execFileP }) {
  return invoke([...BASE(server, database, user, password), '-i', file], exec);
}
