import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSql, runSqlFile } from '../lib/db.mjs';

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
  assert.deepEqual(rec.args, ['-S', 'localhost', '-d', 'SamDb', '-U', 'sa', '-P', 'pw', '-C', '-b', '-h', '-1', '-W', '-y', '0', '-Q', 'SELECT 1;']);
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

test('runSql includes -y 0 (untruncated variable-width output)', async () => {
  const rec = {};
  await runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'SELECT 1;',
    exec: async (cmd, args) => { rec.args = args; return { stdout: '', stderr: '' }; } });
  const i = rec.args.indexOf('-y');
  assert.ok(i >= 0 && rec.args[i + 1] === '0', '-y 0 present');
});

test('runSqlFile uses -i <file> and returns trimmed stdout', async () => {
  const rec = {};
  const out = await runSqlFile({ server: 'localhost', database: 'd', user: 'u', password: 'p', file: '/tmp/x.sql',
    exec: async (cmd, args) => { rec.cmd = cmd; rec.args = args; return { stdout: 'ok\r\n', stderr: '' }; } });
  assert.equal(out, 'ok');
  assert.equal(rec.cmd, 'sqlcmd');
  const i = rec.args.indexOf('-i');
  assert.ok(i >= 0 && rec.args[i + 1] === '/tmp/x.sql', '-i file present');
  assert.ok(!rec.args.includes('-Q'), 'no -Q when running a file');
});

test('runSqlFile surfaces sqlcmd errors', async () => {
  const boom = async () => { const e = new Error('x'); e.stderr = 'Msg 208'; e.code = 1; throw e; };
  await assert.rejects(() => runSqlFile({ server: 'l', database: 'd', user: 'u', password: 'p', file: 'f', exec: boom }), /Msg 208/);
});
