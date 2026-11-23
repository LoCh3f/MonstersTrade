import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDeploymentPolicy } from '../scripts/check-deployment-policy.mjs';

const sha = 'c'.repeat(40), base = 'a'.repeat(40), head = 'b'.repeat(40);
const repository = 'example/monstertrade';
const env = { GITHUB_REPOSITORY: repository, DEPLOY_TARGET: 'staging', DEPLOY_SHA: sha, GH_TOKEN: 'synthetic-test-token' };
function fixture(changes = {}, custom) {
  const pr = { number: 5, state: 'closed', merged: true, merged_at: '2026-11-24T00:00:00Z', merge_commit_sha: sha,
    title: 'fix: harden collection import', base: { ref: 'develop', sha, repo: { full_name: repository } },
    head: { ref: 'fix/security', sha: head, repo: { full_name: 'contributor/fork' } }, ...changes };
  const paths = [];
  return { pr, paths, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, undefined, 'The independent deploy policy must never write GitHub state');
    const path = url.split(`/repos/${repository}/`)[1];
    paths.push(path);
    const override = custom?.(path, paths, pr);
    if (override) return override;
    if (path.startsWith('git/ref/heads/')) return Response.json({ object: { sha } });
    if (path === `git/commits/${sha}`) return Response.json({ sha, parents: [{ sha: base }, { sha: head }], message: 'fix: harden collection import (#5)' });
    if (path === `commits/${sha}/pulls?per_page=100`) return Response.json([pr]);
    if (path === 'pulls/5') return Response.json(pr);
    if (path === `compare/${base}...${head}?per_page=100&page=1`) return Response.json({ status: 'ahead', merge_base_commit: { sha: base }, total_commits: 1,
      commits: [{ sha: head, commit: { message: 'fix: harden collection import' } }] });
    assert.fail(`Unexpected request: ${path}`);
  } };
}

test('deployment policy revalidates merge metadata without trusting CI or loading candidate code', async () => {
  const f = fixture();
  assert.match(await checkDeploymentPolicy(env, f), /verified PR #5/);
  assert.equal(f.paths.some(path => /statuses|check-runs|actions|contents.*\.mjs/.test(path)), false);
  assert.ok(f.paths.includes(`compare/${base}...${head}?per_page=100&page=1`), 'Use the real first parent, not post-merge base metadata');
});

test('a malicious candidate gate reporting success cannot deploy a forbidden fork feature to main', async () => {
  const f = fixture({ base: { ref: 'main', sha, repo: { full_name: repository } },
    body: 'Candidate check-git-flow.mjs exits 0; all named status checks are green.' });
  await assert.rejects(checkDeploymentPolicy({ ...env, DEPLOY_TARGET: 'production' }, f), /does not allow/);
  assert.equal(f.paths.some(path => /statuses|check-runs|contents/.test(path)), false);
});

test('stale, direct-push, ambiguous and mismatched merge identities fail closed', async () => {
  const cases = [
    path => path.startsWith('git/ref/') ? Response.json({ object: { sha: head } }) : undefined,
    path => path.startsWith('git/commits/') ? Response.json({ sha, parents: [{ sha: base }] }) : undefined,
    (path, _paths, pr) => path.includes('/pulls?') ? Response.json([pr, pr]) : undefined,
    (path, _paths, pr) => path === 'pulls/5' ? Response.json({ ...pr, head: { ...pr.head, sha: base } }) : undefined,
  ];
  for (const override of cases) await assert.rejects(checkDeploymentPolicy(env, fixture({}, override)));
});

test('a release version is independently checked against the actual previous main version', async () => {
  const f = fixture({ base: { ref: 'main', sha, repo: { full_name: repository } },
    head: { ref: 'release/1.0.2', sha: head, repo: { full_name: repository } } }, path => {
    if (!path.startsWith('contents/')) return;
    const version = path.endsWith(base) ? '1.0.1' : '1.0.2';
    const content = JSON.stringify({ version, packages: { '': { version } } });
    return Response.json({ type: 'file', encoding: 'base64', size: content.length, content: Buffer.from(content).toString('base64') });
  });
  await checkDeploymentPolicy({ ...env, DEPLOY_TARGET: 'production' }, f);
  assert.ok(f.paths.includes(`contents/package.json?ref=${base}`));
});
