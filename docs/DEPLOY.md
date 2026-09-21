# Deploying the judge-facing demo

Frontend on Vercel, API on Google Cloud Run. The two are deployed separately and
joined by two settings: the frontend's `VITE_API_BASE_URL` and the API's
`ALLOWED_ORIGINS`.

## What the deployed build is, and is not

The container carries a **baked demo store**: the provided 520-email sample
mailbox, the reviewed `email_512` scan with its 14 review events, and the
`email_004` v1/v2/v3 revision history. Every visitor therefore starts from the
same known-good state.

Writes — working copies, uploaded revisions, review events, completions,
amendment drafts — persist for the life of the container instance and reset when
it restarts. That is a deliberate scope decision for a demo, not durable
persistence. Managed Postgres, private object storage and per-session ownership
remain roadmap items; do not describe this deployment as production ready.

`APP_ENV=demo` serves the same product surface as local development. It is a
named demo environment, not a hardened production configuration.

## 1. Bake the demo store

Stop the local backend first: the script refuses to copy a SQLite file that
still has `-wal` / `-shm` sidecars, because those would ship a torn database.

```bash
cd backend
uv run --frozen python scripts/build_demo_store.py
```

This writes `backend/demo-store/` (about 4.5 MiB) and prints the row counts it
captured. Re-run it whenever you want the deployed baseline to match a newer
local state, then redeploy.

## 2. Deploy the API to Cloud Run

One-time setup:

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Deploy from source — Cloud Build builds the image, so no local Docker is needed:

```bash
cd backend
gcloud run deploy draftguard-api \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 20 \
  --memory 1Gi \
  --timeout 120 \
  --set-env-vars APP_ENV=demo,ENABLE_DEV_EXTRACTION=true,GEMINI_MODEL=gemini-3.8-flash \
  --set-env-vars 'ALLOWED_ORIGINS=https://<your-app>.vercel.app' \
  --set-env-vars GEMINI_API_KEY=<your-key>
```

**`--max-instances 1` is required, not a cost tweak.** The store is SQLite inside
the container; a second instance would serve a second, diverging copy and judges
would see state appear and vanish between clicks. `--min-instances 1` keeps the
instance warm so nobody waits on a cold start.

Prefer a secret over a plain env var for the key once the service works:

```bash
printf '%s' '<your-key>' | gcloud secrets create draftguard-gemini --data-file=-
gcloud run services update draftguard-api --region asia-southeast1 \
  --set-secrets GEMINI_API_KEY=draftguard-gemini:latest
```

Check it:

```bash
curl -s "$(gcloud run services describe draftguard-api --region asia-southeast1 \
  --format='value(status.url)')/api/health"
```

Expect `development_tasks: true` and `development_extraction: true`. If both are
false, `APP_ENV` did not reach the container and only `/api/health` is mounted.

## 3. Deploy the frontend to Vercel

```bash
cd frontend
vercel link
vercel env add VITE_API_BASE_URL production   # paste the Cloud Run URL, no trailing slash
vercel --prod
```

`vercel.json` already sets the Vite build, the SPA rewrite so deep links such as
`/tasks/<id>` resolve, and immutable caching for hashed assets.

## 4. Join the two

`ALLOWED_ORIGINS` must contain the exact Vercel origin, scheme included and no
trailing slash. It accepts either form:

```
ALLOWED_ORIGINS=https://draftguard.vercel.app
ALLOWED_ORIGINS=https://draftguard.vercel.app,https://draftguard-git-main.vercel.app
ALLOWED_ORIGINS=["https://draftguard.vercel.app"]
```

Preview deployments get their own origins. Add the ones you intend to share, or
share only the production URL.

```bash
gcloud run services update draftguard-api --region asia-southeast1 \
  --set-env-vars 'ALLOWED_ORIGINS=https://draftguard.vercel.app'
```

## 5. Acceptance before you share the link

Open the Vercel URL in a private window — not the browser you developed in — and
confirm each item. A submitted link that fails here costs more than no link,
because the video already showed the flow working.

- [ ] Overview loads and reports 520 emails.
- [ ] The reviewed `email_512` task opens, shows its scanned page, and the
      review ledger survives a refresh.
- [ ] `email_004` history shows v1 name discrepancies, v2 gross weight, v3 clean.
- [ ] Creating a working copy from a sample succeeds and is still there after a
      refresh.
- [ ] Run provenance expands and shows real provider records.
- [ ] `email_516` keeps the SI gross weight missing and never copies the BL value.
- [ ] The browser console shows no CORS error.
- [ ] A deep link pasted directly, e.g. `/tasks/<id>`, resolves rather than 404s.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Only `/api/health` answers; every other route 404s | `APP_ENV` is not `demo` or `development` |
| Browser blocks requests with a CORS error | `ALLOWED_ORIGINS` missing the exact Vercel origin, or has a trailing slash |
| State appears and disappears between clicks | More than one instance; set `--max-instances 1` |
| First visit takes tens of seconds | No warm instance; set `--min-instances 1` |
| Scan analysis fails with a provider error | `GEMINI_API_KEY` unset in the service, or quota exhausted |
| `/tasks/<id>` 404s on refresh | `vercel.json` rewrite missing from the deployed build |
