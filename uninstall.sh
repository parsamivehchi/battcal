#!/bin/bash
# BattCal uninstaller. Removes the calibration engine and menu bar plugin,
# restores normal charging. Pass --daemon to also remove the batt LaunchDaemon.
set -uo pipefail

AGENT_LABEL=com.battcal.calibrate
AGENT_PLIST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
DAEMON_PLIST=/Library/LaunchDaemons/cc.chlc.batt.plist
ME_UID=$(id -u)

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }

say "Stopping calibration engine"
launchctl bootout "gui/$ME_UID/$AGENT_LABEL" 2>/dev/null || true
rm -f "$AGENT_PLIST"

say "Restoring normal charging"
/opt/homebrew/bin/batt adapter enable 2>/dev/null || true
/opt/homebrew/bin/batt limit 100 2>/dev/null || true

say "Removing engine files"
rm -rf "$HOME/.battcal"
rm -f /var/tmp/battcal.state /var/tmp/battcal.pause /var/tmp/battcal.holdstart /var/tmp/battcal.caffeinate.pid

PLUGIN_DIR=$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)
if [ -n "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/battcal.10s.sh" ]; then
  say "Removing SwiftBar plugin"
  rm -f "$PLUGIN_DIR/battcal.10s.sh"
fi

if [ "${1:-}" = "--daemon" ]; then
  say "Removing batt LaunchDaemon (requires your password)"
  sudo launchctl bootout system/cc.chlc.batt 2>/dev/null || true
  sudo rm -f "$DAEMON_PLIST"
fi

say "Done. Logs kept at ~/Library/Logs/battcal*.{log,csv,out} (delete manually if unwanted)."
say "Homebrew packages (batt, SwiftBar) were left installed; remove with:"
echo "    brew uninstall batt && brew uninstall --cask swiftbar"
