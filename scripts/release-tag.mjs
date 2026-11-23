import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[a-f\d]{40}$/i;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function releaseTag(version, env = process.env, { publish = false, fetchImpl = fetch } = {}) {
  if (typeof version !== 'string' || version.trim() !== version || !versionPattern.test(version)) throw new Error('Package version must be stable SemVer: X.Y.Z.');
  for (const name of ['GH_TOKEN', 'DEPLOY_SHA', 'GITHUB_REPOSITORY']) {
    if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Missing ${name}.`);
  }
  const { GITHUB_REPOSITORY: repository, GH_TOKEN: token } = env;
  if (repository.trim() !== repository || !/^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(repository) || ['.', '..'].includes(repository.split('/')[1])) throw new Error('Invalid release repository.');
  if (env.DEPLOY_SHA.length !== 40 || !shaPattern.test(env.DEPLOY_SHA)) throw new Error('DEPLOY_SHA must be an exact 40-character commit SHA.');
  if (/[\s\x00-\x1f\x7f]/.test(token)) throw new Error('Invalid GH_TOKEN.');
  if (typeof publish !== 'boolean') throw new Error('Publish must be a boolean.');
  const sha = env.DEPLOY_SHA.toLowerCase();
  const tag = `v${version}`;
  const ref = `refs/tags/${tag}`;
  const base = `https://api.github.com/repos/${repository}/git`;

  async function request(path, body) {
    try {
      return await fetchImpl(`${base}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('GitHub tag request failed.'); }
  }

  async function json(response) {
    try { return await response.json(); }
    catch { throw new Error('Malformed GitHub tag response.'); }
  }

  function object(value) {
    if (!value || !['commit', 'tag'].includes(value.type) || typeof value.sha !== 'string' || value.sha.length !== 40 || !shaPattern.test(value.sha)) throw new Error('Malformed GitHub tag object.');
    return { type: value.type, sha: value.sha.toLowerCase() };
  }

  async function existingTag() {
    const response = await request(`ref/tags/${tag}`);
    if (response.status === 404) return false;
    if (response.status !== 200) throw new Error(`Could not read release tag (${response.status}).`);
    const data = await json(response);
    if (data?.ref !== ref) throw new Error('Malformed GitHub tag reference.');
    let target = object(data.object);
    const visited = new Set();
    while (target.type === 'tag') {
      if (visited.has(target.sha) || visited.size >= 8) throw new Error('Annotated tag chain is cyclic or too deep.');
      visited.add(target.sha);
      const annotation = await request(`tags/${target.sha}`);
      if (annotation.status !== 200) throw new Error(`Could not read annotated tag (${annotation.status}).`);
      const data = await json(annotation);
      if (typeof data?.sha !== 'string' || data.sha.toLowerCase() !== target.sha) throw new Error('Malformed annotated tag response.');
      target = object(data.object);
    }
    if (target.sha !== sha) throw new Error(`${tag} already points to another commit; tags are never moved.`);
    return true;
  }

  if (await existingTag()) return { tag, sha, created: false };
  if (!publish) return { tag, sha, created: false };
  const response = await request('refs', { ref, sha });
  if (response.status === 422) {
    if (await existingTag()) return { tag, sha, created: false };
    throw new Error('Release tag creation failed (422); the tag does not exist.');
  }
  if (response.status !== 201) throw new Error(`Could not create release tag (${response.status}).`);
  const data = await json(response);
  const target = object(data?.object);
  if (data?.ref !== ref || target.type !== 'commit' || target.sha !== sha) throw new Error('Created release tag response does not match the deployed commit.');
  return { tag, sha, created: true };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !['--check', '--publish'].includes(args[0])) throw new Error('Use exactly one option: --check or --publish.');
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const result = await releaseTag(version, process.env, { publish: args[0] === '--publish' });
    console.log(`${result.tag}: ${args[0] === '--check' ? 'checked' : result.created ? 'created' : 'already exists'} for ${result.sha}.`);
  } catch (error) { console.error(`Release tag stopped: ${error.message}`); process.exitCode = 1; }
}
