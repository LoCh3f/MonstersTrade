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
const stagingId = 'abcdefab-1234-1234-1234-123456789abc';
const raw = () => ({ name: 'monstertrade', main: 'worker/index.js', assets: { directory: './dist' }, d1_databases: [{ binding: 'PRICES_DB', database_id: zero, migrations_dir: 'migrations' }] });
const stagingRaw = () => ({
  ...raw(),
  vars: { APP_ENV: 'production' },
  triggers: { crons: ['0 * * * *'] },
  env: {
    staging: {
      name: 'monstertrade-staging',
      assets: { directory: './dist', binding: 'ASSETS' },
      vars: { APP_ENV: 'staging' },
      triggers: { crons: [] },
      d1_databases: [{ binding: 'PRICES_DB', database_name: 'monstertrade-prices-staging', database_id: zero, migrations_dir: 'migrations' }],
    },
  },
});
const stagingDatabases = () => ({ CLOUDFLARE_DATABASE_ID: id, CLOUDFLARE_STAGING_DATABASE_ID: stagingId });
const expectedSha = 'a'.repeat(40);

test('deployment injects only a validated revision and overrides checked-in identity claims', () => {
  for (const args of [[], ['--staging']]) {
    const source = stagingRaw();
    source.vars.DEPLOY_COMMIT = 'untrusted-config-value';
    source.env.staging.vars.DEPLOY_COMMIT = 'untrusted-staging-value';
    const plan = deploymentPlan(source, { ...stagingDatabases(), DEPLOY_SHA: expectedSha.toUpperCase() }, args);
    assert.equal(plan.config.vars.DEPLOY_COMMIT, expectedSha);
    assert.equal(deploymentPlan(source, stagingDatabases(), args).config.vars.DEPLOY_COMMIT, undefined);
    assert.equal(source.vars.DEPLOY_COMMIT, 'untrusted-config-value');
    for (const invalid of ['', 'main', 'a'.repeat(39), `${expectedSha}\n`]) {
      assert.throws(() => deploymentPlan(source, { ...stagingDatabases(), DEPLOY_SHA: invalid }, args), /full 40-character/);
    }
  }
});

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

test('staging selects independent bindings, variables, assets and schedule without changing production', () => {
  const original = stagingRaw();
  const extra = { binding: 'AUDIT_DB', database_name: 'staging-audit', database_id: 'c'.repeat(8) + '-1234-1234-1234-123456789abc', migrations_dir: 'audit-migrations' };
  original.env.staging.d1_databases.push(extra);
  const snapshot = structuredClone(original);
  const { config, commands } = deploymentPlan(original, stagingDatabases(), ['--staging', '--migrate'], '/project');
  assert.equal(config.name, 'monstertrade-staging');
  assert.deepEqual(config.vars, { APP_ENV: 'staging' });
  assert.deepEqual(config.triggers, { crons: [] });
  assert.deepEqual(config.assets, { directory: '/project/dist', binding: 'ASSETS' });
  assert.deepEqual(config.d1_databases, [
    { binding: 'PRICES_DB', database_name: 'monstertrade-prices-staging', database_id: stagingId, migrations_dir: '/project/migrations' },
    { ...extra, migrations_dir: '/project/audit-migrations' },
  ]);
  assert.equal(config.env, undefined);
  assert.deepEqual(commands, [['d1', 'migrations', 'apply', 'PRICES_DB', '--remote'], ['deploy']]);
  assert.deepEqual(original, snapshot);

  const production = deploymentPlan(original, stagingDatabases(), [], '/project').config;
  assert.equal(production.name, 'monstertrade');
  assert.deepEqual(production.vars, snapshot.vars);
  assert.deepEqual(production.triggers, snapshot.triggers);
  assert.equal(production.d1_databases[0].database_id, id);
  assert.equal(production.d1_databases.length, 1);
  assert.equal(production.env, undefined);
});

test('staging fails closed when either database ID is missing, invalid or shared with production', () => {
  for (const invalid of [undefined, zero, 'invalid']) {
    assert.throws(() => deploymentPlan(stagingRaw(), { ...stagingDatabases(), CLOUDFLARE_STAGING_DATABASE_ID: invalid }, ['--staging']), /real PRICES_DB/);
    assert.throws(() => deploymentPlan(stagingRaw(), { ...stagingDatabases(), CLOUDFLARE_DATABASE_ID: invalid }, ['--staging']), /production database ID/);
  }
  for (const shared of [id, id.toUpperCase()]) {
    assert.throws(() => deploymentPlan(stagingRaw(), { ...stagingDatabases(), CLOUDFLARE_STAGING_DATABASE_ID: shared }, ['--staging']), /different database/);
  }
  const duplicate = stagingRaw();
  duplicate.env.staging.d1_databases.push({ ...duplicate.env.staging.d1_databases[0] });
  assert.throws(() => deploymentPlan(duplicate, stagingDatabases(), ['--staging']), /real PRICES_DB/);

  const configured = stagingRaw();
  configured.d1_databases[0].database_id = id;
  configured.env.staging.d1_databases[0].database_id = stagingId;
  assert.equal(deploymentPlan(configured, {}, ['--staging']).config.d1_databases[0].database_id, stagingId);
});

test('staging requires an explicit environment and each independent setting', () => {
  assert.throws(() => deploymentPlan(raw(), stagingDatabases(), ['--staging']), /explicit staging environment/);
  for (const setting of ['d1_databases', 'vars', 'triggers', 'assets']) {
    const original = stagingRaw();
    delete original.env.staging[setting];
    assert.throws(() => deploymentPlan(original, stagingDatabases(), ['--staging']), /Staging must declare/);
  }
  const incorrectName = stagingRaw();
  incorrectName.env.staging.name = 'monstertrade';
  assert.throws(() => deploymentPlan(incorrectName, stagingDatabases(), ['--staging']), /selected Monstertrade Worker/);
});

test('a staging dry-run only bundles the staging Worker and never applies remote migrations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monstertrade-staging-test-'));
  try {
    const plan = deploymentPlan(stagingRaw(), stagingDatabases(), ['--staging', '--migrate', '--dry-run'], directory);
    assert.deepEqual(plan.commands, [['deploy', '--dry-run']]);
    const calls = [];
    executeDeployment(plan, { directory, environment: {}, runCommand: (executable, args, options) => {
      calls.push(args);
      const config = JSON.parse(readFileSync(args.at(-1), 'utf8'));
      assert.equal(config.name, 'monstertrade-staging');
      assert.equal(config.d1_databases[0].database_id, stagingId);
      assert.equal(options.shell, false);
      return { status: 0 };
    } });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(1, 4), ['deploy', '--dry-run', '--config']);
    assert.equal(calls[0].includes('--remote'), false);
    assert.equal(existsSync(calls[0].at(-1)), false);
    assert.deepEqual(readdirSync(join(directory, '.wrangler')), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const releaseEnv = () => ({ GH_TOKEN: 'test-github-token', DEPLOY_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'example/monstertrade', CLOUDFLARE_API_TOKEN: 'test-cloudflare-token', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_DATABASE_ID: id, MONSTERTRADE_URL: 'https://monstertrade.example' });
const stagingReleaseEnv = () => {
  const env = releaseEnv();
  delete env.MONSTERTRADE_URL;
  return { ...env, ...stagingDatabases(), DEPLOY_TARGET: 'staging', MONSTERTRADE_STAGING_URL: 'https://staging.monstertrade.example' };
};

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

test('staging release gate verifies the exact develop commit and rejects stale runs', async () => {
  const env = stagingReleaseEnv();
  await checkRelease(env, { rawConfig: stagingRaw(), fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/monstertrade/git/ref/heads/develop');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${env.GH_TOKEN}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(JSON.stringify(options).includes(env.CLOUDFLARE_API_TOKEN), false);
    return Response.json({ object: { sha: env.DEPLOY_SHA } });
  } });
  await assert.rejects(checkRelease(env, { rawConfig: stagingRaw(), fetchImpl: async () => Response.json({ object: { sha: 'c'.repeat(40) } }) }), /no longer the latest develop/);
  await assert.rejects(checkRelease(env, { rawConfig: stagingRaw(), fetchImpl: async () => Response.json({}) }), /no longer the latest develop/);
  await assert.rejects(checkRelease(env, { rawConfig: stagingRaw(), fetchImpl: async () => new Response('', { status: 404 }) }), /Could not verify the develop branch \(404\)/);
});

test('staging release gate rejects invalid targets and missing or shared database IDs before any network call', async () => {
  const fetchImpl = async () => { assert.fail('Invalid staging configuration must not contact GitHub'); };
  const env = stagingReleaseEnv();
  for (const target of ['preview', 'main', 'develop', '../../main']) {
    await assert.rejects(checkRelease({ ...env, DEPLOY_TARGET: target }, { rawConfig: stagingRaw(), fetchImpl }), /DEPLOY_TARGET/);
  }
  await assert.rejects(checkRelease({ ...env, CLOUDFLARE_STAGING_DATABASE_ID: undefined }, { rawConfig: stagingRaw(), fetchImpl }), /Missing CLOUDFLARE_STAGING_DATABASE_ID/);
  await assert.rejects(checkRelease({ ...env, CLOUDFLARE_STAGING_DATABASE_ID: zero }, { rawConfig: stagingRaw(), fetchImpl }), /real PRICES_DB/);
  await assert.rejects(checkRelease({ ...env, CLOUDFLARE_STAGING_DATABASE_ID: id }, { rawConfig: stagingRaw(), fetchImpl }), /different database/);
  await assert.rejects(checkRelease({ ...env, CLOUDFLARE_DATABASE_ID: undefined }, { rawConfig: stagingRaw(), fetchImpl }), /Missing CLOUDFLARE_DATABASE_ID/);
});

test('release gates require a valid health origin for the selected target before any network call', async () => {
  const fetchImpl = async () => { assert.fail('Invalid health origins must not contact GitHub'); };
  for (const [env, rawConfig, setting] of [
    [releaseEnv(), raw(), 'MONSTERTRADE_URL'],
    [stagingReleaseEnv(), stagingRaw(), 'MONSTERTRADE_STAGING_URL'],
  ]) {
    await assert.rejects(checkRelease({ ...env, [setting]: undefined }, { rawConfig, fetchImpl }), new RegExp(`Missing ${setting}`));
    for (const url of ['not a URL', 'http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=x', 'https://example.com/#fragment']) {
      await assert.rejects(checkRelease({ ...env, [setting]: url }, { rawConfig, fetchImpl }), new RegExp(`${setting} must be the HTTPS origin`));
    }
  }
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
    expectedSha,
    wait: async ms => pauses.push(ms),
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://monstertrade.example/api/health');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      attempts++;
      if (attempts === 1) return new Response('', { status: 503 });
      return Response.json({ service: 'public-prices', configured: true, sealedConfigured: attempts >= 3, deployCommit: expectedSha });
    },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(pauses, [5000, 5000]);
  assert.equal(health.sealedConfigured, true);

  attempts = 0; pauses.length = 0;
  await assert.rejects(checkProduction('https://monstertrade.example', {
    expectedSha,
    wait: async ms => pauses.push(ms),
    fetchImpl: async () => { attempts++; return Response.json({ service: 'other-app', configured: true, sealedConfigured: true }); },
  }), /not configured/);
  assert.equal(attempts, 5);
  assert.deepEqual(pauses, [5000, 5000, 5000, 5000]);
});

test('healthy old, missing, or malformed revisions cannot authorize release tagging', async () => {
  for (const deployCommit of [undefined, null, 'b'.repeat(40), `${expectedSha}\n`]) {
    let requests = 0;
    await assert.rejects(checkProduction('https://monstertrade.example', {
      expectedSha, wait: async () => {}, fetchImpl: async () => {
        requests++;
        return Response.json({ service: 'public-prices', configured: true, sealedConfigured: true, deployCommit });
      },
    }), /revision does not match/);
    assert.equal(requests, 5);
  }
  for (const invalid of [undefined, '', 'main', `${expectedSha}\n`]) {
    await assert.rejects(checkProduction('https://monstertrade.example', {
      expectedSha: invalid, fetchImpl: async () => assert.fail('Invalid expected revision must not issue a request'),
    }), /full 40-character/);
  }
});
