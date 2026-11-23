import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export async function checkProduction(url, { fetchImpl = fetch, wait = delay } = {}) {
  const origin = new URL(url);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('MONSTERTRADE_URL must be the HTTPS origin of the deployed app.');
  }
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetchImpl(new URL('/api/health', origin), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Health endpoint returned ${response.status}.`);
      const health = await response.json();
      if (health.service !== 'public-prices' || health.configured !== true || health.sealedConfigured !== true) throw new Error('Card or sealed price database is not configured.');
      return health;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await wait(5_000);
    }
  }
  if (lastError) throw lastError;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await checkProduction(process.env.MONSTERTRADE_URL);
    console.log('Production card and sealed price databases are healthy.');
  } catch (error) { console.error(`Production check failed: ${error.message}`); process.exitCode = 1; }
}
