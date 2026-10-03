#!/usr/bin/env bash
# Shared helpers for scripts/deploy/vercel-web.sh and vercel-site.sh.
#
# ADR-0015 (deployment topology) + ADR-0016 (atomic deploy rail): stage a
# prebuilt production build without assigning the production domain, smoke
# the staged URL, and only then `vercel promote` it atomically. A failed
# smoke must leave the previous production deployment untouched (no
# promote) and exit non-zero.
#
# Not meant to be executed directly -- sourced by vercel-web.sh / vercel-site.sh.

set -eo pipefail

VERCEL_BIN="${VERCEL_BIN:-vercel}"
VERCEL_SCOPE="${VERCEL_SCOPE:-eric-gitangus-projects}"

# vercel-common::vercel <args...>
# Wraps the vercel CLI, injecting --token when VERCEL_TOKEN is set (CI) and
# otherwise relying on the operator's own `vercel login` session.
vercel-common::vercel() {
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then
    "$VERCEL_BIN" "$@" --token "$VERCEL_TOKEN"
  else
    "$VERCEL_BIN" "$@"
  fi
}

# vercel-common::repo_root
# Prints the repository root so every step runs from there -- required for
# Next.js/pnpm monorepo file tracing to resolve correctly when the Vercel
# project's Root Directory is a subdirectory (apps/web, apps/site). Running
# `vercel build`/`deploy` from inside the app directory instead resolves the
# pnpm virtual store (node_modules/.pnpm, hoisted to the workspace root) at
# the wrong base path and the prebuilt deploy fails at upload time with
# "Please ensure project dependencies have been installed" even though the
# local build succeeded (confirmed empirically 2026-10-03; see
# docs/runbooks/vercel-deploy.md).
vercel-common::repo_root() {
  git rev-parse --show-toplevel
}

# vercel-common::require_jq
vercel-common::require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "vercel-common: jq is required to parse 'vercel deploy --format json' output" >&2
    exit 1
  fi
}

# vercel-common::smoke_path <base_url> <path> <expected_status>
# Uses `vercel curl`, not plain curl: Deployment Protection (SSO) is on for
# this team and gates even production preview URLs with a 302 to
# vercel.com/sso-api, which `vercel curl` bypasses automatically via a
# generated protection-bypass token (confirmed empirically 2026-10-03).
vercel-common::smoke_path() {
  local base_url="$1" path="$2" expected="${3:-200}"
  local code
  code=$(vercel-common::vercel curl "$path" --deployment "$base_url" --scope "$VERCEL_SCOPE" -o /dev/null -w '%{http_code}' 2>/dev/null | tail -n1)
  if [[ "$code" != "$expected" ]]; then
    echo "vercel-common: smoke FAILED for ${base_url}${path} (expected ${expected}, got ${code:-<none>})" >&2
    return 1
  fi
  echo "vercel-common: smoke OK ${base_url}${path} -> ${code}"
}

# vercel-common::deploy_prebuilt
# Runs `vercel deploy --prebuilt --prod --skip-domain` and prints the
# resulting deployment URL on stdout (and nothing else). Caller must have
# already run `vercel build --prod` in the same directory.
vercel-common::deploy_prebuilt() {
  vercel-common::require_jq
  local out url
  out=$(vercel-common::vercel deploy --prebuilt --prod --skip-domain --scope "$VERCEL_SCOPE" --format json)
  url=$(echo "$out" | jq -r '.deployment.url // empty')
  if [[ -z "$url" ]]; then
    echo "vercel-common: could not parse deployment URL from 'vercel deploy --format json' output:" >&2
    echo "$out" >&2
    return 1
  fi
  echo "https://${url#https://}"
}

# vercel-common::promote <deployment_url>
vercel-common::promote() {
  local url="$1"
  vercel-common::vercel promote "$url" --yes --scope "$VERCEL_SCOPE"
}
