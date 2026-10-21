#!/bin/sh
# Test run 2026-10-21: the full re-run, from scratch, in one go. Servers must be running (one per test person, see report).
#   sh test/run/rerun-all.sh <screenshot-dir>
cd "$(dirname "$0")/../.."
OUT="${1:-${TMPDIR:-/tmp}/myfifty-rerun}"
mkdir -p "$OUT"
G="--require $(pwd -W 2>/dev/null || pwd)/test/run/no-network.js"
echo "== 1. proof that nothing can leave the computer"
NODE_OPTIONS="$G" node test/run/prove-offline.js 2>&1 | grep -E "passed|FAIL"
echo "== 2. all automated tests (unit + database + smoke, rolled back)"
sh test/run/gate.sh 2>&1 | tail -5
echo "== 3. random input (5 seeds)"
for s in 7 11 23 99 1234; do FUZZ_SEED=$s NODE_OPTIONS="$G" NO_NETWORK_QUIET=1 node --test test/db/testrun-routes.test.js 2>&1 | grep -E "^ℹ fail"; done
echo "== 4. rep against rep through the local servers"
NODE_OPTIONS="$G" NO_NETWORK_QUIET=1 node test/run/access.js 2>&1 | tail -1
echo "== 5. screens and flows in the browser"
for sc in "5201 stale" "5201 alpha" "5205 empty" "5206 load" "5203 admin" "5201 flows" "5201 flows2" "5201 signedout" "5201 searchrace" "5201 navrace" "5201 undotwice" "5201 monkey"; do
  set -- $sc
  node test/run/cdp-screens.js "$OUT" $1 $2 2>&1 | grep -E "PAGE ERROR|CONSOLE|SCRIPT ERROR|NO ELEMENT|NOT FOUND|STALE|WRONG|ERROR SHOWN|OK$|FLOW|blocked" | grep -v "raw markup" | sed "s/^/[$2] /"
done
echo "== done"
