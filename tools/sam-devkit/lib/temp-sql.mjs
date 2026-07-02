import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Writes a UTF-8 .sql file, returns its path + a cleanup fn.
// Used to run large UPDATE statements via `sqlcmd -i` instead of -Q (avoids
// command-line length limits and quoting issues with big JSON payloads).
// Date.now runs in the real server process (not a workflow sandbox).
export async function writeTempSql(contents) {
  const path = join(tmpdir(), `sam-devkit-${process.pid}-${Date.now()}.sql`);
  await writeFile(path, contents, 'utf8');
  return { path, cleanup: () => unlink(path).catch(() => {}) };
}
