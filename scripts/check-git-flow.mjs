import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const conventional = /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S(?:[^\r\n]*\S)?$/;
const versionPattern = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const stableVersion = new RegExp(`^${versionPattern}$`);
const productionBranch = new RegExp(`^(release|hotfix)/(${versionPattern})$`);
const workBranch = /^(?:feature|fix|docs|chore|ci|build|refactor|perf|test|style|dependabot)\//;
const stabilizationBranch = /^(?:fix|docs|chore|ci|test)\//;
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const commitSha = /^[a-f\d]{40}$/i;

function validBranch(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)
    && !name.includes('..') && !name.includes('//') && !name.endsWith('/')
    && name.split('/').every(part => !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}

export function validateConventional(subject, label = 'Commit') {
  if (typeof subject !== 'string' || !conventional.test(subject)) {
    throw new Error(`${label} must use Conventional Commits, for example "fix(prices): retain cached quotes".`);
  }
}

export function validatePullRequest(event, repository = event?.repository?.full_name) {
  const pr = event?.pull_request;
  if (!repositoryName.test(repository ?? '') || event?.repository?.full_name !== repository || !pr
    || !validBranch(pr.base?.ref) || !validBranch(pr.head?.ref)
    || !commitSha.test(pr.base?.sha ?? '') || !commitSha.test(pr.head?.sha ?? '')
    || !repositoryName.test(pr.base?.repo?.full_name ?? '') || !repositoryName.test(pr.head?.repo?.full_name ?? '')
    || pr.base.repo.full_name.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('Malformed pull request event or repository identity.');
  }
  validateConventional(pr.title, 'Pull request title');
  const base = pr.base.ref;
  const head = pr.head.ref;
  const sameRepository = pr.head.repo.full_name.toLowerCase() === repository.toLowerCase();
  const allowed = base === 'main'
    ? sameRepository && productionBranch.test(head)
    : base === 'develop'
      ? workBranch.test(head) || (sameRepository && (head === 'main' || head.startsWith('sync/')))
      : productionBranch.test(base) && stabilizationBranch.test(head);
  if (!allowed) throw new Error(`Git Flow does not allow ${head} → ${base}. Use develop for normal work and release/X.Y.Z or hotfix/X.Y.Z for production.`);
  return { base, head, baseSha: pr.base.sha, headSha: pr.head.sha };
}

function parseVersion(version) {
  if (typeof version !== 'string' || !stableVersion.test(version)) throw new Error('Production versions must use stable X.Y.Z without leading zeros.');
  return version.split('.').map(BigInt);
}

export function validateReleaseVersion({ head, basePackage, headPackage, headLock }) {
  const branch = productionBranch.exec(head);
  if (!branch) throw new Error('Production requires a release/X.Y.Z or hotfix/X.Y.Z branch.');
  const version = branch[2];
  if (headPackage?.version !== version || headLock?.version !== version || headLock?.packages?.['']?.version !== version) {
    throw new Error('Release branch, package.json, and both package-lock.json versions must match.');
  }
  const before = parseVersion(basePackage?.version);
  const after = parseVersion(version);
  const firstDifference = after.findIndex((part, index) => part !== before[index]);
  if (firstDifference < 0 || after[firstDifference] < before[firstDifference]) throw new Error('The production version must increase from main.');
  if (branch[1] === 'hotfix' && (after[0] !== before[0] || after[1] !== before[1])) {
    throw new Error('A hotfix must only increase the patch version of main.');
  }
}

function git(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error('Git history or version files are unavailable. Check out the complete PR history with fetch-depth: 0.'); }
}

export function checkGitFlow(env = process.env, { readFile = readFileSync, runGit = git } = {}) {
  if (['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    return 'Git Flow: branch routing is checked on pull requests; this run validates the branch through CI.';
  }
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !env.GITHUB_EVENT_PATH) throw new Error('Expected a pull_request event file, push, or workflow_dispatch.');
  const event = JSON.parse(readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  if (!env.GITHUB_REPOSITORY) throw new Error('Missing GITHUB_REPOSITORY for the pull request check.');
  const refs = validatePullRequest(event, env.GITHUB_REPOSITORY);
  const ancestor = runGit(['merge-base', refs.baseSha, refs.headSha]).trim();
  if (!commitSha.test(ancestor)) throw new Error('The pull request must share verified Git history with its target.');
  if (refs.base === 'develop' && refs.head.startsWith('sync/')) {
    // A conflict-resolution branch must carry main's history, not just copied patches.
    try { runGit(['merge-base', '--is-ancestor', 'refs/remotes/origin/main', refs.headSha]); }
    catch { throw new Error('The sync branch must contain current main history. Merge origin/main into the sync branch before retrying.'); }
  }
  const subjects = runGit(['log', '--format=%s', `${refs.baseSha}..${refs.headSha}`]).trimEnd().split('\n');
  for (const subject of subjects) validateConventional(subject);
  if (refs.base === 'main') {
    const jsonAt = (sha, file) => JSON.parse(runGit(['show', `${sha}:${file}`]));
    validateReleaseVersion({ head: refs.head, basePackage: jsonAt(refs.baseSha, 'package.json'), headPackage: jsonAt(refs.headSha, 'package.json'), headLock: jsonAt(refs.headSha, 'package-lock.json') });
  }
  return `Git Flow verified: ${refs.head} → ${refs.base}; ${subjects.length} Conventional Commit(s).`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(checkGitFlow()); }
  catch (error) { console.error(`Git Flow check failed: ${error.message}`); process.exitCode = 1; }
}
