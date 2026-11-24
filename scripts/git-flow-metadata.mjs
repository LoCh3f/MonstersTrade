import { validateConventional, validatePullRequest, validateReleaseVersion } from './check-git-flow.mjs';

const shaPattern = /^[a-f\d]{40}$/;
const maximumCommits = 1000;

// All candidate content is read as GitHub API data, never executable code.
export async function validateGitFlowMetadata(pr, repository, request) {
  const refs = validatePullRequest({ repository: { full_name: repository }, pull_request: pr }, repository);
  const comparison = await request(`compare/${refs.baseSha}...${refs.headSha}?per_page=100&page=1`);
  if (!shaPattern.test(comparison.merge_base_commit?.sha || '') || !Number.isSafeInteger(comparison.total_commits)
    || comparison.total_commits < 1 || comparison.total_commits > maximumCommits || !Array.isArray(comparison.commits)) {
    throw new Error(`Expected shared history and between 1 and ${maximumCommits} PR commits.`);
  }
  if (refs.base === 'main' && (comparison.status !== 'ahead' || comparison.merge_base_commit.sha !== refs.baseSha)) {
    throw new Error('A release or hotfix must contain the current main base before merging.');
  }
  const commits = [...comparison.commits];
  for (let page = 2; commits.length < comparison.total_commits; page++) {
    const next = await request(`compare/${refs.baseSha}...${refs.headSha}?per_page=100&page=${page}`);
    if (!Array.isArray(next.commits) || next.commits.length === 0 || page > 10) throw new Error('Incomplete pull request commit history.');
    commits.push(...next.commits);
  }
  if (commits.length !== comparison.total_commits || new Set(commits.map(commit => commit.sha)).size !== commits.length) throw new Error('Inconsistent pull request commit history.');
  for (const commit of commits) {
    if (!shaPattern.test(commit.sha || '') || typeof commit.commit?.message !== 'string') throw new Error('Malformed pull request commit.');
    validateConventional(commit.commit.message.split('\n')[0]);
  }
  if (refs.base === 'develop' && refs.head.startsWith('sync/')) {
    const main = await request('git/ref/heads/main');
    if (!shaPattern.test(main.object?.sha || '')) throw new Error('Malformed main reference.');
    const sync = await request(`compare/${main.object.sha}...${refs.headSha}?per_page=1`);
    if (!['ahead', 'identical'].includes(sync.status)) throw new Error('The sync branch must contain current main history.');
  }
  if (refs.base === 'main') {
    const jsonAt = async (sha, file) => {
      const data = await request(`contents/${file}?ref=${sha}`);
      if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string'
        || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > 1024 * 1024) throw new Error('Malformed release version file.');
      try { return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')); }
      catch { throw new Error('Release version files must contain valid JSON.'); }
    };
    validateReleaseVersion({ head: refs.head,
      basePackage: await jsonAt(refs.baseSha, 'package.json'),
      headPackage: await jsonAt(refs.headSha, 'package.json'),
      headLock: await jsonAt(refs.headSha, 'package-lock.json') });
  }
  return { refs, count: commits.length };
}
