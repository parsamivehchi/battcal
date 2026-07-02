#!/bin/bash
# battcal-engine.sh - battery band cycler for Apple Silicon MacBooks.
#
# Runs as a user LaunchAgent (com.battcal.calibrate). Requires the batt daemon
# (https://github.com/charlie0129/batt) running with --always-allow-non-root-access.
#
# TWO MODES (switch anytime via the mode file, dashboard, or menu bar app):
#   longevity  (default) drain to 10% -> charge to 90% -> repeat. Never sits at
#              100%, never even reaches it. Kind to the cells.
#   calibration          drain to 5% -> charge to 100% + hold 1h -> repeat.
#              Full-range passes that re-train the gauge and powerd health.
#
# Cycling only runs while a charger is physically attached; unplug and the Mac
# behaves like a normal Mac until AC returns.
#
# Mode file:  /var/tmp/battcal.mode   (longevity when absent)
# Pause:      touch /var/tmp/battcal.pause   (instant normal charging)
# Resume:     rm /var/tmp/battcal.pause
# Off:        launchctl bootout gui/$(id -u)/com.battcal.calibrate ; batt adapter enable
# Watch:      tail -f ~/Library/Logs/battcal.log
# History:    ~/Library/Logs/battcal-history.csv (one row per cycle)
# Telemetry:  ~/Library/Logs/battcal-telemetry.csv (one row per poll)
#
# Config (optional): ~/.battcal/config may override POLL, HOLD_SECS,
# LONGEVITY_LOW, LONGEVITY_HIGH, CALIBRATION_LOW, BATT.

BATT=/opt/homebrew/bin/batt
STATE_FILE=/var/tmp/battcal.state
PAUSE_FILE=/var/tmp/battcal.pause
MODE_FILE=/var/tmp/battcal.mode
HOLD_FILE=/var/tmp/battcal.holdstart
CYCLE_FILE=/var/tmp/battcal.cyclestart
CAFF_PID_FILE=/var/tmp/battcal.caffeinate.pid
LOG="$HOME/Library/Logs/battcal.log"
CSV="$HOME/Library/Logs/battcal-history.csv"
TELEMETRY="$HOME/Library/Logs/battcal-telemetry.csv"
POLL=30           # seconds between checks
HOLD_SECS=3600    # calibration only: hold at 100% this long
LONGEVITY_LOW=10  # longevity band
LONGEVITY_HIGH=90
CALIBRATION_LOW=5

# shellcheck source=/dev/null
[ -f "$HOME/.battcal/config" ] && . "$HOME/.battcal/config"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

mode() {
  local m
  m=$(cat "$MODE_FILE" 2>/dev/null)
  case "$m" in calibration) echo calibration ;; *) echo longevity ;; esac
}

pct() { pmset -g batt | grep -Eo '[0-9]+%' | head -1 | tr -d '%'; }

LAST_CONDITION=""
# Watch macOS "Condition" (Normal / Service Recommended). When it flips to
# Service Recommended, notify once - that is the moment to go to the Genius Bar.
check_condition() {
  local c
  c=$(system_profiler SPPowerDataType 2>/dev/null | sed -n 's/.*Condition: *//p' | head -1)
  [ -z "$c" ] && return
  if [ -n "$LAST_CONDITION" ] && [ "$c" != "$LAST_CONDITION" ]; then
    log "battery Condition changed: $LAST_CONDITION -> $c"
    if echo "$c" | grep -qi 'service'; then
      osascript -e "display notification \"macOS now flags this battery: $c. Book a Genius Bar visit.\" with title \"BattCal\" sound name \"Glass\"" >/dev/null 2>&1
    fi
  fi
  LAST_CONDITION=$c
}

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

# MagSafe LED scheme (hardware has amber+green+off only; no other colors exist):
#   dark = BattCal draining (longevity) | slow green pulse = calibration drain
#   amber = actually charging | green = at target | normal Apple behavior = paused/off
# LED_SCHEME: battcal (default) | truthful (always reflect charging) | off (never touch)
LED_SCHEME=${LED_SCHEME:-battcal}
LED_STATE=""
led() {
  case "$LED_SCHEME" in
    off) return ;;
    truthful) set -- enable ;;
  esac
  [ "$1" = "$LED_STATE" ] && return
  LED_STATE=$1
  "$BATT" magsafe-led "$1" >>"$LOG" 2>&1
}

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
  local ior raw nom cyc apple cs dur
  ior=$(ioreg -rn AppleSmartBattery)
  raw=$(echo "$ior" | sed -n 's/^ *"AppleRawMaxCapacity" = \([0-9]*\)$/\1/p')
  nom=$(echo "$ior" | sed -n 's/^ *"NominalChargeCapacity" = \([0-9]*\)$/\1/p')
  cyc=$(echo "$ior" | sed -n 's/^ *"CycleCount" = \([0-9]*\)$/\1/p')
  apple=$(system_profiler SPPowerDataType 2>/dev/null | sed -n 's/.*Maximum Capacity: //p')
  cs=$(cat "$CYCLE_FILE" 2>/dev/null || echo 0)
  dur=""
  [ "$cs" -gt 0 ] 2>/dev/null && dur=$(( ($(date +%s) - cs) / 60 ))
  [ -f "$CSV" ] || echo "date,cycle_count,raw_mAh,nominal_mAh,apple_health,mode,band_low,band_high,duration_min" > "$CSV"
  echo "$(date '+%Y-%m-%d %H:%M'),$cyc,$raw,$nom,$apple,$MODE,$LOW,$HIGH,$dur" >> "$CSV"
}

begin_cycle() { date +%s > "$CYCLE_FILE"; }

trap 'stop_caffeinate; "$BATT" magsafe-led enable >/dev/null 2>&1' EXIT TERM INT

# v2.1: history CSV gained mode/band/duration columns; park legacy files aside.
if [ -f "$CSV" ] && ! head -1 "$CSV" | grep -q ',mode,'; then
  mv "$CSV" "${CSV%.csv}-v1.csv"
fi

[ -f "$STATE_FILE" ] || { echo drain > "$STATE_FILE"; date +%s > "$CYCLE_FILE"; }
STATE=$(cat "$STATE_FILE")
LAST_MODE=$(mode)
log "=== battcal engine started (state=$STATE, mode=$LAST_MODE, battery $(pct)%) ==="

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
      led enable
      stop_caffeinate
      echo paused > "$STATE_FILE"
    fi
    sleep "$POLL"; continue
  fi

  STATE=$(cat "$STATE_FILE")
  if [ "$STATE" = "paused" ]; then
    log "RESUMED - entering drain"
    begin_cycle
    echo drain > "$STATE_FILE"; STATE=drain
    "$BATT" adapter disable >>"$LOG" 2>&1
  fi

  MODE=$(mode)
  if [ "$MODE" != "$LAST_MODE" ]; then
    log "mode switched: $LAST_MODE -> $MODE"
    LAST_MODE=$MODE
    # Leaving calibration while parked at 100% (hold): start draining now.
    if [ "$MODE" = "longevity" ] && [ "$STATE" = "hold" ]; then
      log "longevity mode does not hold at full - switching to DRAIN"
      "$BATT" adapter disable >>"$LOG" 2>&1
      begin_cycle
      echo drain > "$STATE_FILE"; STATE=drain
    fi
  fi
  if [ "$MODE" = "longevity" ]; then LOW=$LONGEVITY_LOW; HIGH=$LONGEVITY_HIGH; else LOW=$CALIBRATION_LOW; HIGH=100; fi

  P=$(pct)
  if [ -z "$P" ]; then sleep "$POLL"; continue; fi

  log_telemetry "$STATE" "$P"
  check_condition

  case "$STATE" in
    drain)
      if [ "$P" -le "$LOW" ]; then
        log "reached ${P}% - switching to CHARGE (mode=$MODE, target ${HIGH}%)"
        "$BATT" adapter enable >>"$LOG" 2>&1
        stop_caffeinate
        AWAITING_AC=0
        echo charge > "$STATE_FILE"
      elif ! plugged; then
        # Charger physically unplugged: cycling only runs on AC. Hand charging
        # back (so any charger works instantly) and let the Mac behave normally.
        if [ "$AWAITING_AC" -eq 0 ]; then
          log "charger unplugged at ${P}% - cycling idle until AC returns"
          "$BATT" adapter enable >>"$LOG" 2>&1
          led enable
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
        if [ "$MODE" = "longevity" ]; then
          led always-off
        else
          # calibration heartbeat: alternate dark/green once per poll
          if [ "${LED_PULSE:-0}" -eq 0 ]; then led always-off; LED_PULSE=1; else led enable; LED_PULSE=0; fi
        fi
        # If something re-enabled charging (batt daemon restart etc.), reassert the cut
        if is_charging; then
          log "charging detected during drain at ${P}% - reasserting adapter disable"
          "$BATT" adapter disable >>"$LOG" 2>&1
        fi
      fi
      ;;
    charge)
      led enable
      if [ "$MODE" = "longevity" ]; then
        if [ "$P" -ge "$HIGH" ]; then
          snapshot_csv
          log "reached ${P}% - longevity turnaround (never charging to 100%), switching to DRAIN"
          "$BATT" adapter disable >>"$LOG" 2>&1
          begin_cycle
          echo drain > "$STATE_FILE"
        fi
      else
        if [ "$P" -ge 99 ] && [ "$(fully_charged)" = "Yes" ]; then
          log "fully charged at ${P}% - holding $((HOLD_SECS/60)) min (calibration)"
          date +%s > "$HOLD_FILE"
          echo hold > "$STATE_FILE"
        fi
      fi
      ;;
    hold)
      led enable
      # Hold only exists in calibration mode; in longevity, leave full immediately.
      if [ "$MODE" = "longevity" ]; then
        snapshot_csv
        log "longevity mode does not hold at full - switching to DRAIN"
        "$BATT" adapter disable >>"$LOG" 2>&1
        begin_cycle
        echo drain > "$STATE_FILE"
        sleep "$POLL"; continue
      fi
      HS=$(cat "$HOLD_FILE" 2>/dev/null || echo 0)
      if [ $(( $(date +%s) - HS )) -ge "$HOLD_SECS" ]; then
        snapshot_csv
        log "hold complete - snapshot logged, switching to DRAIN"
        "$BATT" adapter disable >>"$LOG" 2>&1
        begin_cycle
        echo drain > "$STATE_FILE"
      fi
      ;;
  esac

  sleep "$POLL"
done
