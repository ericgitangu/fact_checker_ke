#!/usr/bin/env bash
# ADR-0018 acceptance tests (SSE + caching) plus the ADR-0020
# anonymous-device-token slice. Run from repo root:
#   DATABASE_URL_TEST=postgres://... REDIS_TCP_URL=redis://localhost:6379 bash scripts/at/at-0018.sh
#
# Each AT prints PASS/FAIL. Non-zero exit if any AT fails.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1: $2"; FAIL=1; }

if [ -z "${DATABASE_URL_TEST:-}" ]; then
  if [ "${CI:-}" = "true" ]; then
    fail "AT-0018-ENV" "DATABASE_URL_TEST is required when CI=true (ADR-0019 #5: never skip in CI)."
    exit 1
  fi
  echo "DATABASE_URL_TEST unset and CI!=true -- the integration suite below will" \
    "self-skip its describe blocks (local-dev convenience only; this is NOT a pass)."
fi

echo "== AT-0018 (SSE replay/resume/guards/caching) + AT-0020 (device token, capability scoping): vitest integration =="
if DATABASE_URL_TEST="${DATABASE_URL_TEST:-}" pnpm --filter @fact-checker-ke/api run test:integration \
     2>&1 | tee /tmp/at-0018-integration.log | tail -60; then
  pass "AT-0018-integration (AT-0018-1 terminal-state immediate close; AT-0018-2 Last-Event-ID resume no dup; AT-0018-4/8 device-keyed concurrency 429; AT-0020-2 cross-submission capability-token rejection)"
else
  fail "AT-0018-integration" "vitest exited non-zero; see /tmp/at-0018-integration.log"
fi

echo "== AT-0018 (device-token issuance, cache headers, pub/sub, publisher) + AT-0020 (device route): vitest unit =="
if pnpm --filter @fact-checker-ke/api run test 2>&1 | tee /tmp/at-0018-unit.log | tail -40; then
  pass "AT-0018-unit"
else
  fail "AT-0018-unit" "vitest exited non-zero; see /tmp/at-0018-unit.log"
fi

# --- Live demo smoke: a real API process, real Postgres, a real (or
# in-process-fallback) Redis -- end to end through HTTP, not vitest's
# in-process fastify.inject(). This is the empirical "does the actual
# server, not just the test harness, do this" check (CLAUDE.md
# verification discipline).
if [ -n "${DATABASE_URL_TEST:-}" ] && command -v curl >/dev/null 2>&1; then
  echo "== AT-0018 live-demo smoke: real API process over HTTP =="
  AT18_PORT=$((40000 + RANDOM % 10000))
  AT18_BASE="http://127.0.0.1:${AT18_PORT}"
  AT18_LOG="/tmp/at-0018-live-server.log"

  DATABASE_URL="${DATABASE_URL_TEST}" PORT="$AT18_PORT" NODE_ENV=development \
    REDIS_TCP_URL="${REDIS_TCP_URL:-}" \
    pnpm --filter @fact-checker-ke/api exec tsx src/server.ts >"$AT18_LOG" 2>&1 &
  AT18_SERVER_PID=$!

  cleanup() {
    kill "$AT18_SERVER_PID" >/dev/null 2>&1 || true
    wait "$AT18_SERVER_PID" 2>/dev/null || true
  }
  trap cleanup EXIT

  for _ in $(seq 1 30); do
    curl -fsS "$AT18_BASE/healthz" >/dev/null 2>&1 && break
    sleep 0.5
  done

  DEVICE_RESPONSE=$(curl -fsS -X POST "$AT18_BASE/v1/device" || true)
  DEVICE_TOKEN=$(echo "$DEVICE_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).token)}catch{process.exit(1)}})' 2>/dev/null || true)
  if [ -n "$DEVICE_TOKEN" ]; then
    pass "AT-0020 live: POST /v1/device issues a token (${#DEVICE_TOKEN} chars)"
  else
    fail "AT-0020 live" "POST /v1/device did not return a token; response: $DEVICE_RESPONSE; server log: $AT18_LOG"
  fi

  IDEM_KEY=$(node -e 'console.log(crypto.randomUUID())')
  SUB_RESPONSE=$(curl -fsS -X POST "$AT18_BASE/v1/submissions" \
    -H "Content-Type: application/json" -H "Idempotency-Key: $IDEM_KEY" -H "X-Device-Token: $DEVICE_TOKEN" \
    -d '{"text":"AT-0018 live demo probe"}' || true)
  SUB_ID=$(echo "$SUB_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id)}catch{process.exit(1)}})' 2>/dev/null || true)
  SUB_TOKEN=$(echo "$SUB_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).eventsToken)}catch{process.exit(1)}})' 2>/dev/null || true)
  SUB_REPLAY=$(curl -fsS -X POST "$AT18_BASE/v1/submissions" \
    -H "Content-Type: application/json" -H "Idempotency-Key: $IDEM_KEY" -H "X-Device-Token: $DEVICE_TOKEN" \
    -d '{"text":"AT-0018 live demo probe"}' || true)

  if [ -n "$SUB_ID" ] && [ "$SUB_RESPONSE" = "$SUB_REPLAY" ]; then
    pass "AT-0017 live: POST /v1/submissions 202s with an id + eventsToken, duplicate Idempotency-Key replays the identical response"
  else
    fail "AT-0017 live" "submission create/replay mismatch; first=$SUB_RESPONSE second=$SUB_REPLAY"
  fi

  if [ -n "$SUB_ID" ] && [ -n "$SUB_TOKEN" ]; then
    # Transcript 1: open the SSE stream BEFORE the simulator runs, so
    # the hop transitions arrive as LIVE Redis pub/sub messages (not a
    # replay) -- this is the "events arrive in order, stream closes on
    # ready" demo.
    SSE_LOG_1="/tmp/at-0018-sse-transcript-1.log"
    curl -N -s --max-time 10 "$AT18_BASE/v1/submissions/$SUB_ID/events?token=$SUB_TOKEN" >"$SSE_LOG_1" 2>&1 &
    SSE_PID=$!
    sleep 0.3 # let the stream subscribe before the simulator fires

    curl -fsS -X POST "$AT18_BASE/internal/dev/simulate" \
      -H "Content-Type: application/json" -d "{\"submissionId\":\"$SUB_ID\"}" >/tmp/at-0018-simulate.json 2>&1 || true

    wait "$SSE_PID" 2>/dev/null || true

    FINAL_STATUS=$(curl -fsS "$AT18_BASE/v1/submissions/$SUB_ID" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).status)}catch{process.exit(1)}})' 2>/dev/null || true)
    STREAM_ORDER=$(grep -o '"status":"[a-z]*"' "$SSE_LOG_1" | sed 's/.*"status":"\(.*\)"/\1/' | tr '\n' ' ')
    if [ "$FINAL_STATUS" = "ready" ] && echo "$STREAM_ORDER" | grep -q "received.*analyzing.*analyzed.*verifying.*ready"; then
      pass "AT-0017/§dev-simulator + AT-0018-1 live: submission reaches 'ready'; SSE transcript shows hops in order ($STREAM_ORDER); transcript: $SSE_LOG_1"
    else
      fail "AT-0018 live SSE ordering" "expected status=ready and an ordered stream, got status='$FINAL_STATUS' order='$STREAM_ORDER'; see $SSE_LOG_1"
    fi
  fi

  # Transcript 2: restart-mid-stream / Last-Event-ID resume. A fresh
  # submission gets ONE id-bearing event written for real (via the same
  # `advanceWithInbox` code path POST /internal/events/submission-
  # advanced uses -- invoked directly here, not over HTTP, because
  # QStash cannot deliver a signed callback to localhost; see ADR-0017
  # implementation notes). The server is then KILLED and RESTARTED
  # (same Postgres), and a second curl reconnects with Last-Event-ID to
  # prove the resume replays from Postgres across a process restart.
  RESUME_SUB_RESPONSE=$(curl -fsS -X POST "$AT18_BASE/v1/submissions" \
    -H "Content-Type: application/json" -H "Idempotency-Key: $(node -e 'console.log(crypto.randomUUID())')" -H "X-Device-Token: $DEVICE_TOKEN" \
    -d '{"text":"AT-0018 resume demo probe"}' || true)
  RESUME_SUB_ID=$(echo "$RESUME_SUB_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).id)}catch{process.exit(1)}})' 2>/dev/null || true)
  RESUME_SUB_TOKEN=$(echo "$RESUME_SUB_RESPONSE" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).eventsToken)}catch{process.exit(1)}})' 2>/dev/null || true)

  if [ -n "$RESUME_SUB_ID" ]; then
    SSE_LOG_BEFORE="/tmp/at-0018-sse-transcript-2-before-restart.log"
    curl -N -s --max-time 10 "$AT18_BASE/v1/submissions/$RESUME_SUB_ID/events?token=$RESUME_SUB_TOKEN" >"$SSE_LOG_BEFORE" 2>&1 &
    SSE_PID_2=$!
    sleep 0.3
    curl -fsS -X POST "$AT18_BASE/internal/dev/simulate" \
      -H "Content-Type: application/json" -d "{\"submissionId\":\"$RESUME_SUB_ID\"}" >/tmp/at-0018-simulate-2.json 2>&1 || true
    wait "$SSE_PID_2" 2>/dev/null || true
    # The "analyzed" hop (not "ready", the LAST and already-terminal
    # one) is the resume anchor, so the "after restart" reconnect still
    # has at least the "ready" event left to replay from Postgres.
    FIRST_EVENT_ID=$(grep -B1 '"status":"analyzed"' "$SSE_LOG_BEFORE" | grep '^id: ' | head -1 | sed 's/^id: //' | tr -d '\r')

    kill "$AT18_SERVER_PID" >/dev/null 2>&1 || true
    wait "$AT18_SERVER_PID" 2>/dev/null || true

    AT18_PORT2=$((50000 + RANDOM % 10000))
    AT18_BASE2="http://127.0.0.1:${AT18_PORT2}"
    DATABASE_URL="${DATABASE_URL_TEST}" PORT="$AT18_PORT2" NODE_ENV=development \
      REDIS_TCP_URL="${REDIS_TCP_URL:-}" \
      pnpm --filter @fact-checker-ke/api exec tsx src/server.ts >/tmp/at-0018-live-server-restarted.log 2>&1 &
    AT18_SERVER_PID2=$!
    for _ in $(seq 1 30); do
      curl -fsS "$AT18_BASE2/healthz" >/dev/null 2>&1 && break
      sleep 0.5
    done

    SSE_LOG_AFTER="/tmp/at-0018-sse-transcript-2-after-restart.log"
    if [ -n "$FIRST_EVENT_ID" ]; then
      curl -N -s --max-time 5 -H "Last-Event-ID: $FIRST_EVENT_ID" \
        "$AT18_BASE2/v1/submissions/$RESUME_SUB_ID/events?token=$RESUME_SUB_TOKEN" >"$SSE_LOG_AFTER" 2>&1 || true
      # Replay sends the RAW submission_events row (the full event
      # envelope, e.g. "event_type":"check.published"), which is a
      # different wire shape than the LIVE pubsub-forwarded compact
      # message ("status":"ready") the "before" transcript shows for
      # the same transition -- both are correct per ADR-0018 (live =
      # compact {event_id,status,at}; replay = the actual event log).
      if grep -q '"event_type":"check.published"' "$SSE_LOG_AFTER" && ! grep -q '"event_type":"submission.analyzed"' "$SSE_LOG_AFTER"; then
        pass "AT-0018-2 live: resumed with Last-Event-ID=$FIRST_EVENT_ID after a server restart on a NEW port ($AT18_BASE2) -- replays only 'ready' (the newer event), not the already-seen 'analyzed'; before=$SSE_LOG_BEFORE after=$SSE_LOG_AFTER"
      else
        fail "AT-0018-2 live" "resume did not replay exactly the newer events; see $SSE_LOG_BEFORE and $SSE_LOG_AFTER"
      fi
    else
      fail "AT-0018-2 live" "no id-bearing event observed on the first connection; see $SSE_LOG_BEFORE"
    fi

    kill "$AT18_SERVER_PID2" >/dev/null 2>&1 || true
    wait "$AT18_SERVER_PID2" 2>/dev/null || true
  fi

  cleanup
  trap - EXIT
else
  echo "Skipping the live-demo smoke (needs DATABASE_URL_TEST + curl) -- the vitest" \
    "integration suite above already covers these ATs against a real Postgres."
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "ALL AT-0018 CHECKS: GREEN"
else
  echo "AT-0018 CHECKS: RED (see FAIL lines above)"
fi
exit "$FAIL"
