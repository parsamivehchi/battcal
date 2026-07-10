#!/bin/bash
# check.sh - BattCal's minimal quality gate. Read-only: no POSTs, never touches charging.
# Runs every syntax/type gate plus a read-only live smoke. deploy.sh runs this first and
# fails closed; run it standalone anytime: ./scripts/check.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0
pass() { printf '  PASS %s\n' "$*"; }
fail() { printf '  FAIL %s\n' "$*"; FAILED=1; }

# (a) bash syntax on every shipped shell script
for f in bin/battcal-engine.sh deploy.sh install.sh uninstall.sh swiftbar/battcal.10s.sh scripts/check.sh; do
  if bash -n "$REPO/$f" 2>/dev/null; then pass "bash -n $f"; else fail "bash -n $f"; fi
done

# (b) server syntax
if node --check "$REPO/server/server.mjs" >/dev/null 2>&1; then pass "node --check server/server.mjs"; else fail "node --check server/server.mjs"; fi

# (c) dashboard typecheck (skipped with a FAIL if node_modules is missing)
if [ -d "$REPO/dashboard/node_modules" ]; then
  if (cd "$REPO/dashboard" && npx tsc --noEmit >/dev/null 2>&1); then pass "tsc --noEmit dashboard"; else fail "tsc --noEmit dashboard"; fi
else
  fail "dashboard/node_modules missing (cd dashboard && npm install)"
fi

# (c2) cloud mirror typecheck (skipped when its deps are absent; the Vercel build is the
# authoritative gate for the hosted app, this catches type breaks before push).
if [ -d "$REPO/node_modules/next" ] && [ -f "$REPO/cloud/next-env.d.ts" ]; then
  if (cd "$REPO/cloud" && npx tsc --noEmit >/dev/null 2>&1); then pass "tsc --noEmit cloud"; else fail "tsc --noEmit cloud"; fi
else
  pass "cloud deps/types not present - skipping cloud typecheck"
fi

# (d) Swift syntax gate for the menu bar app. -parse is syntax-only (fast, no SDK link);
# full type checking still happens in deploy.sh's xcodebuild. Skips when Xcode tools are absent.
if xcrun --find swiftc >/dev/null 2>&1; then
  if xcrun swiftc -parse "$REPO"/menubar/BattCalBar/*.swift >/dev/null 2>&1; then
    pass "swiftc -parse menubar/BattCalBar"
  else
    fail "swiftc -parse menubar/BattCalBar"
  fi
else
  pass "swiftc not found - skipping Swift syntax gate"
fi

# (e) read-only live smoke: /api/status must carry the core fields. GET only, no POSTs.
PORT="${BATTCAL_DASH_PORT:-4437}"
j=$(curl -s --max-time 4 "http://localhost:$PORT/api/status" 2>/dev/null || true)
if [ -n "$j" ]; then
  ok=1
  for k in state mode pct namespace; do
    printf '%s' "$j" | grep -q "\"$k\"" || ok=0
  done
  if [ "$ok" = 1 ]; then pass "/api/status live smoke (state/mode/pct/namespace)"; else fail "/api/status missing core fields: $j"; fi
else
  pass "/api/status not reachable (server not running) - skipping live smoke"
fi

exit "$FAILED"
