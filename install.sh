#!/bin/bash
# BattCal installer. Apple Silicon Macs only.
# Installs: batt daemon (charging control), the BattCal calibration engine
# (user LaunchAgent), and optionally the SwiftBar menu bar plugin.
#
# Usage:
#   ./install.sh              # engine only
#   ./install.sh --swiftbar   # engine + SwiftBar menu bar plugin
#
# Safe default: BattCal installs PAUSED. Nothing changes about your charging
# until you resume it (menu bar "Resume Calibration" or: rm /var/tmp/battcal.pause).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_LABEL=com.battcal.calibrate
AGENT_PLIST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
DAEMON_PLIST=/Library/LaunchDaemons/cc.chlc.batt.plist
ENGINE_DIR="$HOME/.battcal"
ME_UID=$(id -u)
WITH_SWIFTBAR=no
[ "${1:-}" = "--swiftbar" ] && WITH_SWIFTBAR=yes

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*"; exit 1; }

[ "$(uname -m)" = "arm64" ] || die "BattCal requires an Apple Silicon Mac."
command -v brew >/dev/null || die "Homebrew is required: https://brew.sh"

# 1. batt (charging control CLI + daemon)
if ! command -v batt >/dev/null && [ ! -x /opt/homebrew/bin/batt ]; then
  say "Installing batt via Homebrew"
  brew install batt
fi

# 2. batt daemon as a LaunchDaemon with non-root client access
if launchctl print system/cc.chlc.batt >/dev/null 2>&1; then
  say "batt daemon already running (system/cc.chlc.batt)"
else
  say "Installing batt LaunchDaemon (requires your password)"
  TMP_PLIST=$(mktemp)
  cat > "$TMP_PLIST" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>cc.chlc.batt</string>
	<key>ProgramArguments</key>
	<array>
		<string>/opt/homebrew/bin/batt</string>
		<string>daemon</string>
		<string>--always-allow-non-root-access</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>/var/log/batt.log</string>
	<key>StandardErrorPath</key>
	<string>/var/log/batt.log</string>
</dict>
</plist>
PLIST
  sudo cp "$TMP_PLIST" "$DAEMON_PLIST"
  sudo chown root:wheel "$DAEMON_PLIST"
  sudo chmod 644 "$DAEMON_PLIST"
  sudo xattr -c "$DAEMON_PLIST" 2>/dev/null || true
  sudo launchctl bootstrap system "$DAEMON_PLIST"
  rm -f "$TMP_PLIST"
  sleep 2
fi

# 3. Verify adapter control works (non-destructive: enable is the normal state).
if /opt/homebrew/bin/batt adapter enable >/dev/null 2>&1; then
  say "batt adapter control verified"
else
  warn "batt adapter control not responding yet. On some macOS versions 'batt status'"
  warn "fails with 'key has no data' but adapter control still works; check:"
  warn "  /opt/homebrew/bin/batt adapter enable"
fi

# 4. Calibration engine
say "Installing BattCal engine to $ENGINE_DIR"
mkdir -p "$ENGINE_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$REPO_DIR/bin/battcal-engine.sh" "$ENGINE_DIR/battcal-engine.sh"
chmod 755 "$ENGINE_DIR/battcal-engine.sh"

# Safe default: start paused so installing never changes charging behavior.
touch /var/tmp/battcal.pause

cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${AGENT_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>${ENGINE_DIR}/battcal-engine.sh</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${HOME}/Library/Logs/battcal.out</string>
	<key>StandardErrorPath</key>
	<string>${HOME}/Library/Logs/battcal.out</string>
</dict>
</plist>
PLIST
xattr -c "$AGENT_PLIST" 2>/dev/null || true
launchctl bootout "gui/$ME_UID/$AGENT_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$ME_UID" "$AGENT_PLIST"
say "Engine installed and running (PAUSED)"

# 5. Optional SwiftBar menu bar plugin
if [ "$WITH_SWIFTBAR" = "yes" ]; then
  if [ ! -d /Applications/SwiftBar.app ]; then
    say "Installing SwiftBar via Homebrew"
    brew install --cask swiftbar
  fi
  PLUGIN_DIR=$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)
  if [ -z "$PLUGIN_DIR" ]; then
    PLUGIN_DIR="$HOME/.swiftbar"
    mkdir -p "$PLUGIN_DIR"
    defaults write com.ameba.SwiftBar PluginDirectory -string "$PLUGIN_DIR"
  fi
  cp "$REPO_DIR/swiftbar/battcal.10s.sh" "$PLUGIN_DIR/battcal.10s.sh"
  chmod 755 "$PLUGIN_DIR/battcal.10s.sh"
  open -a SwiftBar
  say "SwiftBar plugin installed to $PLUGIN_DIR"
fi

echo
say "BattCal is installed and PAUSED. Nothing changes until you start it:"
echo "    menu bar:  ⏸ icon -> Resume Calibration     (with --swiftbar)"
echo "    terminal:  rm /var/tmp/battcal.pause"
echo
echo "  Pause anytime (instant normal charging):  touch /var/tmp/battcal.pause"
echo "  Watch:    tail -f ~/Library/Logs/battcal.log"
echo "  History:  ~/Library/Logs/battcal-history.csv"
echo "  Remove:   ./uninstall.sh"
