import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentPlan, executeDeployment } from '../scripts/deploy.mjs';
import { checkRelease } from '../scripts/check-release.mjs';
import { checkProduction } from '../scripts/check-production.mjs';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const zero = '00000000-0000-0000-0000-000000000000';
const id = '12345678-1234-1234-1234-123456789abc';
const raw = () => ({ name: 'monstertrade', main: 'worker/index.js', assets: { directory: './dist' }, d1_databases: [{ binding: 'PRICES_DB', database_id: zero, migrations_dir: 'migrations' }] });

test('deployment rejects placeholders, invalid account IDs and unknown options before commands run', () => {
  assert.throws(() => deploymentPlan(raw()), /real PRICES_DB/);
  assert.throws(() => deploymentPlan(raw(), { CLOUDFLARE_DATABASE_ID: 'wrong' }), /real PRICES_DB/);
  assert.throws(() => deploymentPlan(raw(), { CLOUDFLARE_DATABASE_ID: id, CLOUDFLARE_ACCOUNT_ID: 'wrong' }), /account ID/);
  assert.throws(() => deploymentPlan(raw(), { CLOUDFLARE_DATABASE_ID: id }, ['--env', 'other']), /Supported/);
  const duplicate = raw(); duplicate.d1_databases.push({ ...duplicate.d1_databases[0] });
  assert.throws(() => deploymentPlan(duplicate, { CLOUDFLARE_DATABASE_ID: id }), /real PRICES_DB/);
});

test('production overrides preserve the local config and resolve temporary config paths', () => {
  const original = raw();
  const { config, commands } = deploymentPlan(original, { CLOUDFLARE_DATABASE_ID: id, CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32) }, ['--migrate'], '/project');
  assert.equal(original.d1_databases[0].database_id, zero);
  assert.equal(config.d1_databases[0].database_id, id);
  assert.equal(config.account_id, 'a'.repeat(32));
  assert.equal(config.main, '/project/worker/index.js');
  assert.equal(config.assets.directory, '/project/dist');
  assert.equal(config.d1_databases[0].migrations_dir, '/project/migrations');
  assert.deepEqual(commands, [['d1', 'migrations', 'apply', 'PRICES_DB', '--remote'], ['deploy']]);
});

test('a dry-run never applies remote migrations even when --migrate is provided', () => {
  const { commands } = deploymentPlan(raw(), { CLOUDFLARE_DATABASE_ID: id }, ['--migrate', '--dry-run']);
  assert.deepEqual(commands, [['deploy', '--dry-run']]);
  const configured = raw(); configured.d1_databases[0].database_id = id;
  assert.deepEqual(deploymentPlan(configured).commands, [['deploy']]);
});

test('a failed migration prevents deployment and removes its temporary configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monstertrade-deploy-test-'));
  try {
    const plan = deploymentPlan(raw(), { CLOUDFLARE_DATABASE_ID: id }, ['--migrate'], directory);
    const calls = [];
    let configPath;
    assert.throws(() => executeDeployment(plan, { directory, environment: {}, runCommand: (executable, args, options) => {
      calls.push(args);
      configPath = args.at(-1);
      assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).d1_databases[0].database_id, id);
      assert.equal(options.shell, false);
      return { status: 1 };
    } }), /d1 failed/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('--remote'));
    assert.equal(existsSync(configPath), false);
    assert.deepEqual(readdirSync(join(directory, '.wrangler')), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const releaseEnv = () => ({ GH_TOKEN: 'test-github-token', DEPLOY_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'example/monstertrade', CLOUDFLARE_API_TOKEN: 'test-cloudflare-token', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_DATABASE_ID: id });

test('release gate rejects missing configuration and invalid identities before any network call', async () => {
  const fetchImpl = async () => { assert.fail('Invalid configuration must not contact GitHub'); };
  for (const key of Object.keys(releaseEnv())) {
    const env = releaseEnv(); delete env[key];
    await assert.rejects(checkRelease(env, { rawConfig: raw(), fetchImpl }), new RegExp(`Missing ${key}`));
  }
  for (const override of [{ DEPLOY_SHA: 'main' }, { GITHUB_REPOSITORY: 'example/repo/extra' }, { CLOUDFLARE_DATABASE_ID: zero }]) {
    await assert.rejects(checkRelease({ ...releaseEnv(), ...override }, { rawConfig: raw(), fetchImpl }));
  }
});

test('release gate requires the exact current main commit and rejects GitHub errors', async () => {
  const env = releaseEnv();
  await checkRelease(env, { rawConfig: raw(), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/monstertrade/git/ref/heads/main');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${env.GH_TOKEN}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!JSON.stringify(options).includes(env.CLOUDFLARE_API_TOKEN));
    return Response.json({ object: { sha: env.DEPLOY_SHA } });
  } });
  await assert.rejects(checkRelease(env, { rawConfig: raw(), fetchImpl: async () => Response.json({ object: { sha: 'c'.repeat(40) } }) }), /no longer the latest main/);
  await assert.rejects(checkRelease(env, { rawConfig: raw(), fetchImpl: async () => new Response('', { status: 403 }) }), /Could not verify.*403/);
  await assert.rejects(checkRelease(env, { rawConfig: raw(), fetchImpl: async () => { throw new Error('network unavailable'); } }), /network unavailable/);
});

test('production health checks validate the URL before sending a request', async () => {
  const fetchImpl = async () => { assert.fail('Invalid origins must not be requested'); };
  for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=x', 'https://example.com/#fragment']) {
    await assert.rejects(checkProduction(url, { fetchImpl }), /HTTPS origin/);
  }
});

test('production health retries temporary failures and requires both database schemas', async () => {
  let attempts = 0;
  const pauses = [];
  const health = await checkProduction('https://monstertrade.example', {
    wait: async ms => pauses.push(ms),
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://monstertrade.example/api/health');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      attempts++;
      if (attempts === 1) return new Response('', { status: 503 });
      return Response.json({ service: 'public-prices', configured: true, sealedConfigured: attempts >= 3 });
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [5000, 5000]);
  assert.equal(health.sealedConfigured, true);

  attempts = 0; pauses.length = 0;
  await assert.rejects(checkProduction('https://monstertrade.example', {
    wait: async ms => pauses.push(ms),
    fetchImpl: async () => { attempts++; return Response.json({ service: 'other-app', configured: true, sealedConfigured: true }); },
  }), /not configured/);
  assert.equal(attempts, 5);
  assert.deepEqual(pauses, [5000, 5000, 5000, 5000]);
});
