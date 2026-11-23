import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
const persistence = await mkdtemp(join(tmpdir(), 'monstertrade-smoke-'));
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
let server, serverExit, output = '';

function launch(args) {
  return spawn(process.execPath, [wrangler, ...args], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false,
  });
}

function capture(child) {
  const append = chunk => { output = (output + chunk.toString()).slice(-16000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
}

function stop(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function run(args) {
  const child = launch(args);
  capture(child);
  const timer = setTimeout(() => stop(child, 'SIGKILL'), 60_000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, `Wrangler ${args[0]} failed or timed out`);
  } finally { clearTimeout(timer); }
}

async function availablePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

try {
  // An isolated empty database proves that every committed migration is present.
  // Nothing reads or modifies the developer's .wrangler database.
  await run(['d1', 'migrations', 'apply', 'PRICES_DB', '--local', '--persist-to', persistence]);
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000), ...options });
  server = launch(['dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistence]);
  capture(server);
  serverExit = once(server, 'exit');
  // Readiness and all checks use the local Worker only, never live price providers.
  let ready = false;
  for (const deadline = Date.now() + 45_000; Date.now() < deadline;) {
    assert.equal(server.exitCode, null, 'Local Worker exited before readiness');
    try { ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Local Worker did not become ready within 45 seconds');
  const health = await (await request('/api/health')).json();
  assert.equal(health.configured, true, 'Card price migrations are not ready');
  assert.equal(health.sealedConfigured, true, 'Sealed price migrations are not ready');
  assert.equal(health.service, 'public-prices');

  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /<title>Monstertrade/);
  for (const [path, type] of [
    ['/app.js', /javascript/], ['/styles.css', /text\/css/],
    ['/assets/monstertrade-logo.jpg', /image\/jpeg/], ['/featured.json', /application\/json/],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} is missing from the static bundle`);
    assert.match(response.headers.get('content-type'), type, `${path} has the wrong MIME type`);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `${path} is empty`);
  }
  for (const path of ['/api/prices/sv03.5-199/history', '/api/sealed/sealed-tcgp-1-eu/history']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} must work on a fresh database`);
    assert.deepEqual((await response.json()).points, [], 'Fresh history must be empty');
  }
  assert.equal((await request('/api/unknown')).status, 404);
  assert.equal((await request('/api/health', { method: 'POST' })).status, 405);
  assert.equal((await request('/missing-static-asset.js')).status, 404, 'Missing assets must not return the app shell');
  console.log('Smoke checks passed: fresh D1 migrations, card/sealed health and history, static assets, and API boundaries.');
} catch (error) {
  console.error(output);
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server) {
    stop(server);
    await Promise.race([serverExit, delay(5000, undefined, { ref: false })]);
    stop(server, 'SIGKILL');
  }
  await rm(persistence, { recursive: true, force: true });
}
