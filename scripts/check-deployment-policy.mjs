import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateConventional } from './check-git-flow.mjs';
import { validateGitFlowMetadata } from './git-flow-metadata.mjs';

const shaPattern = /^[a-f\d]{40}$/;

// Execute from GIT_FLOW_POLICY_SHA in a clean job before the candidate checkout,
// npm installation, environment selection, or any Cloudflare secret is available.
export async function checkDeploymentPolicy(env = process.env, { fetchImpl = fetch } = {}) {
  const { GITHUB_REPOSITORY: repository, DEPLOY_SHA: sha, DEPLOY_TARGET: target } = env;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !shaPattern.test(sha || '')
    || !['staging', 'production'].includes(target) || !env.GH_TOKEN || /[\s\x00-\x1f\x7f]/.test(env.GH_TOKEN)) {
    throw new Error('Missing or malformed deployment policy configuration.');
  }
  const branch = target === 'production' ? 'main' : 'develop';
  async function request(path) {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}/${path}`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Deployment policy GitHub request failed.'); }
    if (response.status !== 200) throw new Error(`Deployment policy GitHub request returned ${response.status}.`);
    try { return await response.json(); }
    catch { throw new Error('Malformed deployment policy GitHub response.'); }
  }
  const current = await request(`git/ref/heads/${branch}`);
  if (current.object?.sha !== sha) throw new Error(`Deploy only the latest ${branch} commit.`);
  const commit = await request(`git/commits/${sha}`);
  if (commit.sha !== sha || !Array.isArray(commit.parents) || commit.parents.length !== 2
    || commit.parents.some(parent => !shaPattern.test(parent.sha || ''))) throw new Error('Deployment requires a two-parent pull request merge commit.');
  validateConventional(typeof commit.message === 'string' ? commit.message.split('\n')[0] : undefined, 'Merge commit');
  const associated = await request(`commits/${sha}/pulls?per_page=100`);
  if (!Array.isArray(associated)) throw new Error('Malformed merged pull request metadata.');
  const matches = associated.filter(pr => pr.merged_at && pr.merge_commit_sha === sha && pr.base?.ref === branch);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].number) || matches[0].number < 1) throw new Error('Expected exactly one merged pull request for this deployment.');
  const pr = await request(`pulls/${matches[0].number}`);
  if (pr.state !== 'closed' || pr.merged !== true || pr.merge_commit_sha !== sha || pr.base?.ref !== branch
    || pr.head?.sha !== commit.parents[1].sha || pr.base?.repo?.full_name !== repository) throw new Error('The deployment does not match the merged pull request.');
  // Git's first parent fixes the actual pre-merge base even if branch/API metadata
  // has advanced. Never trust a passing check or candidate-provided policy script.
  const { count } = await validateGitFlowMetadata({ ...pr, base: { ...pr.base, sha: commit.parents[0].sha } }, repository, request);
  const latest = await request(`git/ref/heads/${branch}`);
  if (latest.object?.sha !== sha) throw new Error('Target branch changed during policy validation.');
  return `Independent deployment policy verified PR #${pr.number} and ${count} commit(s).`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(await checkDeploymentPolicy()); }
  catch (error) { console.error(`Deployment policy failed: ${error.message}`); process.exitCode = 1; }
}
