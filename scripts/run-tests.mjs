import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Enumerate explicitly: quoted globs silently select zero tests on Windows.
const tests = [];
for (const root of ['packages', 'apps']) for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = `${root}/${entry.name}/test`;
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  tests.push(...files.filter(f => f.endsWith('.test.ts')).map(f => `${dir}/${f}`));
}
if (!tests.length) throw new Error('No tests discovered');
console.log(`Running ${tests.length} test files`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', '--test-timeout=180000', '--import', 'tsx', ...tests.sort()], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
