import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkGitFlow, validateConventional, validatePullRequest, validateReleaseVersion } from '../scripts/check-git-flow.mjs';

const repo = 'example/monstertrade';
const baseSha = 'a'.repeat(40);
const headSha = 'b'.repeat(40);
function event(base = 'develop', head = 'feature/card-search', headRepo = repo) {
  return { repository: { full_name: repo }, pull_request: {
    title: 'feat(search): add card filters',
    base: { ref: base, sha: baseSha, repo: { full_name: repo } },
    head: { ref: head, sha: headSha, repo: { full_name: headRepo } },
  } };
}
function versions(head = 'release/1.2.0', previous = '1.1.0', version = head.split('/')[1]) {
  return { head, basePackage: { version: previous }, headPackage: { version }, headLock: { version, packages: { '': { version } } } };
}

test('Git Flow routes normal work and dependency updates through develop, releases through main', () => {
  for (const head of ['feature/search', 'fix/cache', 'docs/readme', 'chore/tooling', 'ci/pipeline', 'build/deps', 'refactor/model', 'perf/parser', 'test/import', 'style/cards', 'dependabot/npm_and_yarn/tools-123']) {
    assert.equal(validatePullRequest(event('develop', head)).head, head);
    assert.throws(() => validatePullRequest(event('main', head)), /does not allow/);
  }
  for (const head of ['release/1.2.0', 'hotfix/1.1.1']) assert.equal(validatePullRequest(event('main', head)).base, 'main');
  assert.equal(validatePullRequest(event('develop', 'main')).head, 'main');
  assert.equal(validatePullRequest(event('develop', 'sync/main-into-develop')).head, 'sync/main-into-develop');
  for (const base of ['release/1.2.0', 'hotfix/1.1.1']) {
    for (const head of ['fix/regression', 'docs/changelog', 'chore/version', 'ci/repair', 'test/regression']) assert.equal(validatePullRequest(event(base, head)).base, base);
    assert.throws(() => validatePullRequest(event(base, 'feature/new-product')), /does not allow/);
  }
  assert.throws(() => validatePullRequest(event('develop', 'release/1.2.0')), /does not allow/);
});

test('forks can contribute work but cannot impersonate production or main sync branches', () => {
  assert.equal(validatePullRequest(event('develop', 'feature/search', 'contributor/fork')).base, 'develop');
  for (const [base, head] of [['main', 'release/1.2.0'], ['main', 'hotfix/1.1.1'], ['develop', 'main'], ['develop', 'sync/main-into-develop']]) {
    assert.throws(() => validatePullRequest(event(base, head, 'contributor/fork')), /does not allow/);
  }
  assert.throws(() => validatePullRequest(event(), 'other/repo'), /repository identity/);
});

test('malformed refs, missing identities, and command-like branch names fail closed', () => {
  for (const input of [null, {}, { pull_request: {} }]) assert.throws(() => validatePullRequest(input), /Malformed/);
  for (const head of ['feature/', 'feature/../main', 'feature//one', 'feature/$(touch pwned)', 'feature/x;echo bad', 'feature/x\nmain', 'feature/x.lock', 'feature/.hidden']) {
    assert.throws(() => validatePullRequest(event('develop', head)), /Malformed/);
  }
  for (const mutate of [e => delete e.pull_request.head.repo, e => e.pull_request.base.sha = 'main', e => e.pull_request.head.sha = '--all', e => e.pull_request.base.repo.full_name = 'other/repo']) {
    const input = event(); mutate(input); assert.throws(() => validatePullRequest(input), /Malformed/);
  }
  for (const head of ['release/01.2.0', 'release/1.2.0-beta.1', 'hotfix/1.2', 'release/latest']) assert.throws(() => validatePullRequest(event('main', head)), /does not allow/);
});

test('Conventional Commits apply to titles and every commit, including merge subjects', () => {
  for (const subject of ['feat: support sealed boxes', 'fix(prices)!: change quote schema', 'chore: sync main into develop (#12)', 'ci(github/actions): validate releases', 'revert: restore the cache']) validateConventional(subject);
  for (const subject of ['', 'fix: ', 'Update README', 'Merge pull request #1', 'fix: good\nmalicious: second line', 'fix(scope):  extra padding', 'feature: add cards']) {
    assert.throws(() => validateConventional(subject), /Conventional Commits/);
  }
  const input = event(); input.pull_request.title = 'Update pipeline';
  assert.throws(() => validatePullRequest(input), /Pull request title/);
});

test('production branch and package versions must agree and advance stable main version', () => {
  validateReleaseVersion(versions());
  validateReleaseVersion(versions('release/2.0.0', '1.9.9'));
  validateReleaseVersion(versions('hotfix/1.1.2', '1.1.1'));
  for (const input of [versions('release/1.1.0', '1.1.0'), versions('release/1.0.9', '1.1.0'), versions('hotfix/1.2.0', '1.1.0'), versions('hotfix/2.0.0', '1.1.0'), versions('release/1.2.0', '1.1.0', '1.3.0')]) {
    assert.throws(() => validateReleaseVersion(input));
  }
  for (const mutate of [v => v.headLock.version = '9.0.0', v => v.headLock.packages[''].version = '9.0.0', v => delete v.headLock.packages[''], v => v.basePackage.version = '1.0.0-rc.1']) {
    const input = versions(); mutate(input); assert.throws(() => validateReleaseVersion(input));
  }
});

const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '/event.json', GITHUB_REPOSITORY: repo };
function fixture(input = event(), subjects = 'feat: add card filters\nfix: preserve cached prices\n') {
  const calls = [];
  return { calls, readFile: () => JSON.stringify(input), runGit: args => {
    calls.push(args);
    if (args[0] === 'merge-base') return `${'c'.repeat(40)}\n`;
    if (args[0] === 'log') return subjects;
    if (args[0] === 'show') {
      if (args[1] === `${baseSha}:package.json`) return JSON.stringify({ version: '1.1.0' });
      if (args[1] === `${headSha}:package.json`) return JSON.stringify({ version: '1.2.0' });
      if (args[1] === `${headSha}:package-lock.json`) return JSON.stringify({ version: '1.2.0', packages: { '': { version: '1.2.0' } } });
    }
    assert.fail(`Unexpected git invocation: ${args}`);
  } };
}

test('the PR gate validates actual head commits and version files through argument-safe git calls', () => {
  const mock = fixture(event('main', 'release/1.2.0'));
  assert.match(checkGitFlow(env, mock), /2 Conventional Commit/);
  assert.deepEqual(mock.calls[1], ['log', '--format=%s', `${baseSha}..${headSha}`]);
  assert.deepEqual(mock.calls.slice(2), [['show', `${baseSha}:package.json`], ['show', `${headSha}:package.json`], ['show', `${headSha}:package-lock.json`]]);
  assert.throws(() => checkGitFlow(env, fixture(event(), 'feat: add search\nUpdate README\n')), /Conventional Commits/);
  assert.throws(() => checkGitFlow(env, fixture(event(), '')), /Conventional Commits/);
});

test('missing event data, Git history, and malformed JSON do not silently pass', () => {
  assert.throws(() => checkGitFlow({}), /Expected/);
  assert.throws(() => checkGitFlow({ ...env, GITHUB_EVENT_NAME: 'pull_request_target' }), /Expected/);
  assert.throws(() => checkGitFlow(env, { readFile: () => '{bad json' }));
  assert.throws(() => checkGitFlow({ ...env, GITHUB_REPOSITORY: undefined }, fixture()), /Missing GITHUB_REPOSITORY/);
  assert.throws(() => checkGitFlow(env, { ...fixture(), runGit: () => { throw new Error('history missing'); } }), /history missing/);
  assert.throws(() => checkGitFlow(env, { ...fixture(), runGit: () => '' }), /verified Git history/);
  for (const name of ['push', 'workflow_dispatch']) {
    assert.match(checkGitFlow({ GITHUB_EVENT_NAME: name }, { readFile: () => assert.fail('not a PR'), runGit: () => assert.fail('not a PR') }), /checked on pull requests/);
  }
});

test('conflict-resolution sync branches must contain the current main history', () => {
  const mock = fixture(event('develop', 'sync/main-into-develop'), 'chore: merge main into develop\n');
  const runGit = args => {
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      assert.deepEqual(args, ['merge-base', '--is-ancestor', 'refs/remotes/origin/main', headSha]);
      return '';
    }
    return mock.runGit(args);
  };
  assert.match(checkGitFlow(env, { ...mock, runGit }), /sync\/main-into-develop/);
  assert.throws(() => checkGitFlow(env, { ...mock, runGit: args => {
    if (args[1] === '--is-ancestor') throw new Error('sync branch does not contain main');
    return mock.runGit(args);
  } }), /must contain current main history/);
});

test('the gate inspects real Git history rather than the checkout merge message', () => {
  const directory = mkdtempSync(join(tmpdir(), 'monstertrade-git-flow-'));
  const runGit = args => execFileSync('git', ['-c', 'user.name=Git Flow Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    runGit(['init', '-b', 'develop']);
    runGit(['commit', '--allow-empty', '-m', 'Existing pre-policy history']);
    const input = event();
    input.pull_request.base.sha = runGit(['rev-parse', 'HEAD']).trim();
    runGit(['switch', '-c', input.pull_request.head.ref]);
    writeFileSync(join(directory, 'filter.txt'), 'set=151\n');
    runGit(['add', 'filter.txt']);
    runGit(['commit', '-m', 'feat(search): add a set filter']);
    input.pull_request.head.sha = runGit(['rev-parse', 'HEAD']).trim();
    assert.match(checkGitFlow(env, { readFile: () => JSON.stringify(input), runGit }), /1 Conventional Commit/);
    runGit(['commit', '--allow-empty', '-m', 'Update filter']);
    input.pull_request.head.sha = runGit(['rev-parse', 'HEAD']).trim();
    assert.throws(() => checkGitFlow(env, { readFile: () => JSON.stringify(input), runGit }), /Conventional Commits/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
