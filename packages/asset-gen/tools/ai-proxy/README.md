# Clawbada AI Proxy

Cloudflare Worker that proxies RetroDiffusion API calls for the Template Editor. Pixel artists use AI generation without seeing the real API key.

## Setup (5 minutes)

```bash
# 1. Install wrangler (if needed)
npm install -g wrangler

# 2. Login to Cloudflare
npx wrangler login

# 3. Set your RetroDiffusion API key as a secret
npx wrangler secret put RD_API_KEY
# Paste your key when prompted

# 4. Create access tokens for artists (comma-separated)
npx wrangler secret put ACCESS_TOKENS
# Example: artist-alice-abc123,artist-bob-def456

# 5. Deploy
npx wrangler deploy
# Note the URL: https://clawbada-ai-proxy.<your-account>.workers.dev
```

## Optional: Rate Limiting

```bash
# Create a KV namespace
npx wrangler kv:namespace create RATE_LIMIT
# Copy the id from the output

# Edit wrangler.toml: uncomment the [[kv_namespaces]] section
# and paste the id

# Redeploy
npx wrangler deploy
```

## Giving Access to an Artist

1. Generate a unique token: `openssl rand -hex 16`
2. Add it to ACCESS_TOKENS: `npx wrangler secret put ACCESS_TOKENS`
3. In the Template Editor:
   - Set AI mode to **Proxy**
   - Enter the worker URL
   - Enter the artist's access token
4. The artist can now generate AI pixel art using your credits

## Revoking Access

Remove the token from ACCESS_TOKENS and redeploy:
```bash
npx wrangler secret put ACCESS_TOKENS
# Enter remaining valid tokens only
```

## Security

- Real API key never leaves Cloudflare's edge network
- Each artist gets a unique, revocable token
- Daily rate limit (default: 100/day per token)
- Request validation: prompt length cap, forced 1 image, size limits
- Account balance info stripped from responses
