#!/usr/bin/env bash
# Deploy apps/web (fact-checker-ke-web) to Vercel production.
#
# Rail (ADR-0016 step H): vercel pull -> vercel build --prod -> vercel deploy
# --prebuilt --prod --skip-domain -> smoke -> vercel promote. A failed smoke
# exits non-zero WITHOUT promoting, leaving production traffic on whatever
# was previously promoted.
#
# Env:
#   VERCEL_TOKEN   optional; CI auth (vercel-common.sh). Omit for local use
#                  of an existing `vercel login` session.
#   VERCEL_SCOPE   optional; default eric-gitangus-projects.
#   SMOKE_ONLY_URL optional; skip build+deploy and just smoke+promote an
#                  already-staged deployment URL (used by the smoke-fail
#                  drill in docs/runbooks/vercel-deploy.md).
#
# Usage: scripts/deploy/vercel-web.sh

set -eo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
# shellcheck source=./vercel-common.sh
source "$SCRIPT_DIR/vercel-common.sh"

readonly PROJECT="fact-checker-ke-web"
# Smoke paths per ADR-0015/0016: the static shell, a static page, the PWA
# manifest, and the Serwist-built service worker (precache manifest).
readonly SMOKE_PATHS=(/ /methodology /manifest.webmanifest /serwist/sw.js)

main() {
  local repo_root
  repo_root="$(vercel-common::repo_root)"
  cd "$repo_root"

  local deploy_url
  if [[ -n "${SMOKE_ONLY_URL:-}" ]]; then
    deploy_url="$SMOKE_ONLY_URL"
    echo "==> ${PROJECT}: skipping build/deploy, smoking existing URL ${deploy_url}"
  else
    echo "==> ${PROJECT}: linking project at repo root (sets Root Directory context)"
    vercel-common::vercel link --yes --project "$PROJECT" --scope "$VERCEL_SCOPE" >/dev/null

    echo "==> ${PROJECT}: pulling production env + project settings"
    vercel-common::vercel pull --yes --environment production --scope "$VERCEL_SCOPE" >/dev/null

    echo "==> ${PROJECT}: vercel build --prod"
    vercel-common::vercel build --prod --scope "$VERCEL_SCOPE"

    echo "==> ${PROJECT}: vercel deploy --prebuilt --prod --skip-domain"
    deploy_url="$(vercel-common::deploy_prebuilt)"
    echo "==> ${PROJECT}: staged at ${deploy_url}"
  fi

  echo "==> ${PROJECT}: smoke testing staged deployment"
  local failed=0
  for path in "${SMOKE_PATHS[@]}"; do
    vercel-common::smoke_path "$deploy_url" "$path" 200 || failed=1
  done

  if [[ "$failed" -ne 0 ]]; then
    echo "==> ${PROJECT}: SMOKE FAILED -- not promoting. Production traffic is unchanged." >&2
    exit 1
  fi

  echo "==> ${PROJECT}: smoke passed -- promoting ${deploy_url} to production"
  vercel-common::promote "$deploy_url"
  echo "==> ${PROJECT}: promoted. Done."
}

main "$@"
