import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseTag } from '../scripts/release-tag.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const env = { GH_TOKEN: 'test-token-must-stay-private', GITHUB_REPOSITORY: 'example/monstertrade', DEPLOY_SHA: sha };
const ref = 'refs/tags/v1.2.3';
const reference = (target = sha, type = 'commit') => ({ ref, object: { sha: target, type } });
const missing = () => new Response(null, { status: 404 });

test('tag validation rejects unsafe inputs before contacting GitHub', async () => {
  const options = { fetchImpl: async () => assert.fail('Invalid inputs must not contact GitHub') };
  for (const version of ['', '1.2', '01.2.3', '1.02.3', '1.2.03', '1.2.3-beta.1', '1.2.3+build', 'v1.2.3', '1.2.3\n', 123, null]) {
    await assert.rejects(releaseTag(version, env, options), /stable SemVer/);
  }
  for (const name of Object.keys(env)) {
    await assert.rejects(releaseTag('1.2.3', { ...env, [name]: '' }, options), new RegExp(`Missing ${name}`));
  }
  for (const repository of ['../repo', 'owner/..', 'owner/.', 'owner/repo/extra', 'owner/repo?query', 'owner/repo\n']) {
    await assert.rejects(releaseTag('1.2.3', { ...env, GITHUB_REPOSITORY: repository }, options), /Invalid release repository/);
  }
  for (const commit of ['main', 'a'.repeat(39), 'a'.repeat(41), `${sha}\n`, 'g'.repeat(40)]) {
    await assert.rejects(releaseTag('1.2.3', { ...env, DEPLOY_SHA: commit }, options), /exact 40-character/);
  }
  await assert.rejects(releaseTag('1.2.3', { ...env, GH_TOKEN: 'token\nsecret' }, options), /Invalid GH_TOKEN/);
  await assert.rejects(releaseTag('1.2.3', env, { ...options, publish: 'false' }), /boolean/);
});

test('read-only preflight accepts missing tags and protects request credentials', async () => {
  let calls = 0;
  const result = await releaseTag('1.2.3', env, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/example/monstertrade/git/ref/tags/v1.2.3');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${env.GH_TOKEN}`);
    assert.ok(options.signal instanceof AbortSignal);
    return missing();
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { tag: 'v1.2.3', sha, created: false });
  assert.ok(!JSON.stringify(result).includes(env.GH_TOKEN));
});

test('existing lightweight tags are idempotent only at the deployed commit', async () => {
  for (const publish of [false, true]) {
    let calls = 0;
    const result = await releaseTag('1.2.3', { ...env, DEPLOY_SHA: sha.toUpperCase() }, { publish, fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.method, 'GET');
      return Response.json(reference());
    } });
    assert.equal(result.created, false);
    assert.equal(calls, 1);
    await assert.rejects(releaseTag('1.2.3', env, { publish, fetchImpl: async () => Response.json(reference(otherSha)) }), /another commit.*never moved/);
  }
});

test('nested annotated tags resolve to the exact deployed commit', async () => {
  const tagSha = 'c'.repeat(40);
  const calls = [];
  const responses = [reference(otherSha, 'tag'), { sha: otherSha, object: { type: 'tag', sha: tagSha } }, { sha: tagSha, object: { type: 'commit', sha } }];
  const result = await releaseTag('1.2.3', env, { publish: true, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    return Response.json(responses.shift());
  } });
  assert.equal(result.created, false);
  assert.deepEqual(calls.map(url => url.split('/git/')[1]), ['ref/tags/v1.2.3', `tags/${otherSha}`, `tags/${tagSha}`]);
});

test('annotated tags fail closed on conflicts, cycles, excessive depth and malformed objects', async () => {
  const scenarios = [
    { body: { sha: otherSha, object: { type: 'commit', sha: otherSha } }, error: /another commit/ },
    { body: { sha: otherSha, object: { type: 'tag', sha: otherSha } }, error: /cyclic or too deep/ },
    { body: { sha, object: { type: 'commit', sha } }, error: /Malformed annotated/ },
    { body: { sha: otherSha, object: { type: 'tree', sha } }, error: /Malformed GitHub tag object/ },
    { status: 404, error: /annotated tag \(404\)/ },
  ];
  for (const scenario of scenarios) {
    await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async url => url.includes('/ref/')
      ? Response.json(reference(otherSha, 'tag'))
      : scenario.status ? new Response(null, { status: scenario.status }) : Response.json(scenario.body),
    }), scenario.error);
  }
  let calls = 0;
  await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async url => {
    calls++;
    if (url.includes('/ref/')) return Response.json(reference('1'.padStart(40, '0'), 'tag'));
    const current = url.split('/').at(-1);
    return Response.json({ sha: current, object: { type: 'tag', sha: (Number.parseInt(current, 16) + 1).toString(16).padStart(40, '0') } });
  } }), /cyclic or too deep/);
  assert.equal(calls, 9);
});

test('tag reads reject malformed responses, authorization failures and network errors without leaking tokens', async () => {
  for (const body of [null, [], {}, { ...reference(), ref: 'refs/tags/v1.2.30' }, reference('bad'), reference(sha, 'blob')]) {
    await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async () => Response.json(body) }), /Malformed/);
  }
  for (const status of [201, 403, 429, 500]) {
    await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async () => new Response(null, { status }) }), new RegExp(`read release tag \\(${status}\\)`));
  }
  await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async () => new Response('not json') }), /Malformed GitHub tag response/);
  await assert.rejects(releaseTag('1.2.3', env, { fetchImpl: async () => { throw new Error(`request error ${env.GH_TOKEN}`); } }), error => {
    assert.equal(error.message, 'GitHub tag request failed.');
    assert.ok(!error.message.includes(env.GH_TOKEN));
    return true;
  });
});

test('publishing creates only the absent lightweight ref at the deployed commit', async () => {
  const calls = [];
  const result = await releaseTag('1.2.3', env, { publish: true, fetchImpl: async (url, options) => {
    calls.push([url, options]);
    if (options.method === 'GET') return missing();
    assert.equal(url, 'https://api.github.com/repos/example/monstertrade/git/refs');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { ref, sha });
    return Response.json(reference(), { status: 201 });
  } });
  assert.equal(result.created, true);
  assert.deepEqual(calls.map(([, options]) => options.method), ['GET', 'POST']);
});

test('a creation race succeeds only if the competing tag targets the same commit', async () => {
  for (const competingSha of [sha, otherSha, null]) {
    let calls = 0;
    const operation = releaseTag('1.2.3', env, { publish: true, fetchImpl: async (_url, options) => {
      calls++;
      if (calls === 1) return missing();
      if (calls === 2) {
        assert.equal(options.method, 'POST');
        return new Response(null, { status: 422 });
      }
      assert.equal(options.method, 'GET');
      return competingSha ? Response.json(reference(competingSha)) : missing();
    } });
    if (competingSha === sha) assert.equal((await operation).created, false);
    else await assert.rejects(operation, competingSha ? /another commit/ : /tag does not exist/);
    assert.equal(calls, 3);
  }
});

test('publishing rejects failed or inconsistent creation responses without retrying mutations', async () => {
  for (const response of [new Response(null, { status: 403 }), new Response(null, { status: 500 }), Response.json(reference(otherSha), { status: 201 }), Response.json({}, { status: 201 })]) {
    let calls = 0;
    await assert.rejects(releaseTag('1.2.3', env, { publish: true, fetchImpl: async () => ++calls === 1 ? missing() : response }));
    assert.equal(calls, 2);
  }
});

test('CLI requires an explicit mode and reports missing credentials without making requests', () => {
  const script = fileURLToPath(new URL('../scripts/release-tag.mjs', import.meta.url));
  for (const args of [[], ['--force'], ['--check', '--publish']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: {} });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly one option/);
  }
  const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing GH_TOKEN/);
});
