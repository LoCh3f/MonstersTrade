import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { validateGitFlowMetadata } from './git-flow-metadata.mjs';

const shaPattern = /^[a-f\d]{40}$/;
const context = 'Git Flow';

// Run only from the reviewed policy revision in pull_request_target. PR content is API data,
// never checked out, imported, installed, or interpolated into shell commands.
export async function checkGitFlowPolicy(env = process.env, { fetchImpl = fetch, readFile = readFileSync, wait = delay } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request_target') throw new Error('Trusted policy requires pull_request_target.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')
    || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !env.GITHUB_EVENT_PATH
    || !env.GH_TOKEN || /[\s\x00-\x1f\x7f]/.test(env.GH_TOKEN)) throw new Error('Missing or malformed trusted workflow configuration.');
  const event = JSON.parse(readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = env.GITHUB_REPOSITORY;
  const number = event.pull_request?.number;
  const eventHead = event.pull_request?.head?.sha;
  if (event.repository?.full_name !== repository || !Number.isSafeInteger(number) || number < 1
    || !shaPattern.test(eventHead || '')) throw new Error('Malformed pull request identity.');
  const base = `https://api.github.com/repos/${repository}`;

  async function request(path, body) {
    let response;
    try {
      response = await fetchImpl(`${base}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Trusted policy GitHub request failed.'); }
    if (response.status !== (body ? 201 : 200)) throw new Error(`Trusted policy GitHub request returned ${response.status}.`);
    try { return await response.json(); }
    catch { throw new Error('Malformed trusted policy GitHub response.'); }
  }

  const statuses = new Set();
  async function status(state) {
    for (const sha of statuses) {
      await request(`statuses/${sha}`, {
        state, context,
        description: state === 'success' ? 'Pinned-policy Git Flow policy passed' : state === 'pending' ? 'Pinned-policy Git Flow policy is running' : 'Pinned-policy Git Flow policy failed; see workflow',
        target_url: `https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,
      });
    }
  }

  // Publish pending before validation. Do not reuse success from an earlier title
  // or base-branch event with the same head commit.
  statuses.add(eventHead);
  await status('pending');
  try {
    let pr;
    for (let attempt = 0; attempt < 10; attempt++) {
      pr = await request(`pulls/${number}`);
      if (pr.head?.sha !== eventHead) return 'Superseded PR event; no success was published.';
      if (pr.mergeable === false || (pr.mergeable === true && shaPattern.test(pr.merge_commit_sha || ''))) break;
      if (attempt < 9) await wait(2_000);
    }
    if (pr.number !== number || pr.state !== 'open' || pr.base?.repo?.full_name !== repository) throw new Error('The pull request is no longer open in this repository.');
    if (!shaPattern.test(pr.merge_commit_sha || '') || pr.mergeable !== true) throw new Error('A current, conflict-free test merge is required. Update the branch and rerun the policy.');
    // GitHub prefers checks on the test merge when present. Set the trusted
    // status on BOTH commits so a same-name PR job cannot hide a head failure.
    statuses.add(pr.merge_commit_sha);
    await status('pending');
    const testMerge = await request(`git/commits/${pr.merge_commit_sha}`);
    if (testMerge.sha !== pr.merge_commit_sha || !Array.isArray(testMerge.parents) || testMerge.parents.length !== 2
      || testMerge.parents[0].sha !== pr.base?.sha || testMerge.parents[1].sha !== pr.head?.sha) {
      throw new Error('Test merge parents do not match the current PR base and head.');
    }
    const { refs, count } = await validateGitFlowMetadata(pr, repository, request);
    const current = await request(`pulls/${number}`);
    if (current.state !== 'open' || current.head?.sha !== refs.headSha || current.base?.sha !== refs.baseSha
      || current.base?.ref !== refs.base || current.head?.ref !== refs.head || current.title !== pr.title
      || current.mergeable !== true || current.merge_commit_sha !== pr.merge_commit_sha) throw new Error('Pull request changed during validation; rerun the policy.');
    await status('success');
    return `Trusted Git Flow verified ${count} commit(s) on head and test merge.`;
  } catch (error) {
    await status('failure');
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(await checkGitFlowPolicy()); }
  catch (error) { console.error(`Trusted Git Flow failed: ${error.message}`); process.exitCode = 1; }
}
