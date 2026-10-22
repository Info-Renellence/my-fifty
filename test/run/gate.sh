#!/bin/sh
# Test-run push gate: the whole suite with the network guard. Passes when every failure is one of the 10 tests that
# need database rights the test login does not have (see docs/test-run/progress.md), and smoke passes (rolled back).
cd "$(dirname "$0")/../.."
export NODE_OPTIONS="--require $(pwd -W 2>/dev/null || pwd)/test/run/no-network.js" NO_NETWORK_QUIET=1
OUT=$(npm test 2>&1); echo "$OUT" > "${TMPDIR:-/tmp}/myfifty-gate.txt"
echo "$OUT" | grep -E "^ℹ (tests|pass|fail)"
echo "$OUT" | grep -E "^ℹ all files"
KNOWN='an unknown op is refused once signed in|first sign-in finds the user by email|a rep sees their own people and what hangs off them|a rep cannot give themselves someone else|an admin sees everyone|the public \(anon\) key sees nothing|a rep cannot read ingest data or edit settings|the wipe removes all demo rows|the seed loads after a wipe|no real staff first name appears'
UNKNOWN=$(echo "$OUT" | sed -n '/failing tests:/,$p' | grep -E "^✖ " | grep -vE "$KNOWN" | grep -v "failing tests")
COV=$(echo "$OUT" | grep -c "coverage threshold")
if [ -n "$UNKNOWN" ]; then echo "GATE: NEW FAILURES"; echo "$UNKNOWN"; exit 1; fi
if [ "$COV" != "0" ]; then echo "GATE: coverage below threshold"; exit 1; fi
timeout 300 node test/run/smoke-rollback.js > "${TMPDIR:-/tmp}/myfifty-smoke.txt" 2>&1
# Since 2026-10-22 the smoke test is date-proof (its date checks run on fresh rows dated from today), so every check must
# pass: no failure is allowed by name any more, and it must reach its end ("N passed, 0 failed").
SFAIL=$(grep -E "^FAIL" "${TMPDIR:-/tmp}/myfifty-smoke.txt")
if [ -n "$SFAIL" ] || ! grep -qE "^[0-9]+ passed, 0 failed" "${TMPDIR:-/tmp}/myfifty-smoke.txt" || grep -q "stopped with an error" "${TMPDIR:-/tmp}/myfifty-smoke.txt"; then echo "GATE: smoke failed"; echo "$SFAIL"; tail -5 "${TMPDIR:-/tmp}/myfifty-smoke.txt"; exit 1; fi
tail -1 "${TMPDIR:-/tmp}/myfifty-smoke.txt"
echo "GATE: OK (only the 10 known login-rights failures)"
