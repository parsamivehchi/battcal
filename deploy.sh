#!/bin/bash
# deploy.sh - rebuild and redeploy BattCal's live surfaces from the repo, with verification.
#
# BattCal runs from DEPLOYED copies, not the repo (launchd cannot run scripts from ~/Desktop
# under TCC). This script rebuilds and redeploys any/all surfaces, verifies each with real
# evidence, and NEVER changes the user's charging state.
#
# Usage: ./deploy.sh [all|engine|server|dashboard|menubar|verify|release] [vX.Y.Z] [--dry-run]
#   all (default)  build + deploy + verify every present surface
#   engine         regenerate + deploy the engine (from bin/battcal-engine.sh)
#   server         deploy server + dashboard (they ship together)
#   dashboard      alias for server (the two are coupled)
#   menubar        build + codesign + install the menu bar app
#   verify         run all verification checks, deploy nothing
#   release        build + ad-hoc sign + zip the menu bar app, publish a GitHub Release
#                  (ad-hoc / unnotarized; the release notes carry the Gatekeeper unlock).
#                  Version = the vX.Y.Z arg, else the app's MARKETING_VERSION.
#   --dry-run      print planned actions, execute nothing (for release: build + zip +
#                  verify the artifact locally, print the release, but do NOT publish)
#
# The engine's deployed copy is GENERATED from bin/battcal-engine.sh by a surgical namespace
# substitution: bin/battcal-engine.sh is the single source of truth. Do NOT hand-edit the
# deployed copy. Install detection mirrors server.mjs and swiftbar/battcal.10s.sh, so this
# script has no personal hardcodes and works on either the personal or the OSS install.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UID_NUM="$(id -u)"
DRY=0
CMD=""
REL_VERSION=""

for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    all|engine|server|dashboard|menubar|verify|release) CMD="$a" ;;
    v[0-9]*) REL_VERSION="$a" ;;
    -h|--help) sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $a (see --help)" >&2; exit 2 ;;
  esac
done
CMD="${CMD:-all}"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
pass() { printf '%s  PASS%s %s\n' "$GREEN" "$RESET" "$*"; }
fail() { printf '%s  FAIL%s %s\n' "$RED" "$RESET" "$*"; FAILED=1; }
warn() { printf '%s  WARN%s %s\n' "$YELLOW" "$RESET" "$*"; }
FAILED=0

# ---- detect the live install (namespace, labels) ----
if [ -f /var/tmp/battery-calibrate.state ] || launchctl print "gui/$UID_NUM/com.parsa.battery-calibrate" >/dev/null 2>&1; then
  NS=battery-calibrate; ENGINE_LABEL=com.parsa.battery-calibrate; DASH_LABEL=com.parsa.battcal-dashboard
else
  NS=battcal; ENGINE_LABEL=com.battcal.calibrate; DASH_LABEL=com.parsa.battcal-dashboard
fi

# First .sh/.mjs in a LaunchAgent's ProgramArguments (empty if the plist is absent).
plist_script() {
  local p="$HOME/Library/LaunchAgents/$1.plist"
  [ -f "$p" ] || return 0
  /usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$p" 2>/dev/null | grep -Eo '/[^ ]+\.(sh|mjs)' | head -1 || true
}

ENGINE_DEST="$(plist_script "$ENGINE_LABEL")"
if [ -z "$ENGINE_DEST" ]; then
  if [ "$NS" = battery-calibrate ]; then ENGINE_DEST="$HOME/Library/Scripts/battery-calibrate.sh"; else ENGINE_DEST="$HOME/.battcal/battcal-engine.sh"; fi
fi
DASH_SCRIPT="$(plist_script "$DASH_LABEL")"
if [ -n "$DASH_SCRIPT" ]; then APP_DIR="$(dirname "$(dirname "$DASH_SCRIPT")")"; else APP_DIR="$HOME/.battcal/app"; fi

PORT="${BATTCAL_DASH_PORT:-4437}"
APP_URL="http://localhost:$PORT"

# ---- surface presence ----
have_dash=0; { [ -n "$DASH_SCRIPT" ] || [ -d "$APP_DIR/server" ]; } && have_dash=1
have_menubar=0; [ -d /Applications/BattCalBar.app ] && have_menubar=1

# ---- BattCal state capture (for the never-change-charging assertion) ----
capture_state() {
  local j paused mode
  j=$(curl -s --max-time 3 "$APP_URL/api/status" 2>/dev/null || true)
  paused=$(printf '%s' "$j" | grep -oE '"paused":[a-z]+' | head -1 | cut -d: -f2 || true)
  mode=$(printf '%s' "$j" | grep -oE '"mode":"[a-z]+"' | head -1 | cut -d: -f2 | tr -d '"' || true)
  printf '%s/%s' "${paused:-unknown}" "${mode:-unknown}"
}

# ---- engine: surgical transform + self-check + kickstart ----
deploy_engine() {
  step "engine -> $ENGINE_DEST  ($ENGINE_LABEL)"
  if [ "$DRY" = 1 ]; then
    if [ "$NS" = battery-calibrate ]; then
      say "  [dry] generate from bin/battcal-engine.sh via anchored namespace transform"
      say "  [dry]   (renames /var/tmp/battcal.* + battcal.log + battcal-history.csv + com.battcal.calibrate;"
      say "  [dry]    leaves battcal-telemetry.csv and ~/.battcal/config untouched), then kickstart"
    else
      say "  [dry] cp bin/battcal-engine.sh -> $ENGINE_DEST (OSS namespace, no transform), then kickstart"
    fi
    return 0
  fi
  local tmp; tmp="$(mktemp)"
  if [ "$NS" = battery-calibrate ]; then
    sed -E \
      -e 's#/var/tmp/battcal\.#/var/tmp/battery-calibrate.#g' \
      -e 's#Library/Logs/battcal\.log#Library/Logs/battery-calibrate.log#g' \
      -e 's#Library/Logs/battcal-history\.csv#Library/Logs/battery-calibrate-history.csv#g' \
      -e 's#com\.battcal\.calibrate#com.parsa.battery-calibrate#g' \
      "$REPO/bin/battcal-engine.sh" > "$tmp"
    # Self-checks: shared paths must survive; namespaced tokens must all be renamed.
    local c_tel c_cfg c_state c_label
    c_tel=$(grep -c 'battcal-telemetry' "$tmp" || true)
    c_cfg=$(grep -c '\.battcal/config' "$tmp" || true)
    c_state=$(grep -Ec '/var/tmp/battcal\.' "$tmp" || true)
    c_label=$(grep -c 'com\.battcal\.calibrate' "$tmp" || true)
    if [ "$c_tel" -lt 1 ] || [ "$c_cfg" -lt 1 ]; then fail "transform lost shared paths (telemetry=$c_tel config=$c_cfg)"; rm -f "$tmp"; return 0; fi
    if [ "$c_state" -ne 0 ] || [ "$c_label" -ne 0 ]; then fail "transform left namespaced tokens (state=$c_state label=$c_label)"; rm -f "$tmp"; return 0; fi
  else
    cp "$REPO/bin/battcal-engine.sh" "$tmp"
  fi
  if ! bash -n "$tmp"; then fail "generated engine failed bash -n"; rm -f "$tmp"; return 0; fi
  if [ -f "$ENGINE_DEST" ]; then
    if diff -q "$ENGINE_DEST" "$tmp" >/dev/null 2>&1; then
      say "  deployed engine already current (no change)"
    else
      say "  ${DIM}changes vs current deployed engine (expect only header comments on first run):${RESET}"
      diff "$ENGINE_DEST" "$tmp" | sed 's/^/    /' || true
    fi
  fi
  mkdir -p "$(dirname "$ENGINE_DEST")"
  mv "$tmp" "$ENGINE_DEST"; chmod +x "$ENGINE_DEST"
  # Fresh managed-restart marker: the dying engine's EXIT trap sees it and leaves the
  # adapter exactly as the cycle had it (an UNMANAGED death re-enables the adapter so a
  # crash never strands a plugged Mac draining to empty).
  touch "/var/tmp/$NS.managed-restart"
  if launchctl kickstart -k "gui/$UID_NUM/$ENGINE_LABEL"; then pass "engine deployed + kickstarted"; else fail "engine deployed but kickstart failed (is the agent loaded?)"; fi
}

verify_engine() {
  if bash -n "$ENGINE_DEST" 2>/dev/null; then pass "engine bash -n"; else fail "engine bash -n"; fi
  if launchctl print "gui/$UID_NUM/$ENGINE_LABEL" >/dev/null 2>&1; then pass "engine agent loaded ($ENGINE_LABEL)"; else fail "engine agent NOT loaded"; fi
}

# ---- server + dashboard (coupled: served relative to the deployed server) ----
deploy_serverdash() {
  step "server + dashboard -> $APP_DIR  ($DASH_LABEL)"
  if [ "$DRY" = 1 ]; then
    say "  [dry] (cd dashboard && npm install if needed && npm run build)"
    say "  [dry] cp server/server.mjs -> $APP_DIR/server/ ; rsync dashboard/dist/ -> $APP_DIR/dashboard/dist/ ; kickstart $DASH_LABEL"
    return 0
  fi
  if ! ( cd "$REPO/dashboard" && { [ -d node_modules ] || npm install; } && npm run build ); then fail "dashboard build failed"; return 0; fi
  mkdir -p "$APP_DIR/server" "$APP_DIR/dashboard/dist"
  cp "$REPO/server/server.mjs" "$APP_DIR/server/server.mjs"
  rsync -a --delete "$REPO/dashboard/dist/" "$APP_DIR/dashboard/dist/"
  if launchctl kickstart -k "gui/$UID_NUM/$DASH_LABEL"; then sleep 2; pass "server + dashboard deployed + kickstarted"; else fail "server + dashboard deployed but kickstart failed"; fi
}

verify_serverdash() {
  local h disk served
  h=$(curl -s --max-time 4 "$APP_URL/api/health" 2>/dev/null || true)
  if [ "$h" = '{"ok":true}' ]; then pass "server health ($APP_URL)"; else fail "server health returned: '$h'"; fi
  disk=$(cd "$REPO/dashboard/dist/assets" 2>/dev/null && ls index-*.js 2>/dev/null | head -1 || true)
  served=$(curl -s --max-time 4 "$APP_URL/" 2>/dev/null | grep -oE 'index-[A-Za-z0-9_]+\.js' | head -1 || true)
  if [ -n "$disk" ] && [ "$disk" = "$served" ]; then pass "served bundle == disk ($served)"; else warn "bundle mismatch: disk=$disk served=$served"; fi
  if curl -s --max-time 4 "$APP_URL/api/status" 2>/dev/null | grep -q '"namespace"'; then pass "/api/status live (namespace present)"; else fail "/api/status not returning fields"; fi
}

# ---- shared menu-bar build: Release build -> provenance-free stage -> ad-hoc sign -> strict verify.
# Sets STAGED_APP to the staged .app path on success; returns 1 (and calls fail) on any failure.
# The caller owns "$STAGED_APP" and must rm -rf "$(dirname "$STAGED_APP")" when done.
STAGED_APP=""
build_staged_app() {
  STAGED_APP=""
  local xclog built stage
  xclog="$(mktemp)"
  if ! ( cd "$REPO/menubar" && xattr -cr . && xcodegen >/dev/null && \
         xcodebuild -project BattCalBar.xcodeproj -scheme BattCalBar -configuration Release \
                    -derivedDataPath build CODE_SIGNING_ALLOWED=NO build >"$xclog" 2>&1 ); then
    fail "xcodebuild failed (log: $xclog)"; tail -5 "$xclog" | sed 's/^/    /'; return 1
  fi
  rm -f "$xclog"
  built="$REPO/menubar/build/Build/Products/Release/BattCalBar.app"
  if [ ! -d "$built" ]; then fail "build product missing: $built"; return 1; fi
  stage="$(mktemp -d)/BattCalBar.app"
  ditto --norsrc --noextattr --noacl "$built" "$stage"
  codesign --force --deep --sign - "$stage" >/dev/null 2>&1
  if ! codesign --verify --strict "$stage" >/dev/null 2>&1; then
    fail "codesign --verify --strict failed on staged app"; rm -rf "$(dirname "$stage")"; return 1
  fi
  STAGED_APP="$stage"
}

# ---- menu bar: build + codesign dance + rollback-safe swap ----
deploy_menubar() {
  step "menu bar -> /Applications/BattCalBar.app"
  if [ "$DRY" = 1 ]; then
    say "  [dry] xattr -cr; xcodegen; xcodebuild Release CODE_SIGNING_ALLOWED=NO"
    say "  [dry] ditto --norsrc --noextattr --noacl -> stage; codesign --force --deep --sign -; --verify --strict (GATE)"
    say "  [dry] quit app; mv /Applications aside; ditto stage -> /Applications; open; verify; rollback on failure"
    return 0
  fi
  build_staged_app || return 0
  local stage="$STAGED_APP" backup
  osascript -e 'quit app "BattCalBar"' >/dev/null 2>&1 || true; pkill -x BattCalBar 2>/dev/null || true; sleep 1
  backup=""
  if [ -d /Applications/BattCalBar.app ]; then backup="$(mktemp -d)/BattCalBar.app"; mv /Applications/BattCalBar.app "$backup"; fi
  ditto --norsrc --noextattr --noacl "$stage" /Applications/BattCalBar.app
  open /Applications/BattCalBar.app 2>/dev/null || true
  sleep 2
  if pgrep -x BattCalBar >/dev/null && codesign --verify --strict /Applications/BattCalBar.app >/dev/null 2>&1; then
    pass "menu bar deployed + running (pid $(pgrep -x BattCalBar))"
    [ -n "$backup" ] && rm -rf "$(dirname "$backup")"
    rm -rf "$(dirname "$stage")"
  else
    fail "menu bar failed to launch/verify -> ROLLING BACK"
    rm -rf /Applications/BattCalBar.app
    if [ -n "$backup" ]; then mv "$backup" /Applications/BattCalBar.app; open /Applications/BattCalBar.app 2>/dev/null || true; fi
    rm -rf "$(dirname "$stage")"
  fi
}

# ---- release: build a signed, zipped app and publish a GitHub Release (free / unnotarized path) ----
do_release() {
  step "release -> GitHub Release  (build + ad-hoc sign + zip$([ "$DRY" = 1 ] && printf ' ; PREVIEW, no publish'))"
  if ! command -v gh >/dev/null 2>&1; then fail "gh CLI not found (brew install gh)"; return 0; fi
  if ! ( cd "$REPO" && gh auth status ) >/dev/null 2>&1; then fail "gh not authenticated (run: gh auth login)"; return 0; fi
  build_staged_app || return 0
  local stage="$STAGED_APP" stagedir; stagedir="$(dirname "$stage")"
  local ver="$REL_VERSION"
  if [ -z "$ver" ]; then
    local mv; mv="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$stage/Contents/Info.plist" 2>/dev/null || true)"
    [ -n "$mv" ] && ver="v$mv"
  fi
  if [ -z "$ver" ]; then fail "no version; pass one, e.g. ./deploy.sh release v1.0.0"; rm -rf "$stagedir"; return 0; fi
  local arch; arch="$(lipo -archs "$stage/Contents/MacOS/BattCalBar" 2>/dev/null | tr ' ' '-' || echo arm64)"
  local zipdir zip; zipdir="$(mktemp -d)"; zip="$zipdir/BattCalBar-$ver-macos-$arch.zip"
  ditto -c -k --keepParent "$stage" "$zip"
  say "  packaged: $(basename "$zip") ($(du -h "$zip" | cut -f1 | tr -d ' '))"
  # Verify the artifact end to end: unzip a fresh copy and strict-verify the bundle.
  local vd; vd="$(mktemp -d)"; ditto -x -k "$zip" "$vd"
  if codesign --verify --strict "$vd/BattCalBar.app" >/dev/null 2>&1; then pass "release artifact codesign --verify --strict"; else fail "release artifact failed strict verify"; rm -rf "$stagedir" "$zipdir" "$vd"; return 0; fi
  rm -rf "$vd"
  local notes; notes="$(mktemp)"
  cat > "$notes" <<EOF
BattCal - battery band-cycler menu bar app for Apple Silicon Macs.

## Install
1. Download \`$(basename "$zip")\` below and unzip it.
2. Move \`BattCalBar.app\` into \`/Applications\`.
3. This build is ad-hoc signed (not notarized), so on first launch macOS Gatekeeper
   blocks it. Clear the download quarantine once:
   \`\`\`sh
   xattr -dr com.apple.quarantine /Applications/BattCalBar.app
   \`\`\`
   (or right-click the app in Finder, choose Open, then Open). It launches normally after that.
4. See the README to set up the engine + dashboard.

Requires an Apple Silicon Mac ($arch).
EOF
  if [ "$DRY" = 1 ]; then
    say "  [dry] would publish: gh release create $ver <zip> --title \"BattCal $ver\" --notes-file <notes>"
    say "  ${DIM}--- release notes preview ---${RESET}"; sed 's/^/  /' "$notes"
    rm -f "$notes"; rm -rf "$stagedir" "$zipdir"; return 0
  fi
  if ( cd "$REPO" && gh release view "$ver" ) >/dev/null 2>&1; then
    if ( cd "$REPO" && gh release upload "$ver" "$zip" --clobber ); then pass "updated release asset on $ver"; else fail "gh release upload failed"; fi
  else
    if ( cd "$REPO" && gh release create "$ver" "$zip" --title "BattCal $ver" --notes-file "$notes" ); then pass "published GitHub Release $ver"; else fail "gh release create failed"; fi
  fi
  local url; url="$( cd "$REPO" && gh release view "$ver" --json url -q .url 2>/dev/null || true)"
  [ -n "$url" ] && say "  release: $url"
  rm -f "$notes"; rm -rf "$stagedir" "$zipdir"
}

verify_menubar() {
  if codesign --verify --strict /Applications/BattCalBar.app >/dev/null 2>&1; then pass "menu bar codesign --verify --strict"; else fail "menu bar codesign strict"; fi
  if pgrep -x BattCalBar >/dev/null; then pass "menu bar running (pid $(pgrep -x BattCalBar))"; else fail "menu bar not running"; fi
}

# ---- run ----
say "${BOLD}battcal deploy${RESET}  cmd=$CMD  ns=$NS  uid=$UID_NUM  dry=$DRY"

# Quality gate first, fail closed: nothing deploys if a syntax/type gate is red.
# (verify is read-only anyway; --dry-run makes no changes to gate.)
if [ "$DRY" = 0 ] && [ "$CMD" != verify ]; then
  step "pre-flight gate (scripts/check.sh)"
  if bash "$REPO/scripts/check.sh"; then pass "check.sh green"; else fail "check.sh failed - aborting before any deploy"; say ""; say "${RED}${BOLD}deploy aborted${RESET}"; exit 1; fi
fi
say "  engine  -> $ENGINE_DEST"
say "  app dir -> $APP_DIR  ($APP_URL, dash present=$have_dash)"
say "  menubar -> /Applications/BattCalBar.app  (present=$have_menubar)"

BEFORE="$(capture_state)"

case "$CMD" in
  engine)            deploy_engine ;;
  server|dashboard)  deploy_serverdash ;;
  menubar)           deploy_menubar ;;
  release)           do_release ;;
  all)
    deploy_engine
    if [ "$have_dash" = 1 ]; then deploy_serverdash; else warn "no dashboard install detected; skipping server/dashboard"; fi
    if [ "$have_menubar" = 1 ]; then deploy_menubar; else warn "no menu bar app detected; skipping"; fi
    ;;
  verify) : ;;
esac

# release self-verifies the artifact inline; the surface checks below do not apply to it.
if [ "$CMD" != release ]; then
step "verification"
case "$CMD" in
  engine)            verify_engine ;;
  server|dashboard)  verify_serverdash ;;
  menubar)           verify_menubar ;;
  all|verify)
    verify_engine
    [ "$have_dash" = 1 ] && verify_serverdash || true
    [ "$have_menubar" = 1 ] && verify_menubar || true
    ;;
esac
fi

if [ "$DRY" = 0 ] && [ "$CMD" != verify ] && [ "$CMD" != release ]; then
  AFTER="$(capture_state)"
  if [ "$BEFORE" = "$AFTER" ]; then pass "BattCal state unchanged (paused/mode = $AFTER)"; else warn "BattCal state changed by deploy: $BEFORE -> $AFTER (a deploy must not alter charging)"; fi
fi

say ""
if [ "$FAILED" = 0 ]; then say "${GREEN}${BOLD}deploy OK${RESET}"; else say "${RED}${BOLD}deploy had failures (see above)${RESET}"; exit 1; fi
