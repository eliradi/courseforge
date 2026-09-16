# CourseForge scraper service

A small, self-hosted Hono + Playwright service. It is the **only** component that
touches Chromium — the Next.js app never launches a browser, which is what keeps
it deployable to Vercel.

## Endpoints

All endpoints except `/health` require the `x-scraper-secret` header.

| Endpoint | Browser? | Purpose |
|---|---|---|
| `GET  /health` | no | Liveness, Chromium status, context-pool stats. |
| `POST /fetch` | no | Plain HTTP fetch → raw HTML. Tried first, always. ~10x cheaper than `/render`. |
| `POST /render` | yes | Full page render (JS executed, network idle) → HTML + extracted markdown + final URL + cookies. Optional `waitFor` selector. |
| `POST /intercept` | yes | Renders a page while capturing matching XHR/fetch JSON. Used for SPA catalogs (Kuali, Coursedog). |
| `POST /crawl` | optional | Bounded same-domain BFS. Hard caps: depth 2, 25 pages. |
| `POST /screenshot` | yes | Debug PNG, captured automatically when a scrape finally fails. |

### Example

```bash
curl -s localhost:8080/fetch \
  -H 'content-type: application/json' \
  -H "x-scraper-secret: $SCRAPER_SERVICE_SECRET" \
  -d '{"url":"https://catalog.mit.edu/subjects/6/"}'
```

## Design notes

- **One shared Chromium**, launched lazily and reused for the process lifetime.
- **Context pool** — a counting semaphore caps concurrent browser contexts at
  `MAX_CONCURRENT_CONTEXTS` (default 3). Each request gets a fresh, isolated
  context that is always closed, including on throw.
- **Images, media and fonts are aborted** on render requests. Catalog pages are
  text; skipping assets is a large latency win.
- **SSRF guard** — requests to loopback, link-local and RFC-1918 addresses are
  refused, so the service can't be used as an internal-network proxy.
- **Failures answer 200 with `ok: false`** rather than throwing, so a dead
  catalog page degrades gracefully instead of taking down a scrape.

## Environment

```
PORT=8080
SCRAPER_SERVICE_SECRET=        # required; shared with the Next.js app
MAX_CONCURRENT_CONTEXTS=3
DEFAULT_TIMEOUT_MS=30000
SCRAPER_USER_AGENT=CourseForgeBot/1.0 (+https://example.com/bot)
```

## Local development

```bash
npm install
npx playwright install chromium
SCRAPER_SERVICE_SECRET=dev-secret npm run dev
```

Or through Docker, which is what production runs:

```bash
docker build -t courseforge-scraper .
docker run --rm -p 8080:8080 -e SCRAPER_SERVICE_SECRET=dev-secret courseforge-scraper
curl localhost:8080/health
```

## Deploying

This service needs a real container with ~1–2 GB of memory. It will **not** run
on Vercel — Chromium does not fit in a serverless function.

### Fly.io

```bash
fly launch --no-deploy --copy-config          # uses the bundled fly.toml
fly secrets set SCRAPER_SERVICE_SECRET="$(openssl rand -hex 32)"
fly deploy
fly open /health
```

`fly.toml` sets `auto_stop_machines = "suspend"` so an idle scraper costs
nothing and wakes on the next request.

### Railway / Render / any VPS

Point the platform at this directory's `Dockerfile`, expose port 8080, set
`SCRAPER_SERVICE_SECRET`, and give the instance at least 1 GB of memory.

Then set `SCRAPER_SERVICE_URL` and the matching `SCRAPER_SERVICE_SECRET` in the
Next.js app's environment.
