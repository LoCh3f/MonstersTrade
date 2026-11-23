import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { experimental_readRawConfig } from 'wrangler';

// Wrangler is pinned in package.json; its parser handles JSONC comments and trailing commas.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');

export function deploymentPlan(raw, env = {}, args = [], directory = root) {
  if (args.some(value => !['--dry-run', '--migrate', '--staging'].includes(value))) {
    throw new Error('Supported deployment options: --dry-run, --migrate and --staging. Configure the Worker in wrangler.jsonc.');
  }
  const staging = args.includes('--staging');
  if (staging && !raw.env?.staging) throw new Error('Configure an explicit staging environment in wrangler.jsonc.');
  // Staging declares its own bindings, variables and schedule; never inherit production data.
  const config = structuredClone(staging ? { ...raw, ...raw.env.staging } : raw);
  delete config.env;
  const bindings = (config.d1_databases || []).filter(database => database.binding === 'PRICES_DB');
  const id = (staging ? env.CLOUDFLARE_STAGING_DATABASE_ID : env.CLOUDFLARE_DATABASE_ID) || bindings[0]?.database_id;
  if (bindings.length !== 1 || typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id) || id === '00000000-0000-0000-0000-000000000000') {
    throw new Error(`Configure a real PRICES_DB database ID in wrangler.jsonc or ${staging ? 'CLOUDFLARE_STAGING_DATABASE_ID' : 'CLOUDFLARE_DATABASE_ID'}. The zero UUID is only for local development.`);
  }
  if (env.CLOUDFLARE_ACCOUNT_ID && !/^[a-f\d]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be the 32-character Cloudflare account ID.');
  if (staging) {
    const productionId = env.CLOUDFLARE_DATABASE_ID || raw.d1_databases?.find(database => database.binding === 'PRICES_DB')?.database_id;
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(productionId || '') || productionId === '00000000-0000-0000-0000-000000000000') throw new Error('Supply the production database ID as well, so staging isolation can be verified.');
    if (productionId.toLowerCase() === id.toLowerCase()) throw new Error('Staging must use a different database from production.');
    if (!raw.env.staging.d1_databases || !raw.env.staging.vars || !raw.env.staging.triggers || !raw.env.staging.assets) throw new Error('Staging must declare its own database, variables, schedule and assets.');
  }
  if (config.name !== (staging ? 'monstertrade-staging' : 'monstertrade') || typeof config.main !== 'string' || !config.assets?.directory) throw new Error('Expected the selected Monstertrade Worker and static assets in wrangler.jsonc.');
  bindings[0].database_id = id;
  if (env.CLOUDFLARE_ACCOUNT_ID) config.account_id = env.CLOUDFLARE_ACCOUNT_ID;
  // Resolve source paths for the temporary config without editing local settings.
  delete config.$schema;
  config.main = resolve(directory, config.main);
  config.assets.directory = resolve(directory, config.assets.directory);
  for (const database of config.d1_databases) database.migrations_dir = resolve(directory, database.migrations_dir || 'migrations');
  const dryRun = args.includes('--dry-run');
  const commands = [];
  if (args.includes('--migrate') && !dryRun) commands.push(['d1', 'migrations', 'apply', 'PRICES_DB', '--remote']);
  commands.push(['deploy', ...(dryRun ? ['--dry-run'] : [])]);
  return { config, commands };
}

export function executeDeployment(plan, { runCommand = spawnSync, directory = root, environment = process.env } = {}) {
  mkdirSync(join(directory, '.wrangler'), { recursive: true });
  const temporary = mkdtempSync(join(directory, '.wrangler', 'deploy-'));
  try {
    const configPath = join(temporary, 'wrangler.json');
    writeFileSync(configPath, JSON.stringify(plan.config, null, 2), { mode: 0o600 });
    for (const command of plan.commands) {
      const result = runCommand(process.execPath, [wrangler, ...command, '--config', configPath], { cwd: directory, env: environment, stdio: 'inherit', shell: false });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${command[0]} failed; remaining deployment steps were not run.`);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function deploy(args = process.argv.slice(2), env = process.env) {
  const { rawConfig } = experimental_readRawConfig({ config: join(root, 'wrangler.jsonc') });
  const plan = deploymentPlan(rawConfig, env, args);
  executeDeployment(plan, { environment: env });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { deploy(); }
  catch (error) { console.error(`Deployment stopped: ${error.message}`); process.exitCode = 1; }
}
