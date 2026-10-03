#!/usr/bin/env bash
# ADR-0013 acceptance checks (git workflow gates). Run from repo root:
#   bash scripts/at/at-0013.sh
#
# Scriptable subset only. Does NOT force-push to main (destructive); the
# ruleset is instead verified by reading it back via `gh api`.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

REPO_SLUG="ericgitangu/fact_checker_ke"

# --- commit-msg hook rejects a message containing "Co-Authored-By"
# NOTE: `lefthook run commit-msg <file>` (not `.git/hooks/commit-msg`
# directly) -- in a git worktree, hooks live in the *main* repo's
# .git/hooks (shared across worktrees), outside this worktree's sandbox
# boundary. `lefthook run` executes the same configured jobs without
# touching that shared path.
TMP_MSG="/tmp/at-0013-msg-a.txt"
echo "== AT-0013-A: commit-msg hook rejects AI attribution lines =="
printf 'feat: test commit\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$TMP_MSG"
if pnpm exec lefthook run commit-msg "$TMP_MSG" -n >/tmp/at-0013-a.log 2>&1; then
  fail "AT-0013-A" "commit-msg hook accepted a Co-Authored-By message (see /tmp/at-0013-a.log)"
else
  pass "AT-0013-A (commit-msg hook rejected Co-Authored-By message)"
fi
rm -f "$TMP_MSG"

# --- commit-msg hook rejects "Generated with"
TMP_MSG="/tmp/at-0013-msg-b.txt"
echo "== AT-0013-B: commit-msg hook rejects 'Generated with' lines =="
printf '%s\n\n%s\n' "feat: test commit" "Generated with Claude Code" > "$TMP_MSG"
if pnpm exec lefthook run commit-msg "$TMP_MSG" -n >/tmp/at-0013-b.log 2>&1; then
  fail "AT-0013-B" "commit-msg hook accepted a 'Generated with' message"
else
  pass "AT-0013-B (commit-msg hook rejected 'Generated with' message)"
fi
rm -f "$TMP_MSG"

# --- commit-msg hook accepts a clean conventional commit
TMP_MSG="/tmp/at-0013-msg-c.txt"
echo "== AT-0013-C: commit-msg hook accepts a conventional, attribution-free message =="
printf 'feat(core): add widget\n' > "$TMP_MSG"
if pnpm exec lefthook run commit-msg "$TMP_MSG" -n >/tmp/at-0013-c.log 2>&1; then
  pass "AT-0013-C (clean conventional commit accepted)"
else
  fail "AT-0013-C" "commit-msg hook rejected a clean message (see /tmp/at-0013-c.log)"
fi
rm -f "$TMP_MSG"

# --- GitHub ruleset on main: require PR, linear history, block force-push/deletion
echo "== AT-0013-D: GitHub ruleset on main (read-only, via gh api) =="
RULESETS=$(gh api "repos/$REPO_SLUG/rulesets" 2>/tmp/at-0013-d.log)
if [ $? -eq 0 ]; then
  MAIN_RULESET=$(echo "$RULESETS" | jq '[.[] | select(.target=="branch")] | length')
  if [ "$MAIN_RULESET" -gt 0 ]; then
    pass "AT-0013-D ($MAIN_RULESET branch ruleset(s) found on $REPO_SLUG)"
  else
    fail "AT-0013-D" "no branch ruleset found on $REPO_SLUG yet"
  fi
else
  fail "AT-0013-D" "gh api call failed (see /tmp/at-0013-d.log) -- auth or network issue"
fi

# --- Secret scanning push protection enabled
echo "== AT-0013-E: secret scanning push protection (read-only, via gh api) =="
SEC=$(gh api "repos/$REPO_SLUG" --jq '.security_and_analysis.secret_scanning_push_protection.status' 2>/tmp/at-0013-e.log)
if [ "$SEC" = "enabled" ]; then
  pass "AT-0013-E (secret_scanning_push_protection = enabled)"
else
  fail "AT-0013-E" "secret_scanning_push_protection = '$SEC' (expected 'enabled')"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0013 CHECKS: GREEN"
else
  echo "AT-0013 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
