const REQUIRED_LIMITERS = ['PUBLIC_API_RATE_LIMITER', 'PRICE_ADMISSION_RATE_LIMITER'];

export function rateLimitsReady(env) {
  return env.REQUIRE_RATE_LIMITERS !== 'true' || REQUIRED_LIMITERS.every(name => typeof env[name]?.limit === 'function');
}

export function deployCommit(env) {
  return typeof env.DEPLOY_COMMIT === 'string' && /^[a-f0-9]{40}$/i.test(env.DEPLOY_COMMIT) ? env.DEPLOY_COMMIT.toLowerCase() : null;
}

// Never log requests, IPs, queries, card IDs, collections, provider bodies or raw errors.
export function operationalEvent(service, outcome, fields = {}) {
  const event = { event: 'public_price_service', service, outcome };
  for (const key of ['status', 'providerStatus', 'refreshed', 'failed']) {
    if (typeof fields[key] === 'number' || typeof fields[key] === 'boolean') event[key] = fields[key];
  }
  console.warn(JSON.stringify(event));
}

export async function checkRateLimit(request, env, name = 'PUBLIC_API_RATE_LIMITER') {
  const limiter = env[name];
  if (!limiter && env.REQUIRE_RATE_LIMITERS !== 'true') return null;
  try {
    if (typeof limiter?.limit !== 'function') throw new Error('Missing limiter');
    // Cloudflare supplies this header at its edge. Its hash is used only by the
    // ephemeral rate-limiter binding, never persisted in D1 or written to logs.
    const address = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(address.slice(0, 64)));
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const { success } = await limiter.limit({ key });
    if (success) return null;
    return Response.json({ error: 'Too many price requests. Please try again shortly.' }, { status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    operationalEvent('limits', 'unavailable', { status: 503 });
    return Response.json({ error: 'The public price service is temporarily unavailable.' }, { status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Content-Type-Options': 'nosniff' } });
  }
}
