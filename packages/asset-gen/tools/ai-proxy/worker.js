/**
 * Clawbada AI Proxy — Cloudflare Worker
 *
 * Proxies RetroDiffusion API calls so pixel artists can use AI generation
 * without accessing the real API key. The key lives in CF Worker Secrets.
 *
 * Security:
 *   - Real API key stored as CF secret (RD_API_KEY), never sent to client
 *   - Access controlled via bearer tokens (ACCESS_TOKENS secret, comma-separated)
 *   - Per-token rate limiting via CF KV (optional)
 *   - Daily credit cap per token (optional)
 *   - CORS restricted to allowed origins
 *
 * Deploy:
 *   npx wrangler deploy
 *
 * Secrets (set via `npx wrangler secret put <NAME>`):
 *   RD_API_KEY       — Your RetroDiffusion API key
 *   ACCESS_TOKENS    — Comma-separated bearer tokens for authorized users
 *                      e.g. "artist-alice-abc123,artist-bob-def456"
 *
 * Optional KV binding (for rate limiting):
 *   Bind a KV namespace called RATE_LIMIT in wrangler.toml
 *
 * Environment variables (in wrangler.toml [vars]):
 *   DAILY_LIMIT      — Max requests per token per day (default: 100)
 *   ALLOWED_ORIGINS  — Comma-separated allowed CORS origins (default: "*")
 */

export default {
  async fetch(request, env) {
    // ── CORS preflight ──
    if (request.method === 'OPTIONS') {
      return corsResponse(env, new Response(null, { status: 204 }));
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return corsResponse(env, jsonError('Method not allowed', 405));
    }

    // ── Auth ──
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return corsResponse(env, jsonError('Missing Authorization header', 401));
    }

    const validTokens = (env.ACCESS_TOKENS || '').split(',').map(t => t.trim()).filter(Boolean);
    if (validTokens.length === 0) {
      return corsResponse(env, jsonError('Server misconfigured: no access tokens set', 500));
    }

    if (!validTokens.includes(token)) {
      return corsResponse(env, jsonError('Invalid access token', 403));
    }

    // ── Rate limiting (optional, requires KV binding) ──
    if (env.RATE_LIMIT) {
      const dailyLimit = parseInt(env.DAILY_LIMIT) || 100;
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const rlKey = `rl:${token}:${today}`;

      const current = parseInt(await env.RATE_LIMIT.get(rlKey)) || 0;
      if (current >= dailyLimit) {
        return corsResponse(env, jsonError(`Daily limit reached (${dailyLimit}/day). Try again tomorrow.`, 429));
      }

      // Increment (TTL = 48h to auto-cleanup)
      await env.RATE_LIMIT.put(rlKey, String(current + 1), { expirationTtl: 172800 });
    }

    // ── Parse and validate request body ──
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(env, jsonError('Invalid JSON body', 400));
    }

    // Allowlist of fields to forward (prevent injection of unexpected params)
    const sanitized = {};
    const ALLOWED_FIELDS = ['prompt', 'width', 'height', 'num_images', 'prompt_style', 'seed'];
    for (const field of ALLOWED_FIELDS) {
      if (body[field] !== undefined) sanitized[field] = body[field];
    }

    // Enforce limits
    if (!sanitized.prompt || typeof sanitized.prompt !== 'string') {
      return corsResponse(env, jsonError('Missing or invalid prompt', 400));
    }
    if (sanitized.prompt.length > 1000) {
      return corsResponse(env, jsonError('Prompt too long (max 1000 chars)', 400));
    }
    sanitized.num_images = 1; // Always 1, prevent credit abuse
    sanitized.width = Math.min(Math.max(sanitized.width || 64, 64), 256);
    sanitized.height = Math.min(Math.max(sanitized.height || 64, 64), 256);

    // ── Proxy to RetroDiffusion ──
    const rdKey = env.RD_API_KEY;
    if (!rdKey) {
      return corsResponse(env, jsonError('Server misconfigured: no API key set', 500));
    }

    try {
      const rdResp = await fetch('https://api.retrodiffusion.ai/v1/inferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RD-Token': rdKey,
        },
        body: JSON.stringify(sanitized),
      });

      const rdData = await rdResp.json();

      // Strip sensitive fields from response before forwarding
      const clientResponse = {
        base64_images: rdData.base64_images || [],
        model: rdData.model,
        // Don't forward: remaining_balance, balance_cost (exposes account info)
      };

      // Include remaining daily quota in response header
      if (env.RATE_LIMIT) {
        const dailyLimit = parseInt(env.DAILY_LIMIT) || 100;
        const today = new Date().toISOString().slice(0, 10);
        const rlKey = `rl:${token}:${today}`;
        const current = parseInt(await env.RATE_LIMIT.get(rlKey)) || 0;
        clientResponse._remaining = dailyLimit - current;
      }

      return corsResponse(env, new Response(JSON.stringify(clientResponse), {
        status: rdResp.status,
        headers: { 'Content-Type': 'application/json' },
      }));

    } catch (err) {
      return corsResponse(env, jsonError('Upstream API error: ' + err.message, 502));
    }
  },
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsResponse(env, response) {
  const origins = (env.ALLOWED_ORIGINS || '*').split(',').map(o => o.trim());
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origins[0] === '*' ? '*' : origins.join(', '));
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}
