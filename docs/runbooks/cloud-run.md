# The API on Google Cloud Run (`clawbada-api`)

Since 2026-10-22 the API runs on Cloud Run in `us-east4` as one always-on instance (CPU always allocated), with
Cloud SQL for PostgreSQL reached over Cloud Run's built-in connector (a unix socket, no public database
address) and secrets in Secret Manager. It replaced Railway after the 2026-10-21 Railway breach.

```
scripts/deploy-api.sh              # build linux/amd64 on Cloud Build, push, roll the service, check /health
scripts/deploy-api.sh --local      # same, built here with buildx (the arm64 → amd64 emulator is unreliable)
gcloud run services logs read clawbada-api --region us-east4 --limit 200
curl https://api.clawbada.com/health
```

## What a deploy does — and does not — touch

`scripts/deploy-api.sh` only replaces the image (tagged with the commit sha; it refuses a dirty tree).
The service's runtime configuration lives on the service itself and is inherited by every new revision:

| Where | What |
|---|---|
| `docker/cloud-run.api.env.yaml` (committed) | non-secret env: chain, RPC, auth domains, practice flags, pool size, proxy hops |
| Secret Manager | `DATABASE_URL` (socket form), `AUTH_SESSION_SECRET`, `BATTLE_SEED_SECRET` |
| the service template | `--port 3001`, 1 vCPU / 1 GiB, CPU always allocated, min = max = 1 instance, concurrency 1000, timeout 3600 s, session affinity, the Cloud SQL binding, the service account |

Change config with `gcloud run services update … --env-vars-file docker/cloud-run.api.env.yaml` (after editing the
file) or `--update-secrets NAME=secret:version`; the `--set-*` forms replace the whole set.

## One-time setup (done 2026-10-22; repeat only for a new project)

```
PROJECT=clawbada-prod REGION=us-east4
# zsh: write ${VAR}:x with braces — a bare $VAR:c is parsed as a modifier and eats characters (seen 2026-10-22).
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com compute.googleapis.com monitoring.googleapis.com cloudbuild.googleapis.com
gcloud artifacts repositories create clawbada --repository-format docker --location $REGION
gcloud iam service-accounts create clawbada-api
# roles: cloudsql.client, secretmanager.secretAccessor (per secret), logging.logWriter, monitoring.metricWriter
# Cloud Build runs as the Compute default SA, which has NO roles in a new project (it could not read its own
# uploaded source): grant it roles/cloudbuild.builds.builder + roles/artifactregistry.writer + roles/storage.objectViewer.

# Cloud SQL — smallest zonal instance, no public address reachable from the internet (no authorized networks)
gcloud sql instances create clawbada-pg --database-version POSTGRES_17 --tier db-f1-micro --region $REGION \
  --storage-type SSD --storage-size 10 --storage-auto-increase --backup --backup-start-time 06:00 \
  --enable-point-in-time-recovery --maintenance-window-day SUN --maintenance-window-hour 7
gcloud sql databases create clawbada --instance clawbada-pg
gcloud sql users create clawbada_api --instance clawbada-pg --password "$(openssl rand -base64 30)"

# Secrets (printf: no trailing newline)
printf '%s' "postgresql://clawbada_api:PASS@localhost/clawbada?host=/cloudsql/${PROJECT}:${REGION}:clawbada-pg" \
  | gcloud secrets create clawbada-api-database-url --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create clawbada-auth-session-secret --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create clawbada-battle-seed-secret --data-file=-

# The service (first creation; later deploys only swap the image)
gcloud run deploy clawbada-api --project $PROJECT --region $REGION \
  --image $REGION-docker.pkg.dev/$PROJECT/clawbada/clawbada-api:TAG \
  --platform managed --execution-environment gen2 \
  --service-account "clawbada-api@${PROJECT}.iam.gserviceaccount.com" \
  --add-cloudsql-instances "${PROJECT}:${REGION}:clawbada-pg" \
  --port 3001 --cpu 1 --memory 1Gi --no-cpu-throttling \
  --min-instances 1 --max-instances 1 --concurrency 1000 --timeout 3600 --session-affinity \
  --allow-unauthenticated \
  --env-vars-file docker/cloud-run.api.env.yaml \
  --set-secrets DATABASE_URL=clawbada-api-database-url:latest,AUTH_SESSION_SECRET=clawbada-auth-session-secret:latest,BATTLE_SEED_SECRET=clawbada-battle-seed-secret:latest
```

Why these flags: `--no-cpu-throttling` keeps the matchmaker ticker, shot clocks and bot timers running with no
request in flight; `--min-instances 1 --max-instances 1` because live battles are in memory (persisted per turn
and resumed on boot — one instance by design); `--timeout 3600` is the WebSocket ceiling (clients reconnect and
re-sync from the server's snapshot); never `--use-http2` (WebSockets need HTTP/1.1).

The `DATABASE_URL` socket form: postgres.js cannot take Cloud SQL's socket from a URL, so the URL keeps a
placeholder `localhost` and `?host=/cloudsql/…`; `packages/db/src/connection.ts` turns that into the client's
`path` option. No `sslmode` on the socket form.

## Hostname: `api.clawbada.com` through the global external Application Load Balancer

Static IP → serverless NEG (the Cloud Run service) → backend service (logging on; a serverless NEG backend
accepts neither `--timeout` nor a port name, so the WebSocket ceiling is Cloud Run's own 3600 s) → URL map → Google-managed certificate for `api.clawbada.com` → HTTPS proxy →
forwarding rule :443 (+ an :80 → HTTPS redirect). DNS at Cloudflare: `A api → <static IP>`, DNS-only (grey
cloud). Once the certificate is active, the service's ingress is restricted to the load balancer
(`--ingress internal-and-cloud-load-balancing`), so the `*.run.app` URL stops answering the public.

`TRUST_PROXY_HOPS`: Google's front ends append the connecting IP to `X-Forwarded-For`; the API reads the entry
that many places from the right. Read a live request's header in the logs after the first deploy and set the
value: measured 2 behind the load balancer (the API sees `<client>, <lb ip>`; Cloud Run appends nothing more).

## Rotating a secret

```
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add clawbada-auth-session-secret --data-file=-
gcloud run services update clawbada-api --region us-east4 --update-secrets AUTH_SESSION_SECRET=clawbada-auth-session-secret:latest
```

A new revision rolls; every session token dies (the web re-signs once, guests re-mint, agents re-authenticate).
For the database password: `gcloud sql users set-password clawbada_api --instance clawbada-pg --password …`,
add a new version of `clawbada-api-database-url`, then the same `--update-secrets`.

## Rollback

```
gcloud run revisions list --service clawbada-api --region us-east4
gcloud run services update-traffic clawbada-api --region us-east4 --to-revisions clawbada-api-00012-abc=100
```

## Logs

The request log (`@clawbada/logger` hono middleware) records method, path and an allow-list of headers
(`user-agent`, `content-type`, `origin`, `x-forwarded-for`, …) — never `authorization` or the query string,
which carry tokens. Before 2026-10-22 every header was logged, bearer tokens included.
`gcloud run services logs read clawbada-api --region us-east4 --limit 200`.

## Monitoring

An uptime check on `https://api.clawbada.com/health` (every minute, three regions) alerts the owner by email;
a second policy fires on container restarts. Cloud Run's metrics page shows memory and CPU — resize from there.

## Shutdown contract

Cloud Run sends SIGTERM and SIGKILLs 10 s later. `apps/api/src/lib/shutdown.ts` stops the matchmaker, closes
every WebSocket with `1001 Server restarting`, stops the sessions, awaits their queued turn writes, drains the
pool and exits — logs `shutdown_started` … `shutdown_drained` (with `released`, the battle leases handed on).

Rollouts overlap two instances for a few seconds. Since 2026-10-28 every live battle carries a **lease**
(`battle_sessions.owner_instance` / `lease_until`, 20 s, renewed every 5 s): the new instance adopts a battle only
once the old one has released it after its final flush (or, after a hard kill, once the lease runs out), then
pushes a fresh `battle_snapshot` to the room. So a battle is never driven by two instances; players see at most a
few seconds' pause while their client reconnects. Logs: `battle_sessions_resumed`, `battle_session_lease_lost`
(should never appear in a normal rollout), `battle_session_lease_renew_failed`.
