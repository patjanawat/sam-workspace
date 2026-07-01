import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export async function runSql({ server, database, user, password, sql, exec = execFileP }) {
  const args = ['-S', server, '-d', database, '-U', user, '-P', password, '-C', '-b', '-h', '-1', '-W', '-Q', sql];
  try {
    const { stdout } = await exec('sqlcmd', args);
    return String(stdout).trim();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('sqlcmd not found on PATH — install SQL Server command-line tools');
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    const err = new Error(`sqlcmd failed: ${detail}`);
    err.code = e.code;
    throw err;
  }
}
