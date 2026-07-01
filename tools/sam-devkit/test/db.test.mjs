import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSql } from '../lib/db.mjs';

function fakeExec(record, result) {
  return async (cmd, args) => { record.cmd = cmd; record.args = args; return result; };
}

test('builds sqlcmd args array (no shell string) and returns trimmed stdout', async () => {
  const rec = {};
  const out = await runSql({
    server: 'localhost', database: 'SamDb', user: 'sa', password: 'pw',
    sql: 'SELECT 1;', exec: fakeExec(rec, { stdout: '1\r\n', stderr: '' }),
  });
  assert.equal(out, '1');
  assert.equal(rec.cmd, 'sqlcmd');
  assert.deepEqual(rec.args, ['-S', 'localhost', '-d', 'SamDb', '-U', 'sa', '-P', 'pw', '-C', '-b', '-h', '-1', '-W', '-Q', 'SELECT 1;']);
});

test('nonzero exit throws with stderr text', async () => {
  const boom = async () => { const e = new Error('exit 1'); e.stderr = 'Msg 208 invalid object'; e.code = 1; throw e; };
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: boom }),
    /invalid object/,
  );
});

test('missing sqlcmd (ENOENT) throws a clear not-found error', async () => {
  const enoent = async () => { const e = new Error('spawn sqlcmd ENOENT'); e.code = 'ENOENT'; throw e; };
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: enoent }),
    /sqlcmd not found/i,
  );
});
