import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSql, runSqlFile, runSqlWide } from '../lib/db.mjs';

// sqlcmd, run with -u -o <file> (see lib/db.mjs), writes results (and, on
// error, the error text) as UTF-16LE with a BOM into the -o file — never to
// stdout/stderr. These fakes simulate that file write so invoke()'s
// read-the-file path is exercised the same way the real sqlcmd is.
function outFileOf(args) {
  const i = args.indexOf('-o');
  assert.ok(i >= 0, 'expected -o <file> in args');
  return args[i + 1];
}
function fakeExec(record, content) {
  return async (cmd, args) => {
    record.cmd = cmd;
    record.args = args;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outFileOf(args), '﻿' + content, 'utf16le');
    return {};
  };
}
function fakeExecError({ message, code, stderr = '', stdout = '', fileText }) {
  return async (cmd, args) => {
    if (fileText !== undefined) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(outFileOf(args), '﻿' + fileText, 'utf16le');
    }
    const e = new Error(message);
    e.code = code;
    e.stderr = stderr;
    e.stdout = stdout;
    throw e;
  };
}

test('builds sqlcmd args array (no shell string), adds -u -o <tempfile>, and returns trimmed result', async () => {
  const rec = {};
  const out = await runSql({
    server: 'localhost', database: 'SamDb', user: 'sa', password: 'pw',
    sql: 'SELECT 1;', exec: fakeExec(rec, '1\r\n'),
  });
  assert.equal(out, '1');
  assert.equal(rec.cmd, 'sqlcmd');
  assert.deepEqual(rec.args.slice(0, 12), ['-S', 'localhost', '-d', 'SamDb', '-U', 'sa', '-P', 'pw', '-C', '-b', '-h', '-1']);
  assert.deepEqual(rec.args.slice(12, 14), ['-Q', 'SELECT 1;']);
  assert.deepEqual(rec.args.slice(14), ['-u', '-o', outFileOf(rec.args)]);
});

test('Thai / non-ASCII result text round-trips correctly through the -u -o <file> path', async () => {
  const rec = {};
  const out = await runSql({
    server: 'localhost', database: 'd', user: 'u', password: 'p',
    sql: 'x', exec: fakeExec(rec, 'ทดสอบผู้จัดการ\r\n'),
  });
  assert.equal(out, 'ทดสอบผู้จัดการ');
});

test('nonzero exit: error text now comes from the -o file (sqlcmd redirects errors there too)', async () => {
  const boom = fakeExecError({
    message: 'Command failed: sqlcmd ...', code: 1,
    fileText: "Msg 208, Level 16, State 1, Server x, Line 1\r\nInvalid object name 'dbo.Ghost'.",
  });
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: boom }),
    /Invalid object name/,
  );
});

test('nonzero exit with no output file written falls back to stderr, then stdout, then the generic message', async () => {
  const withStderr = fakeExecError({ message: 'exit 1', code: 1, stderr: 'Msg 208 invalid object' });
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: withStderr }),
    /invalid object/,
  );

  const withStdout = fakeExecError({ message: 'Command failed: sqlcmd -S host', code: 1, stdout: 'Invalid object name \'dbo.Ghost\'.' });
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: withStdout }),
    /Invalid object name/,
  );

  const bothEmpty = fakeExecError({ message: 'Command failed: sqlcmd -S host', code: 1 });
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: bothEmpty }),
    /Command failed/,
  );
});

test('missing sqlcmd (ENOENT) throws a clear not-found error', async () => {
  const enoent = async () => { const e = new Error('spawn sqlcmd ENOENT'); e.code = 'ENOENT'; throw e; };
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: enoent }),
    /sqlcmd not found/i,
  );
});

test('runSql uses -h -1 (no headers) and no -y/-W (they conflict with -h)', async () => {
  const rec = {};
  await runSql({
    server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'SELECT 1;',
    exec: fakeExec(rec, ''),
  });
  const h = rec.args.indexOf('-h');
  assert.ok(h >= 0 && rec.args[h + 1] === '-1', '-h -1 present');
  assert.ok(!rec.args.includes('-y'), 'no -y (mutually exclusive with -h)');
  assert.ok(!rec.args.includes('-W'), 'no -W (mutually exclusive with -y; trimmed in code instead)');
});

test('runSqlWide uses -y 0 without -h and strips the header + separator', async () => {
  const rec = {};
  const out = await runSqlWide({
    server: 'localhost', database: 'd', user: 'u', password: 'p',
    sql: 'SELECT RebatePayload FROM x;',
    exec: fakeExec(rec, 'RebatePayload\r\n-------------\r\n{"a":1}\r\n'),
  });
  const y = rec.args.indexOf('-y');
  assert.ok(y >= 0 && rec.args[y + 1] === '0', '-y 0 present');
  assert.ok(!rec.args.includes('-h'), 'no -h (mutually exclusive with -y)');
  assert.equal(out, '{"a":1}', 'header + dashed separator stripped, value returned');
});

test('runSqlFile uses -i <file> and returns trimmed result', async () => {
  const rec = {};
  const out = await runSqlFile({
    server: 'localhost', database: 'd', user: 'u', password: 'p', file: '/tmp/x.sql',
    exec: fakeExec(rec, 'ok\r\n'),
  });
  assert.equal(out, 'ok');
  assert.equal(rec.cmd, 'sqlcmd');
  const i = rec.args.indexOf('-i');
  assert.ok(i >= 0 && rec.args[i + 1] === '/tmp/x.sql', '-i file present');
  assert.ok(!rec.args.includes('-Q'), 'no -Q when running a file');
});

test('runSqlFile surfaces sqlcmd errors', async () => {
  const boom = fakeExecError({ message: 'x', code: 1, fileText: 'Msg 208' });
  await assert.rejects(() => runSqlFile({ server: 'l', database: 'd', user: 'u', password: 'p', file: 'f', exec: boom }), /Msg 208/);
});

test('the temp output directory is cleaned up after a successful call', async () => {
  const rec = {};
  await runSql({ server: 'l', database: 'd', user: 'u', password: 'p', sql: 'x', exec: fakeExec(rec, 'ok') });
  const dir = outFileOf(rec.args).replace(/[\\/][^\\/]+$/, '');
  await assert.rejects(() => readFile(outFileOf(rec.args)), /ENOENT/, 'output file removed');
  await assert.rejects(() => readFile(dir), /ENOENT/, 'temp dir removed');
});
