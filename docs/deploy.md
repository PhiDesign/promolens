# Deploying the hosted PromoLens API

This is the server behind "included analyses" and PromoLens Plus. It is the same `apps/api` you run locally, started with `QUOTA_ENABLED=true` and your own model key. One small instance is plenty: each analysis is one model call; the server holds no post content beyond a 24-hour in-memory cache keyed by hash, plus a tiny usage file.

## What it needs

| Setting | Value |
| --- | --- |
| `ANALYSIS_PROVIDER` | `openai` |
| `ANALYSIS_PROVIDER_API_KEY` | your OpenAI key (secret) |
| `LLM_MODEL` | `gpt-5-mini` |
| `QUOTA_ENABLED` | `true` |
| `LEMONSQUEEZY_PRODUCT_ID` | `1350697` |
| `FREE_INITIAL` / `FREE_MONTHLY` / `PLUS_MONTHLY` | `20` / `5` / `500` (defaults) |
| `DATA_DIR` | a directory on a **persistent disk**, e.g. `/data` |
| `ALLOWED_ORIGINS` | `chrome-extension://<your store extension id>` (use `chrome-extension://*` until the id is known) |
| `PORT` | whatever the host gives you (`process.env.PORT` is honoured) |
| `LLM_TIMEOUT_MS` / `REQUEST_TIMEOUT_MS` | `45000` / `50000` |

Run command: `npm run start --workspace=apps/api` after `npm ci && npm run build --workspace=apps/api` (the build bundles the server into `apps/api/dist/server.js`).

## Render (recommended for a first deployment)

1. Create a **Web Service** from the GitHub repo. Runtime: Node. Root directory: leave as the repo root.
2. Build command: `npm ci && npm run build --workspace=apps/api`. Start command: `npm run start --workspace=apps/api`.
3. Instance: the smallest paid tier (free instances sleep and the first click of the day would time out).
4. **Disks** → add a disk mounted at `/data` (1 GB is far more than enough) and set `DATA_DIR=/data`.
5. Environment → add the variables above. Put the OpenAI key in as a secret; never commit it.
6. Deploy. Open `https://<service>.onrender.com/api/v1/health` - it should report `provider: openai:gpt-5-mini`.
7. Optional but recommended: a custom domain such as `api.promolens.app`, so the extension does not hard-code a host name that might change.

## Wire the extension to it

1. Put the URL (no trailing slash) into `HOSTED_API_URL` in `apps/extension/src/shared/hostedApp.ts`.
2. Add the host to the manifest: `"host_permissions": ["https://www.reddit.com/*", "https://<your api host>/*"]`.
3. `npm run build`, test a click with a fresh profile (you should see "19 of 20 included analyses left" in the popup), then package for the store.

## Operating it

- **Logs** show only routes, status codes, timings and claim counts - never post text. `LOG_RAW_CONTENT` stays `false`.
- **Usage file** (`/data/usage.json`) holds anonymous install ids, monthly counts, and for Plus installs the licence key and instance id. Nothing else. Losing it re-grants some free analyses; it is not precious.
- **Model spend**: roughly $0.005 per analysis with `gpt-5-mini`. 1,000 free installs using their full 20 ≈ $100 once; 5/month after that ≈ $25/month. A Plus user at full use ≈ $2.50/month against $4.99. Set a spend limit on the OpenAI project.
- **Abuse**: the per-client rate limiter (60/min default) and the per-install allowance are the two brakes. Reinstalling the extension yields a new install id and a fresh free allowance; that is accepted for now.
- **Licences**: validated against Lemon Squeezy (cached 6 h). If Lemon Squeezy is unreachable, existing Plus installs keep Plus rather than being cut off.
