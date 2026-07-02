#!/bin/bash
# battcal-engine.sh - full-range battery calibration cycler for Apple Silicon MacBooks.
#
# Runs as a user LaunchAgent (com.battcal.calibrate). Requires the batt daemon
# (https://github.com/charlie0129/batt) running with --always-allow-non-root-access.
#
# Cycle: DRAIN to LOW% (adapter software-cut via batt, works while plugged in)
#        -> CHARGE to 100% -> HOLD at full -> repeat.
# Calibration only runs while a charger is physically attached. Unplug and the
# engine steps aside: normal charging behavior, no sleep-blocking, until AC returns.
#
# Pause:    touch /var/tmp/battcal.pause     (restores normal charging, engine idles)
# Resume:   rm /var/tmp/battcal.pause
# Stop:     launchctl bootout gui/$(id -u)/com.battcal.calibrate ; batt adapter enable
# Watch:    tail -f ~/Library/Logs/battcal.log
# History:  ~/Library/Logs/battcal-history.csv (one row per completed cycle)
#
# Config (optional): ~/.battcal/config may override LOW, POLL, HOLD_SECS, BATT.

BATT=/opt/homebrew/bin/batt
STATE_FILE=/var/tmp/battcal.state
PAUSE_FILE=/var/tmp/battcal.pause
HOLD_FILE=/var/tmp/battcal.holdstart
CAFF_PID_FILE=/var/tmp/battcal.caffeinate.pid
LOG="$HOME/Library/Logs/battcal.log"
CSV="$HOME/Library/Logs/battcal-history.csv"
LOW=5           # percent: switch from drain to charge at/below this
POLL=30         # seconds between checks
HOLD_SECS=3600  # hold at 100% this long before the next drain

# shellcheck source=/dev/null
[ -f "$HOME/.battcal/config" ] && . "$HOME/.battcal/config"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

pct() { pmset -g batt | grep -Eo '[0-9]+%' | head -1 | tr -d '%'; }

fully_charged() {
  ioreg -rn AppleSmartBattery | sed -n 's/^ *"FullyCharged" = \(.*\)$/\1/p'
}

is_charging() { pmset -g batt | grep -q '; charging;'; }

# Physically plugged in? ExternalConnected reads No while batt has the adapter
# software-cut, but AdapterDetails keeps the real charger info (Watts>0) either way.
plugged() {
  ioreg -rn AppleSmartBattery | grep '"AdapterDetails"' | grep -qE '"Watts"=[1-9]'
}

start_caffeinate() {
  if [ -f "$CAFF_PID_FILE" ] && kill -0 "$(cat "$CAFF_PID_FILE")" 2>/dev/null; then return; fi
  /usr/bin/caffeinate -i &
  echo $! > "$CAFF_PID_FILE"
  log "caffeinate -i started (pid $!) - idle sleep blocked for drain phase"
}

stop_caffeinate() {
  if [ -f "$CAFF_PID_FILE" ]; then
    kill "$(cat "$CAFF_PID_FILE")" 2>/dev/null
    rm -f "$CAFF_PID_FILE"
  fi
}

TELEMETRY="$HOME/Library/Logs/battcal-telemetry.csv"

# One detailed row per poll: what the battery is doing right now.
log_telemetry() {
  local ior state chg pct rawcur rawmax mv ma temp aw watts
  ior=$(ioreg -rn AppleSmartBattery)
  state=$1; pct=$2
  chg=no; pmset -g batt | grep -q '; charging;' && chg=yes
  rawcur=$(echo "$ior" | sed -n 's/^ *"AppleRawCurrentCapacity" = \([0-9]*\)$/\1/p')
  rawmax=$(echo "$ior" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
  mv=$(echo "$ior" | sed -n 's/^ *"Voltage" = \([0-9]*\)$/\1/p')
  ma=$(echo "$ior" | sed -n 's/^ *"Amperage" = \([0-9]*\)$/\1/p')
  # Amperage is unsigned 64-bit in ioreg; discharge shows as 2^64-x. Convert to signed.
  ma=$(awk "BEGIN{v=$ma+0; if (v>9e18) v-=18446744073709551616; printf \"%d\", v}")
  temp=$(echo "$ior" | sed -n 's/^ *"Temperature" = \([0-9]*\)$/\1/p')
  temp=$(awk "BEGIN{printf \"%.1f\", ${temp:-0}/100}")
  aw=$(echo "$ior" | grep '"AdapterDetails"' | sed -n 's/.*"Watts"=\([0-9]*\).*/\1/p'); aw=${aw:-0}
  watts=$(awk "BEGIN{printf \"%.1f\", ${mv:-0}*${ma:-0}/1000000}")
  [ -f "$TELEMETRY" ] || echo "ts,state,pct,charging,raw_current_mAh,raw_max_mAh,voltage_mV,amperage_mA,battery_W,adapter_W,temp_C" > "$TELEMETRY"
  echo "$(date '+%Y-%m-%dT%H:%M:%S'),$state,$pct,$chg,$rawcur,$rawmax,$mv,$ma,$watts,$aw,$temp" >> "$TELEMETRY"
}

snapshot_csv() {
  local ior raw nom cyc apple
  ior=$(ioreg -rn AppleSmartBattery)
  raw=$(echo "$ior" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
  nom=$(echo "$ior" | sed -n 's/^ *"NominalChargeCapacity" = \([0-9]*\)$/\1/p')
  cyc=$(echo "$ior" | sed -n 's/^ *"CycleCount" = \([0-9]*\)$/\1/p')
  apple=$(system_profiler SPPowerDataType 2>/dev/null | sed -n 's/.*Maximum Capacity: //p')
  [ -f "$CSV" ] || echo "date,cycle_count,raw_mAh,nominal_mAh,apple_health" > "$CSV"
  echo "$(date '+%Y-%m-%d %H:%M'),$cyc,$raw,$nom,$apple" >> "$CSV"
}

trap 'stop_caffeinate' EXIT TERM INT

[ -f "$STATE_FILE" ] || echo drain > "$STATE_FILE"
STATE=$(cat "$STATE_FILE")
log "=== battcal engine started (state=$STATE, battery $(pct)%) ==="

# Reassert adapter mode for the state we woke up in (unless paused)
if [ ! -f "$PAUSE_FILE" ]; then
  case "$STATE" in
    drain)        "$BATT" adapter disable >>"$LOG" 2>&1 ;;
    charge|hold)  "$BATT" adapter enable  >>"$LOG" 2>&1 ;;
  esac
fi

AWAITING_AC=0

while true; do
  # User pause switch
  if [ -f "$PAUSE_FILE" ]; then
    if [ "$(cat "$STATE_FILE")" != "paused" ]; then
      log "PAUSED by user - adapter re-enabled, normal charging"
      "$BATT" adapter enable >>"$LOG" 2>&1
      stop_caffeinate
      echo paused > "$STATE_FILE"
    fi
    sleep "$POLL"; continue
  fi

  STATE=$(cat "$STATE_FILE")
  if [ "$STATE" = "paused" ]; then
    log "RESUMED - entering drain"
    echo drain > "$STATE_FILE"; STATE=drain
    "$BATT" adapter disable >>"$LOG" 2>&1
  fi

  P=$(pct)
  if [ -z "$P" ]; then sleep "$POLL"; continue; fi

  log_telemetry "$STATE" "$P"

  case "$STATE" in
    drain)
      if [ "$P" -le "$LOW" ]; then
        log "reached ${P}% - switching to CHARGE"
        "$BATT" adapter enable >>"$LOG" 2>&1
        stop_caffeinate
        AWAITING_AC=0
        echo charge > "$STATE_FILE"
      elif ! plugged; then
        # Charger physically unplugged: calibration only runs on AC. Hand charging
        # back (so any charger works instantly) and let the Mac behave normally.
        if [ "$AWAITING_AC" -eq 0 ]; then
          log "charger unplugged at ${P}% - calibration idle until AC returns"
          "$BATT" adapter enable >>"$LOG" 2>&1
          stop_caffeinate
          AWAITING_AC=1
        fi
      else
        if [ "$AWAITING_AC" -eq 1 ]; then
          log "charger back at ${P}% - resuming drain"
          AWAITING_AC=0
          "$BATT" adapter disable >>"$LOG" 2>&1
        fi
        start_caffeinate
        # If something re-enabled charging (batt daemon restart etc.), reassert the cut
        if is_charging; then
          log "charging detected during drain at ${P}% - reasserting adapter disable"
          "$BATT" adapter disable >>"$LOG" 2>&1
        fi
      fi
      ;;
    charge)
      if [ "$P" -ge 99 ] && [ "$(fully_charged)" = "Yes" ]; then
        log "fully charged at ${P}% - holding $((HOLD_SECS/60)) min"
        date +%s > "$HOLD_FILE"
        echo hold > "$STATE_FILE"
      fi
      ;;
    hold)
      HS=$(cat "$HOLD_FILE" 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - HS )) -ge "$HOLD_SECS" ]; then
        snapshot_csv
        log "hold complete - snapshot logged, switching to DRAIN"
        "$BATT" adapter disable >>"$LOG" 2>&1
        echo drain > "$STATE_FILE"
      fi
      ;;
  esac

  sleep "$POLL"
done
