import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_readConfig } from 'wrangler';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');

async function filesIn(directory) {
  const children = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(children.map(entry => entry.isDirectory()
    ? filesIn(join(directory, entry.name)) : join(directory, entry.name)))).flat();
}

async function requireFile(file) {
  assert.ok((await stat(file)).isFile(), `Expected a file: ${relative(root, file)}`);
}

async function requireAsset(value) {
  const file = resolve(dist, value.split(/[?#]/)[0]);
  assert.ok(file.startsWith(`${dist}${sep}`), `Asset leaves dist/: ${value}`);
  await requireFile(file);
}

try {
  const files = (await Promise.all(['dist', 'worker', 'scripts', 'tests'].map(name => filesIn(join(root, name)))))
    .flat().filter(file => /\.(?:js|mjs)$/.test(file));
  files.push(join(root, 'server.mjs'));
  for (const file of files) {
    const checked = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
    if (checked.error) throw checked.error;
    assert.equal(checked.status, 0, checked.stderr || `Syntax check failed: ${relative(root, file)}`);
    const source = await readFile(file, 'utf8');
    // Validate static local module imports without executing application code.
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]+?\s+from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
      await requireFile(resolve(dirname(file), match[1]));
    }
  }

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].name, pkg.name, 'Lockfile package name is stale');
  assert.equal(lock.packages[''].version, pkg.version, 'Lockfile package version is stale');
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, 'Lockfile dependencies are stale');

  const config = unstable_readConfig({ config: join(root, 'wrangler.jsonc') });
  await requireFile(resolve(root, config.main));
  assert.equal(config.assets.directory, './dist', 'Publish only the dist/ static assets');
  assert.equal(config.assets.binding, 'ASSETS', 'The Worker expects an ASSETS binding');
  assert.equal(config.d1_databases.filter(binding => binding.binding === 'PRICES_DB').length, 1, 'The Worker expects one PRICES_DB binding');
  assert.ok(config.assets.run_worker_first.includes('/api/*'), 'API routes must run through the Worker');

  const html = await readFile(join(dist, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)) await requireAsset(match[1]);
  const featured = JSON.parse(await readFile(join(dist, 'featured.json'), 'utf8'));
  assert.ok(Array.isArray(featured), 'Featured cards must be a JSON array');
  for (const card of featured) if (card.localImage) await requireAsset(card.localImage);
  console.log(`Checked ${files.length} JavaScript files, module imports, configuration, lockfile, and bundled assets.`);
} catch (error) {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
}
