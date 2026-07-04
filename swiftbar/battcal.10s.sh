#!/bin/bash
# <xbar.title>BattCal</xbar.title>
# <xbar.desc>Menu bar status + control for the BattCal battery calibration engine.</xbar.desc>
# <xbar.dependencies>batt, battcal</xbar.dependencies>
# SwiftBar plugin, refreshes every 10s (filename battcal.10s.sh).

ME_UID=$(id -u)
# Detect the active namespace so the plugin works both on a published install (battcal.*) and on a
# personal deployment (battery-calibrate.* + com.parsa.battery-calibrate). Whichever the running
# engine uses wins; otherwise the plugin reads the wrong state files and always shows "stopped".
if [ -f /var/tmp/battery-calibrate.state ] || launchctl print "gui/$ME_UID/com.parsa.battery-calibrate" >/dev/null 2>&1; then
  NS=battery-calibrate; AGENT_LABEL=com.parsa.battery-calibrate
else
  NS=battcal; AGENT_LABEL=com.battcal.calibrate
fi
STATE_FILE="/var/tmp/${NS}.state"
PAUSE_FILE="/var/tmp/${NS}.pause"
LOG="$HOME/Library/Logs/${NS}.log"
CSV="$HOME/Library/Logs/${NS}-history.csv"
AGENT_PLIST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"

PCT=$(pmset -g batt | grep -Eo '[0-9]+%' | head -1 | tr -d '%')
IOR=$(ioreg -rn AppleSmartBattery)
if echo "$IOR" | grep '"AdapterDetails"' | grep -qE '"Watts"=[1-9]'; then PLUGGED=yes; else PLUGGED=no; fi
WATTS=$(echo "$IOR" | grep '"AdapterDetails"' | sed -n 's/.*"Watts"=\([0-9]*\).*/\1/p')
RAW=$(echo "$IOR" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
DES=$(echo "$IOR" | sed -n 's/^ *"DesignCapacity" = \([0-9]*\)$/\1/p')
CYC=$(echo "$IOR" | sed -n 's/^ *"CycleCount" = \([0-9]*\)$/\1/p')
RAWH=""
[ -n "$RAW" ] && [ "${DES:-0}" -gt 0 ] && RAWH=$(awk "BEGIN{printf \"%.1f\", $RAW*100/$DES}")

if launchctl print "gui/$ME_UID/$AGENT_LABEL" >/dev/null 2>&1; then AGENT=on; else AGENT=off; fi
STATE=$(cat "$STATE_FILE" 2>/dev/null || echo "-")
[ -f "$PAUSE_FILE" ] && STATE=paused
[ "$AGENT" = "off" ] && STATE=stopped

# Mode word for the labels (the plugin controls state; the engine owns the mode file). Without this
# the plugin hardcoded "calibration" and mislabeled longevity mode.
MODE=$(cat "/var/tmp/${NS}.mode" 2>/dev/null | tr -d '[:space:]')
[ "$MODE" = "longevity" ] || [ "$MODE" = "calibration" ] || MODE=longevity

case "$STATE" in
  drain)
    if [ "$PLUGGED" = "yes" ]; then TITLE="⇣ ${PCT}%"; DESC="Draining ($MODE active)"; COLOR=orange
    else TITLE="🔌⌛ ${PCT}%"; DESC="Waiting for charger ($MODE idle, normal battery use)"; COLOR=gray; fi ;;
  charge)  TITLE="⇡ ${PCT}%"; DESC="Charging ($MODE active)"; COLOR=green ;;
  hold)    TITLE="✓ ${PCT}%"; DESC="Holding at full, then next drain"; COLOR=green ;;
  paused)  TITLE="⏸ ${PCT}%"; DESC="PAUSED - normal charging, calibration on hold"; COLOR=blue ;;
  stopped) TITLE="🔋 ${PCT}%"; DESC="Calibration engine not running"; COLOR=gray ;;
  *)       TITLE="🔋 ${PCT}%"; DESC="Unknown state: $STATE"; COLOR=gray ;;
esac

echo "$TITLE"
echo "---"
echo "$DESC | color=$COLOR"
if [ "$PLUGGED" = "yes" ]; then
  echo "Battery ${PCT}% - plugged in (${WATTS}W adapter)"
else
  echo "Battery ${PCT}% - on battery (no charger)"
fi
[ -n "$RAWH" ] && echo "True battery health: ${RAWH}% raw (${RAW}/${DES} mAh) - cycles: $CYC"
if [ -f "$CSV" ]; then
  LASTROW=$(tail -1 "$CSV" | grep -v '^date')
  [ -n "$LASTROW" ] && echo "Last cycle snapshot: $LASTROW | font=Menlo size=11"
fi
echo "---"
if [ "$STATE" = "paused" ]; then
  echo "▶ Resume Calibration | bash=/bin/rm param1=-f param2=$PAUSE_FILE terminal=false refresh=true"
elif [ "$AGENT" = "on" ]; then
  echo "⚡ Charge Now (pause calibration) | bash=/usr/bin/touch param1=$PAUSE_FILE terminal=false refresh=true"
fi
if [ "$AGENT" = "off" ] && [ -f "$AGENT_PLIST" ]; then
  echo "▶ Start Calibration Engine | bash=/bin/launchctl param1=bootstrap param2=gui/$ME_UID param3=$AGENT_PLIST terminal=false refresh=true"
fi
echo "---"
echo "Open live log | bash=/usr/bin/open param1=-a param2=Console param3=$LOG terminal=false"
echo "Open cycle history (CSV) | bash=/usr/bin/open param1=$CSV terminal=false"
echo "Advanced"
echo "-- 🛑 Stop Calibration Permanently | bash=/bin/bash param1=-c param2=\"/bin/launchctl bootout gui/$ME_UID/$AGENT_LABEL; /usr/bin/touch $PAUSE_FILE; /opt/homebrew/bin/batt adapter enable\" terminal=false refresh=true"
echo "-- (stops cycling, restores normal charging)"
