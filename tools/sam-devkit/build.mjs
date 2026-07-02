// Build a standalone single-file executable (Node SEA) so teammates can run
// sam-devkit without installing Node.
//
//   node build.mjs        (or: npm run build)
//
// Output: dist/sam-devkit(.exe). Ship it together with a config.json placed
// BESIDE the executable (copy config.example.json → config.json and fill it in).
// index.html is embedded into the binary as a SEA asset.
//
// Build-time only: esbuild + postject are fetched via npx (needs network once).
// The runtime has zero dependencies.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const exe = join('dist', isWin ? 'sam-devkit.exe' : 'sam-devkit');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'; // documented Node SEA sentinel fuse
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: isWin });

mkdirSync('dist', { recursive: true });

console.log('1/4  bundle ESM → single CJS file (esbuild)…');
run('npx', ['--yes', 'esbuild', 'server.mjs', '--bundle', '--platform=node', '--format=cjs', '--outfile=dist/bundle.cjs']);

console.log('2/4  generate SEA blob…');
run(process.execPath, ['--experimental-sea-config', 'sea-config.json']);

console.log('3/4  copy the node binary…');
copyFileSync(process.execPath, exe);

console.log('4/4  inject the blob (postject)…');
const postjectArgs = [exe, 'NODE_SEA_BLOB', 'dist/sea-prep.blob', '--sentinel-fuse', FUSE];
if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run('npx', ['--yes', 'postject', ...postjectArgs]);

console.log(`\nDone → ${exe}`);
console.log('Ship it with a config.json beside the executable, then run it and open http://localhost:8787');
if (isWin) console.log('(Windows: the copied node.exe was code-signed; postject invalidates that signature — harmless for internal use, SmartScreen may warn once.)');
