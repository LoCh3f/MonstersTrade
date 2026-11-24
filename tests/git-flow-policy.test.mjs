import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGitFlowPolicy } from '../scripts/check-git-flow-policy.mjs';

const repository = 'example/monstertrade';
const head = 'b'.repeat(40), base = 'a'.repeat(40), merge = 'c'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_REPOSITORY: repository,
  GITHUB_RUN_ID: '123', GITHUB_EVENT_PATH: '/event.json', GH_TOKEN: 'synthetic-test-token' };
function fixture(overrides = {}, custom) {
  const pr = { number: 4, state: 'open', title: 'feat: add search', mergeable: true, merge_commit_sha: merge,
    base: { ref: 'develop', sha: base, repo: { full_name: repository } },
    head: { ref: 'feature/search', sha: head, repo: { full_name: 'contributor/fork' } }, ...overrides };
  const calls = [], statuses = [];
  const dependencies = {
    readFile: () => JSON.stringify({ repository: { full_name: repository }, pull_request: pr }),
    wait: async () => {},
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.Authorization, `Bearer ${env.GH_TOKEN}`);
      assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
      const path = url.split(`/repos/${repository}/`)[1];
      calls.push(path);
      if (options.method === 'POST') {
        assert.match(path, /^statuses\/[a-f\d]{40}$/);
        const body = JSON.parse(options.body);
        statuses.push({ sha: path.split('/')[1], ...body });
        return Response.json({}, { status: 201 });
      }
      const response = custom?.(path, calls);
      if (response) return response;
      if (path === 'pulls/4') return Response.json(pr);
      if (path === `git/commits/${merge}`) return Response.json({ sha: merge, parents: [{ sha: base }, { sha: head }] });
      if (path.startsWith('compare/')) return Response.json({ status: 'ahead', merge_base_commit: { sha: base }, total_commits: 1,
        commits: [{ sha: head, commit: { message: 'feat: add search\n\nA normal commit body.' } }] });
      assert.fail(`Unexpected metadata request: ${path}`);
    },
  };
  return { pr, calls, statuses, dependencies };
}

test('trusted policy checks fork metadata without loading its source and marks head AND merge', async () => {
  const f = fixture();
  assert.match(await checkGitFlowPolicy(env, f.dependencies), /Trusted Git Flow verified 1 commit/);
  assert.deepEqual(f.statuses.filter(s => s.state === 'success').map(s => s.sha), [head, merge]);
  assert.ok(f.statuses.every(s => s.context === 'Git Flow'));
  assert.ok(f.statuses.every(s => s.target_url === 'https://github.com/example/monstertrade/actions/runs/123'));
  assert.equal(f.calls.some(p => /contents|blobs|trees/.test(p)), false);
});

test('a PR replacing its own gate cannot change trusted routing or hide failure behind a merge check', async () => {
  const f = fixture({ base: { ref: 'main', sha: base, repo: { full_name: repository } },
    // Source content is deliberately inert metadata: the policy never imports it.
    body: 'scripts/check-git-flow.mjs now just exits successfully' });
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /does not allow/);
  assert.deepEqual(f.statuses.filter(s => s.state === 'failure').map(s => s.sha), [head, merge]);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
});

test('all PR commit subjects are inspected, including later API pages', async () => {
  const commits = Array.from({ length: 100 }, (_, i) => ({ sha: i.toString(16).padStart(40, '0'), commit: { message: 'fix: first page' } }));
  const f = fixture({}, path => {
    if (path.endsWith('page=1')) return Response.json({ merge_base_commit: { sha: base }, total_commits: 101, commits });
    if (path.endsWith('page=2')) return Response.json({ commits: [{ sha: head, commit: { message: 'Unconventional subject' } }] });
  });
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /Conventional Commits/);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
});

test('release version files are parsed as data from exact SHAs', async () => {
  const requested = [];
  const f = fixture({ base: { ref: 'main', sha: base, repo: { full_name: repository } },
    head: { ref: 'release/1.0.2', sha: head, repo: { full_name: repository } } }, path => {
    if (!path.startsWith('contents/')) return;
    requested.push(path);
    const version = path.endsWith(base) ? '1.0.1' : '1.0.2';
    const content = JSON.stringify({ version, packages: { '': { version } }, scripts: { postinstall: 'must-never-execute' } });
    return Response.json({ type: 'file', encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') });
  });
  await checkGitFlowPolicy(env, f.dependencies);
  assert.deepEqual(requested, [`contents/package.json?ref=${base}`, `contents/package.json?ref=${head}`, `contents/package-lock.json?ref=${head}`]);
});

test('changed PR metadata cannot inherit an earlier successful validation', async () => {
  const f = fixture({}, (path, calls) => path === 'pulls/4' && calls.filter(c => c === path).length === 2
    ? Response.json({ ...f.pr, title: 'A changed invalid title' }) : undefined);
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /changed during validation/);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
});

test('releases sharing old history but missing current main cannot pass policy', async () => {
  const f = fixture({ base: { ref: 'main', sha: base, repo: { full_name: repository } },
    head: { ref: 'hotfix/1.0.2', sha: head, repo: { full_name: repository } } }, path => path.startsWith('compare/')
    ? Response.json({ status: 'diverged', merge_base_commit: { sha: 'd'.repeat(40) }, total_commits: 1,
      commits: [{ sha: head, commit: { message: 'fix: stale hotfix' } }] }) : undefined);
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /contain the current main base/);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
});

test('missing test merge and incomplete commit pages fail closed', async () => {
  for (const overrides of [{ merge_commit_sha: null }, { mergeable: false }, { mergeable: null }]) {
    const f = fixture(overrides);
    await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /conflict-free test merge/);
    assert.equal(f.statuses.some(s => s.state === 'success'), false);
  }
  const f = fixture({}, path => path.startsWith('compare/') ? Response.json({ merge_base_commit: { sha: base }, total_commits: 1, commits: [] }) : undefined);
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /Incomplete/);
});

test('a stale merge SHA is ignored until GitHub finishes calculating mergeability', async () => {
  let waits = 0;
  const stale = 'e'.repeat(40);
  const f = fixture({}, (path, calls) => path === 'pulls/4' && calls.filter(c => c === path).length === 1
    ? Response.json({ ...f.pr, mergeable: null, merge_commit_sha: stale }) : undefined);
  await checkGitFlowPolicy(env, { ...f.dependencies, wait: async () => { waits++; } });
  assert.equal(waits, 1);
  assert.equal(f.statuses.some(s => s.sha === stale), false);
  assert.deepEqual(f.statuses.filter(s => s.state === 'success').map(s => s.sha), [head, merge]);
});

test('a test merge for a different head cannot receive a trusted passing status', async () => {
  const f = fixture({}, path => path === `git/commits/${merge}`
    ? Response.json({ sha: merge, parents: [{ sha: base }, { sha: 'e'.repeat(40) }] }) : undefined);
  await assert.rejects(checkGitFlowPolicy(env, f.dependencies), /Test merge parents do not match/);
  assert.deepEqual(f.statuses.filter(s => s.state === 'failure').map(s => s.sha), [head, merge]);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
});

test('a superseded event never publishes success for the new PR head', async () => {
  const f = fixture({}, path => path === 'pulls/4' ? Response.json({ ...f.pr, head: { ...f.pr.head, sha: 'd'.repeat(40) } }) : undefined);
  assert.match(await checkGitFlowPolicy(env, f.dependencies), /Superseded/);
  assert.equal(f.statuses.some(s => s.state === 'success'), false);
  assert.ok(f.statuses.every(s => s.sha === head));
});

test('untrusted invocation and network errors never expose a token', async () => {
  const f = fixture();
  for (const eventName of ['pull_request', 'push', 'workflow_dispatch']) {
    await assert.rejects(checkGitFlowPolicy({ ...env, GITHUB_EVENT_NAME: eventName }, f.dependencies), /requires pull_request_target/);
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(checkGitFlowPolicy(env, { ...f.dependencies, fetchImpl: async () => { throw new Error(env.GH_TOKEN); } }), error => {
    assert.equal(error.message.includes(env.GH_TOKEN), false);
    return /GitHub request failed/.test(error.message);
  });
});
