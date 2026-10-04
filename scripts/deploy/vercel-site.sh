#!/usr/bin/env bash
# Deploy apps/site (fact-checker-ke-site) to Vercel production.
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
# Usage: scripts/deploy/vercel-site.sh

set -eo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
# shellcheck source=./vercel-common.sh
source "$SCRIPT_DIR/vercel-common.sh"

readonly PROJECT="fact-checker-ke-site"
# apps/site is a retired redirect-only stub (ADR-0010/0015 amendments,
# 2026-10-04): the marketing site was folded into apps/web. Every path now
# 308-redirects to the web app, so the smoke proves the redirect fires (308,
# not 200) and that it points at the web app -- NOT that a static SPA or a
# waitlist bundle rendered (there is none any more).
readonly REDIRECT_TARGET="https://fact-checker-ke-web.vercel.app"
readonly SMOKE_PATHS=(/)

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

  echo "==> ${PROJECT}: smoke testing retired redirect stub"
  local failed=0 headers_file body_file code
  headers_file="$(mktemp)"; body_file="$(mktemp)"
  code=$(vercel-common::vercel curl / --deployment "$deploy_url" --scope "$VERCEL_SCOPE" -D "$headers_file" -o "$body_file" -w '%{http_code}' 2>/dev/null | tail -n1)
  # Retired stub (ADR-0010/0015): "/" must lead to the web app. Accept EITHER a
  # server 3xx whose Location is the web app, OR a 200 whose body carries the
  # redirect (meta-refresh floor). Both retire the old marketing content.
  if { [[ "$code" =~ ^3 ]] && grep -i '^location:' "$headers_file" | grep -q "$REDIRECT_TARGET"; } || grep -q "$REDIRECT_TARGET" "$body_file"; then
    echo "vercel-common: smoke OK ${deploy_url}/ -> ${REDIRECT_TARGET} (code ${code})"
  else
    echo "==> ${PROJECT}: smoke FAILED -- '/' does not redirect to ${REDIRECT_TARGET} (code ${code})" >&2
    failed=1
  fi
  rm -f "$headers_file" "$body_file"

  if [[ "$failed" -ne 0 ]]; then
    echo "==> ${PROJECT}: SMOKE FAILED -- not promoting. Production traffic is unchanged." >&2
    exit 1
  fi

  echo "==> ${PROJECT}: smoke passed -- promoting ${deploy_url} to production"
  vercel-common::promote "$deploy_url"
  echo "==> ${PROJECT}: promoted. Done."
}

main "$@"
