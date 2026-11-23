import { experimental_readRawConfig } from 'wrangler';
import { deploymentPlan } from './deploy.mjs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function checkRelease(env = process.env, { fetchImpl = fetch, rawConfig } = {}) {
  for (const name of ['GH_TOKEN', 'DEPLOY_SHA', 'GITHUB_REPOSITORY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_DATABASE_ID']) {
    if (!env[name]) throw new Error(`Missing ${name}. Configure the repository Actions secrets and variables documented in README.md.`);
  }
  const config = rawConfig ?? experimental_readRawConfig({ config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)) }).rawConfig;
  deploymentPlan(config, env);
  const { GITHUB_REPOSITORY: repository, DEPLOY_SHA: sha } = env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f\d]{40}$/i.test(sha)) throw new Error('Invalid release repository or commit.');
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Could not verify the main branch (${response.status}).`);
  const head = await response.json();
  if (head.object?.sha !== sha) throw new Error('This commit is no longer the latest main. Deploy the latest successful CI run instead.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await checkRelease();
    console.log('Latest main commit and required Cloudflare configuration verified.');
  } catch (error) { console.error(`Release stopped: ${error.message}`); process.exitCode = 1; }
}
