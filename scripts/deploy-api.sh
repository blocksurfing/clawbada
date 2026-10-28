#!/bin/zsh
# Build + deploy the API to Cloud Run — use this, not a bare `gcloud run deploy`.
#
# Builds docker/api.Dockerfile for linux/amd64 on Cloud Build (this Mac is arm64 and its colima builder dies
# emulating amd64 — seen 2026-10-22), pushes it to Artifact Registry tagged with the commit it was built from,
# rolls the clawbada-api service to it, and checks /health on the new revision. Runtime configuration (env
# vars, secrets, Cloud SQL binding, CPU/memory, port) is OWNED BY THE ONE-TIME SETUP in
# docs/runbooks/cloud-run.md: this script never passes --set-env-vars/--set-secrets, so a deploy can never
# clobber it — a new revision inherits the previous revision's template.
#
#   scripts/deploy-api.sh                 # build on Cloud Build, push, deploy
#   scripts/deploy-api.sh --local         # build here with buildx --platform linux/amd64 (needs a working emulator)
#   scripts/deploy-api.sh --allow-dirty   # deploy an uncommitted tree (tag gets a -dirty suffix)
#
# One-time per machine: brew install --cask gcloud-cli; gcloud auth login;
#                       (--local only) gcloud auth configure-docker us-east4-docker.pkg.dev
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Config (env overrides for a second project / region) ──
GCP_PROJECT="${GCP_PROJECT:-clawbada-prod}"
GCP_REGION="${GCP_REGION:-us-east4}"
SERVICE="${CLOUD_RUN_SERVICE:-clawbada-api}"
AR_REPO="${AR_REPO:-clawbada}"
IMAGE_NAME="${IMAGE_NAME:-clawbada-api}"
IMAGE_BASE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/${IMAGE_NAME}"
DOCKERFILE="docker/api.Dockerfile"
HEALTH_TIMEOUT_SEC=90
# Ingress is load-balancer-only, so the service's own run.app URL answers 404/403 to the outside: check health
# through the public hostname (the new revision takes 100 % of traffic, so that is the revision we just rolled).
PUBLIC_URL="${API_PUBLIC_URL:-https://api.clawbada.com}"

# ── Flags ──
REMOTE=1
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --local) REMOTE=0 ;;
    --remote) REMOTE=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "deploy-api: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

for tool in git gcloud curl; do
  command -v "$tool" >/dev/null || { echo "deploy-api: $tool is not installed" >&2; exit 1; }
done
if [ "$REMOTE" = 0 ]; then
  command -v docker >/dev/null || { echo "deploy-api: docker is not installed (drop --local)" >&2; exit 1; }
fi

# ── Tag = short sha of HEAD; -dirty if anything is modified or untracked (COPY . . would ship it) ──
SHA="$(git rev-parse --short=12 HEAD)"
TAG="$SHA"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" != 1 ]; then
    echo "deploy-api: REFUSING to deploy a dirty tree — commit, or pass --allow-dirty:" >&2
    git status --short >&2
    exit 1
  fi
  TAG="${SHA}-dirty"
fi
IMAGE="${IMAGE_BASE}:${TAG}"
echo "deploy-api: ${SERVICE} <- ${IMAGE} (project ${GCP_PROJECT}, ${GCP_REGION})"

# ── Build + push ──
if [ "$REMOTE" = 1 ]; then
  # Cloud Build: the Dockerfile is not at the context root, which `gcloud builds submit --tag` cannot express.
  gcloud builds submit "$ROOT" \
    --project "$GCP_PROJECT" \
    --config docker/cloudbuild.api.yaml \
    --substitutions "_IMAGE=${IMAGE}" \
    --quiet
else
  docker buildx build \
    --platform linux/amd64 \
    -f "$DOCKERFILE" \
    -t "$IMAGE" \
    --push \
    "$ROOT"
fi

# ── Deploy: the image only. No --set-env-vars / --set-secrets / --port / --memory here, by design (header). ──
gcloud run deploy "$SERVICE" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --image "$IMAGE" \
  --quiet

# ── Verify: the latest READY revision runs our image and answers /health ──
describe() { gcloud run services describe "$SERVICE" --project "$GCP_PROJECT" --region "$GCP_REGION" --format "value($1)"; }
REVISION="$(describe status.latestReadyRevisionName)"
SERVING_IMAGE="$(gcloud run revisions describe "$REVISION" --project "$GCP_PROJECT" --region "$GCP_REGION" --format 'value(spec.containers[0].image)')"
# Cloud Run may report the image by digest (repo@sha256:…) rather than by the tag we deployed (seen 2026-10-24 on
# revision clawbada-api-00006-pph): resolve the tag's digest and accept either spelling.
IMAGE_DIGEST="$(gcloud artifacts docker images describe "$IMAGE" --format 'value(image_summary.digest)' 2>/dev/null)"
if [ "$SERVING_IMAGE" != "$IMAGE" ] && { [ -z "$IMAGE_DIGEST" ] || [ "$SERVING_IMAGE" != "${IMAGE%:*}@${IMAGE_DIGEST}" ]; }; then
  echo "deploy-api: latest ready revision ${REVISION} runs ${SERVING_IMAGE}, not ${IMAGE}${IMAGE_DIGEST:+ (${IMAGE_DIGEST})}" >&2
  exit 1
fi
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SEC ))
until body="$(curl -fsS --max-time 10 "${PUBLIC_URL}/health" 2>/dev/null)" && grep -q '"status":"ok"' <<<"$body"; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "deploy-api: ${PUBLIC_URL}/health did not answer status ok within ${HEALTH_TIMEOUT_SEC}s" >&2
    exit 1
  fi
  sleep 3
done
echo "deploy-api: OK — ${REVISION} serving ${IMAGE} at ${PUBLIC_URL}"
echo "  ${body}"
